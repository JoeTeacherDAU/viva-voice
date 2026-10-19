import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RosterEntry } from "@/lib/exams";
import { MockBatch } from "@/lib/asr/batch";
import { runPass2 } from "@/lib/output/pass2";
import { paths, uploadPathAllowed } from "@/lib/storage/paths";
import { getBytes, MemoryStore } from "@/lib/storage/store";
import { validateSession } from "@/lib/validation";
import {
  checkPairWav,
  matchPairFiles,
  pairUploadGate,
  parsePairManifestCsv,
  planPairUpload,
  type ChosenFile,
  type PairImportInput,
} from "./pairfiles";
import { scanSessionFile } from "./scan";
import { makePairFixture, makeSessionFixture } from "./synthetic";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart]);

const EXAM = { id: "fixture-pairs", targetPatterns: [], keyterms: [], durationMs: 300000 };
const ROSTER: RosterEntry[] = ["S01", "S02", "S03", "S04", "S05", "S06"].map((id) => ({
  name: `Student ${id}`,
  participantId: id,
  consentStatus: "granted",
}));

const READY = {
  examReady: true,
  sessionLabel: "SYN_S1",
  sessionDate: "2026-10-19",
  labelTaken: false,
  manifestProblems: [] as string[],
  confirmed: true,
};

async function chosen(files: { name: string; bytes: Uint8Array }[]): Promise<ChosenFile[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, ...(await checkPairWav(blobOf(f.bytes))) })),
  );
}

async function importInput(
  fx: ReturnType<typeof makePairFixture>,
  roster: RosterEntry[] | null = ROSTER,
): Promise<PairImportInput> {
  const { rows } = parsePairManifestCsv(fx.manifest);
  const m = matchPairFiles(
    rows,
    fx.files.map((f) => f.name),
  );
  const pairs = await Promise.all(
    m.matched.map(async ({ row, index }) => {
      const f = fx.files[index];
      const file = blobOf(f.bytes);
      const { info } = await checkPairWav(file);
      const scan = await scanSessionFile(file, info!);
      return { row, file, fileName: f.name, info: info!, sha256: scan.sha256, energy: scan.energy };
    }),
  );
  return {
    exam: EXAM,
    sessionLabel: "SYN_S1",
    sessionDate: "2026-10-19",
    roster,
    pairs,
    manifest: { fileName: "SYN_S1_manifest.csv", text: fx.manifest },
    now: new Date("2026-10-19T10:00:00Z"),
  };
}

describe("pair manifest", () => {
  it("reads the five columns, in any order, and keeps file names with spaces", () => {
    const { rows, problems } = parsePairManifestCsv(
      "﻿file,order,left_id,right_id,track\r\n" +
        "C1_26_02_S1.01.Audio 2.wav,1,F26-S02-01,F26-S02-12,Audio 2\r\n" +
        '"C1_26_02_S1.02.Audio 1.wav",2,F26-S02-24,F26-S02-30,Audio 1\r\n',
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        order: 1,
        track: "Audio 2",
        file: "C1_26_02_S1.01.Audio 2.wav",
        leftId: "F26-S02-01",
        rightId: "F26-S02-12",
      },
      {
        order: 2,
        track: "Audio 1",
        file: "C1_26_02_S1.02.Audio 1.wav",
        leftId: "F26-S02-24",
        rightId: "F26-S02-30",
      },
    ]);
  });

  it("says why a three-column manifest cannot drive the pair mode", () => {
    const { rows, problems } = parsePairManifestCsv("order,left_id,right_id\n1,S01,S02\n");
    expect(rows).toEqual([]);
    expect(problems[0]).toContain("lacks track, file");
    expect(problems[0]).toContain("cannot tell which WAV belongs to which pair");
  });

  it("flags a file named twice and an empty file cell", () => {
    const { problems } = parsePairManifestCsv(
      "order,track,file,left_id,right_id\n1,A,a.wav,S01,S02\n2,B,a.wav,S03,S04\n3,C,,S05,S06\n",
    );
    expect(problems).toEqual([
      "Row 2: the file a.wav also appears in row 1.",
      "Row 3: the file name is empty.",
    ]);
  });
});

