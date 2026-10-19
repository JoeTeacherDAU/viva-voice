import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PairFileSource } from "@/lib/analysis/types";
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
  sessionOffsets,
  type ChosenFile,
  type PairImportInput,
} from "./pairfiles";
import { scanSessionFile, sha256OfBlob } from "./scan";
import { FIXTURE_PAIR_ROWS, FIXTURE_RATE, makePairFixture, makeSessionFixture } from "./synthetic";

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
  session: null,
  confirmed: true,
};

async function chosen(files: { name: string; bytes: Uint8Array }[]): Promise<ChosenFile[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, ...(await checkPairWav(blobOf(f.bytes))) })),
  );
}

async function importInput(
  fx: ReturnType<typeof makePairFixture>,
  withSession: boolean,
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
  let session: PairImportInput["session"];
  if (withSession) {
    const file = blobOf(fx.session);
    const { info } = await checkPairWav(file);
    session = {
      file,
      fileName: "SYN - Session 1.wav",
      info: info!,
      sha256: await sha256OfBlob(file),
    };
  }
  return {
    exam: EXAM,
    sessionLabel: "SYN_S1",
    sessionDate: "2026-10-19",
    roster,
    pairs,
    session,
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
    const stray = { name: "SYN - Session 1.wav", bytes: fx.session };
    const gate = pairUploadGate({ ...READY, rows, files: await chosen([...fx.files, stray]) });
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toEqual([
      "The chosen file SYN - Session 1.wav matches no manifest row. Choose the pair files again without it, or add its row to the manifest.",
    ]);
    // Picked with the pair files and also attached as the session WAV, it still blocks,
    // and the message points to the right box.
    const both = pairUploadGate({
      ...READY,
      rows,
      files: await chosen([...fx.files, stray]),
      session: (await chosen([stray]))[0],
    });
    expect(both.reasons).toEqual([
      "The chosen file SYN - Session 1.wav is the session-wide WAV, which belongs in its own box below. Choose the pair files again without it.",
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

describe("session WAV offsets (work order 03, test 4)", () => {
  it("places each pair by summing durations in manifest order and checks the total", () => {
    const pairs = [
      { order: 2, frames: 11_727_824, sampleRate: 48000 },
      { order: 1, frames: 11_709_991, sampleRate: 48000 },
      { order: 3, frames: 12_142_440, sampleRate: 48000 },
    ];
    const total = 11_709_991 + 11_727_824 + 12_142_440;
    const exact = sessionOffsets(pairs, { frames: total + 3, sampleRate: 48000 });
    expect(exact.ok).toBe(true);
    expect(exact.pairs).toEqual([
      { order: 1, startFrame: 0, endFrame: 11_709_991, startMs: 0 },
      {
        order: 2,
        startFrame: 11_709_991,
        endFrame: 23_437_815,
        startMs: (11_709_991 * 1000) / 48000,
      },
      { order: 3, startFrame: 23_437_815, endFrame: total, startMs: (23_437_815 * 1000) / 48000 },
    ]);
    expect(exact.differenceMs).toBeCloseTo(-3 / 48, 9);

    // 50 ms is 2400 frames at 48 kHz: 2400 passes, 2401 does not, either way round.
    expect(sessionOffsets(pairs, { frames: total + 2400, sampleRate: 48000 }).ok).toBe(true);
    expect(sessionOffsets(pairs, { frames: total - 2400, sampleRate: 48000 }).ok).toBe(true);
    const long = sessionOffsets(pairs, { frames: total + 2401, sampleRate: 48000 });
    expect(long.ok).toBe(false);
    expect(long.differenceMs).toBeCloseTo(-2401 / 48, 9);

    const odd = sessionOffsets([{ order: 1, frames: 44100, sampleRate: 44100 }], {
      frames: 48000,
      sampleRate: 48000,
    });
    expect(odd.ok).toBe(false);
    expect(odd.rateProblem).toBe("Pair 1 runs at 44100 Hz and the session file at 48000 Hz.");
  });

  it("puts offsets in the records only when the check passes", async () => {
    const fx = makePairFixture();
    const inp = await importInput(fx, true);
    const plan = planPairUpload(inp);
    expect(plan.check?.ok).toBe(true);
    expect(plan.check?.differenceMs).toBe(0);
    let at = 0;
    plan.records.forEach((r, i) => {
      const src = r.source as PairFileSource;
      expect(src.session).toEqual({
        rawPath: "sessions-raw/SYN_S1.wav",
        rawSha256: sha(fx.session),
        startFrame: at,
        endFrame: at + fx.files[i].frames,
      });
      at += fx.files[i].frames;
    });

    // A session WAV 100 ms longer than the pairs: the check fails, the import
    // record keeps the result, and no record claims an offset.
    const longer = makeSessionFixture({
      leadMs: 0,
      gapMs: 0,
      pairFrames: [...fx.files.map((f) => f.frames), FIXTURE_RATE / 10],
      pairs: [...FIXTURE_PAIR_ROWS, ["S01", "S02"]],
    });
    const file = blobOf(longer.bytes);
    const { info } = await checkPairWav(file);
    const bad = planPairUpload({
      ...inp,
      session: { file, fileName: "long.wav", info: info!, sha256: sha(longer.bytes) },
    });
    expect(bad.check?.ok).toBe(false);
    expect(bad.check?.differenceMs).toBeCloseTo(-100, 9);
    expect(bad.importRecord.sessionFile?.offsetCheck.ok).toBe(false);
    expect(bad.records.every((r) => (r.source as PairFileSource).session === undefined)).toBe(true);
    expect(bad.items[0].pathname).toBe("sessions-raw/SYN_S1.wav");
  });
});

describe("pair-file records and upload", () => {
  it("stores each pair file byte for byte and writes one valid record per pair", async () => {
    const fx = makePairFixture();
    const roster = ROSTER.map((r) =>
      r.participantId === "S03" ? { ...r, consentStatus: "declined" as const } : r,
    );
    const plan = planPairUpload(await importInput(fx, false, roster));
    expect(plan.check).toBeNull();
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