describe("matching pair files to manifest rows (work order 03, tests 1 to 3)", () => {
  it("matches each file to its row by file name, whatever order the files arrive in", async () => {
    const fx = makePairFixture();
    const { rows } = parsePairManifestCsv(fx.manifest);
    // The picker hands files over in its own order; reverse them to prove the order does not count.
    const names = fx.files.map((f) => f.name).reverse();
    const m = matchPairFiles(rows, names);
    expect(m.missing).toEqual([]);
    expect(m.extra).toEqual([]);
    expect(m.matched.map(({ row, index }) => [row.order, row.track, names[index]])).toEqual([
      [1, "Audio 2", "SYN_S1.01.Audio 2.wav"],
      [2, "Audio 1", "SYN_S1.02.Audio 1.wav"],
      [3, "Audio 3", "SYN_S1.03.Audio 3.wav"],
    ]);
    // Same name in a different Unicode form still matches.
    const nfd = matchPairFiles(
      [{ order: 1, track: "t", file: "café.wav", leftId: "S01", rightId: "S02" }],
      ["café.wav"],
    );
    expect(nfd.missing).toEqual([]);

    const gate = pairUploadGate({ ...READY, rows, files: await chosen(fx.files) });
    expect(gate).toEqual({ ok: true, reasons: [] });
  });

  it("blocks the upload when a manifest row has no file", async () => {
    const fx = makePairFixture();
    const { rows } = parsePairManifestCsv(fx.manifest);
    const files = await chosen(fx.files.filter((_, i) => i !== 1));
    const gate = pairUploadGate({ ...READY, rows, files });
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toEqual([
      "Manifest row 2 names SYN_S1.02.Audio 1.wav, and no chosen file has that name. Choose it with the other pair files.",
    ]);
  });

  it("blocks the upload when the folder holds a file that no row names", async () => {
    const fx = makePairFixture();
    const { rows } = parsePairManifestCsv(fx.manifest);
    const stray = { name: "SYN_S1.04.Audio 4.wav", bytes: fx.files[0].bytes };
    const gate = pairUploadGate({ ...READY, rows, files: await chosen([...fx.files, stray]) });
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toEqual([
      "The chosen file SYN_S1.04.Audio 4.wav matches no manifest row. Choose the pair files again without it, or add its row to the manifest.",
    ]);
  });

  it("blocks a file that fails the header check and names what it holds", async () => {
    const fx = makePairFixture();
    const { rows } = parsePairManifestCsv(fx.manifest);
    const mono = makeSessionFixture({ channels: 1, pairFrames: [4800] }).bytes;
    const float = makePairFixture("SYN_S1", { encoding: "float32" }).files[2].bytes;
    const files = await chosen([
      fx.files[0],
      { name: fx.files[1].name, bytes: mono },
      { name: fx.files[2].name, bytes: float },
    ]);
    const gate = pairUploadGate({ ...READY, rows, files });
    expect(gate.reasons).toEqual([
      "SYN_S1.02.Audio 1.wav: This file contains 1 channel, 48000 Hz, 24-bit PCM. The import needs 2 channels, one student on each. Export the Audacity project as stereo.",
      "SYN_S1.03.Audio 3.wav: This file contains 2 channels, 48000 Hz, 32-bit float. Pair files must be PCM; export them from Audacity as signed 24-bit PCM.",
    ]);
  });

  it("waits for the table to be confirmed after everything else clears", async () => {
    const fx = makePairFixture();
    const { rows } = parsePairManifestCsv(fx.manifest);
    const gate = pairUploadGate({
      ...READY,
      confirmed: false,
      rows,
      files: await chosen(fx.files),
    });
    expect(gate.reasons).toEqual(["Check the table, then tick the box that confirms it."]);
  });
});

describe("pair-file records and upload", () => {
  it("stores each pair file byte for byte and writes one valid record per pair", async () => {
    const fx = makePairFixture();
    const roster = ROSTER.map((r) =>
      r.participantId === "S03" ? { ...r, consentStatus: "declined" as const } : r,
    );
    const plan = planPairUpload(await importInput(fx, roster));
    expect(plan.items.map((i) => i.pathname)).toEqual([
      "audio/SYN_S1-P01/stereo.wav",
      "energy/SYN_S1-P01.json",
      "sessions/SYN_S1-P01.json",
      "audio/SYN_S1-P02/stereo.wav",
      "energy/SYN_S1-P02.json",
      "sessions/SYN_S1-P02.json",
      "audio/SYN_S1-P03/stereo.wav",
      "energy/SYN_S1-P03.json",
      "sessions/SYN_S1-P03.json",
      "sessions-raw/SYN_S1.json",
    ]);

    const store = new MemoryStore();
    for (const item of plan.items) {
      expect(uploadPathAllowed(item.pathname), item.pathname).toBe(true);
      await store.put(item.pathname, await item.body(), item.contentType);
    }
    for (const [i, f] of fx.files.entries()) {
      const stored = await getBytes(store, paths.stereo(`SYN_S1-P0${i + 1}`));
      expect(sha(stored!)).toBe(sha(f.bytes));
    }

    const [p1, p2] = plan.records;
    expect(p1.captureMode).toBe("file-import");
    expect(p1.source).toEqual({
      mode: "pair-file",
      sessionLabel: "SYN_S1",
      sessionDate: "2026-10-19",
      order: 1,
      fileName: "SYN_S1.01.Audio 2.wav",
      track: "Audio 2",
      fileSha256: sha(fx.files[0].bytes),
      fileBytes: fx.files[0].bytes.length,
      frames: fx.files[0].frames,
      sampleRate: 48000,
      bitsPerSample: 24,
      encoding: "pcm24",
    });
    expect(p1.markers).toEqual({ startMs: 0, stopMs: (fx.files[0].frames * 1000) / 48000 });
    expect(p2.participantIds).toEqual({ A: "S04", B: "S03" });
    expect(p2.excluded?.reason).toBe("consent");
    for (const r of plan.records) expect(validateSession(r)).toEqual({ ok: true, errors: [] });

    expect(plan.importRecord.manifestCsv).toBe(fx.manifest);
    expect(plan.importRecord.files.map((f) => [f.order, f.fileName, f.excluded])).toEqual([
      [1, "SYN_S1.01.Audio 2.wav", false],
      [2, "SYN_S1.02.Audio 1.wav", true],
      [3, "SYN_S1.03.Audio 3.wav", false],
    ]);

    // Pass two treats a pair file like any imported pair and skips the excluded one.
    const batch = new MockBatch(async () => []);
    const done = await runPass2(store, p1.id, batch);
    expect(done.record.passes["2"]?.source).toBe("file");
    await expect(runPass2(store, p2.id, batch)).rejects.toMatchObject({ status: 409 });
  });
});
