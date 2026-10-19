import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/lib/analysis/types";
import type { RosterEntry } from "@/lib/exams";
import { MockBatch } from "@/lib/asr/batch";
import { unzipSync } from "fflate";
import { say } from "@/lib/analysis/testutil";
import { Pass2Error, recomputeStored, runPass2 } from "@/lib/output/pass2";
import { buildSessionDownload, listSessions } from "@/lib/output/sessionList";
import { paths, uploadPathAllowed } from "@/lib/storage/paths";
import { getBytes, MemoryStore } from "@/lib/storage/store";
import { validateSession } from "@/lib/validation";
import { parseManifestCsv, uploadGate, type ManifestRow } from "./manifest";
import { pass2Queue, planUpload, type ImportInput } from "./records";
import { minZeroRunFrames, SampleScanner, scanSessionFile } from "./scan";
import {
  mergeWithNext,
  moveBoundary,
  proposeSegments,
  removeSegment,
  segmentsValid,
  splitAt,
  suggestSplit,
} from "./segments";
import {
  FIXTURE_MANIFEST,
  FIXTURE_RATE,
  FIXTURE_TONES,
  makeSessionFixture,
  tonePower,
} from "./synthetic";
import { readSessionWavInfo, sampleReader, sliceBlob, WavFormatProblem } from "./wavfile";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart]);

const EXAM = { id: "fixture-import", targetPatterns: [], keyterms: [], durationMs: 300000 };
const ROSTER: RosterEntry[] = ["S01", "S02", "S03", "S04", "S05", "S06"].map((id) => ({
  name: `Student ${id}`,
  participantId: id,
  consentStatus: "granted",
}));

async function scanFixture(spec = {}) {
  const fx = makeSessionFixture(spec);
  const file = blobOf(fx.bytes);
  const info = await readSessionWavInfo(file);
  const scan = await scanSessionFile(file, info);
  return { fx, file, info, scan, segments: proposeSegments(scan.zeroRuns, scan.frames) };
}

function input(
  s: Awaited<ReturnType<typeof scanFixture>>,
  rows: ManifestRow[],
  roster: RosterEntry[] | null = ROSTER,
): ImportInput {
  return {
    exam: EXAM,
    sessionLabel: "C1_26_MIDS_S1",
    sessionDate: "2026-10-19",
    info: s.info,
    rawSha256: s.scan.sha256,
    segments: s.segments,
    rows,
    roster,
    now: new Date("2026-10-19T09:00:00Z"),
  };
}

/** Runs the whole upload plan into a memory store, as the page does. */
async function importInto(
  store: MemoryStore,
  s: Awaited<ReturnType<typeof scanFixture>>,
  inp: ImportInput,
) {
  const plan = await planUpload(
    s.file,
    "session.wav",
    inp,
    {
      zeroRuns: s.scan.zeroRuns,
      energy: s.scan.energy,
      proposed: s.segments.map(({ start, end }) => ({ start, end })),
    },
    [],
  );
  for (const item of plan.items) {
    expect(uploadPathAllowed(item.pathname), item.pathname).toBe(true);
    await store.put(item.pathname, await item.body(), item.contentType);
  }
  return plan;
}

describe("session WAV header", () => {
  it("reads 24-bit, 16-bit, and float stereo files", async () => {
    for (const [encoding, bits] of [
      ["pcm24", 24],
      ["pcm16", 16],
      ["float32", 32],
    ] as const) {
      const info = await readSessionWavInfo(blobOf(makeSessionFixture({ encoding }).bytes));
      expect(info).toMatchObject({ encoding, bitsPerSample: bits, channels: 2, sampleRate: 48000 });
    }
  });

  it("rejects a mono file with a message that names what it holds", async () => {
    const mono = makeSessionFixture({ channels: 1 }).bytes;
    await expect(readSessionWavInfo(blobOf(mono))).rejects.toThrow(
      "This file contains 1 channel, 48000 Hz, 24-bit PCM. The import needs 2 channels",
    );
    await expect(readSessionWavInfo(blobOf(mono))).rejects.toBeInstanceOf(WavFormatProblem);
  });

  it("rejects 32-bit integer PCM and names it", async () => {
    const b = makeSessionFixture({ encoding: "float32" }).bytes.slice();
    new DataView(b.buffer).setUint16(20, 1, true);
    await expect(readSessionWavInfo(blobOf(b))).rejects.toThrow(
      "This file contains 2 channels, 48000 Hz, 32-bit PCM. The import accepts 16-bit PCM, 24-bit PCM, or 32-bit float.",
    );
  });

  it("reads WAVE_FORMAT_EXTENSIBLE by its subformat", async () => {
    const plain = makeSessionFixture({ pairFrames: [4801], leadMs: 0 }).bytes;
    // Rebuild with a 40-byte extensible fmt chunk carrying the PCM GUID.
    const fmt = new Uint8Array(48);
    const v = new DataView(fmt.buffer);
    fmt.set([..."fmt "].map((c) => c.charCodeAt(0)));
    v.setUint32(4, 40, true);
    v.setUint16(8, 0xfffe, true);
    fmt.set(plain.slice(22, 36), 10);
    v.setUint16(24, 22, true);
    v.setUint16(26, 24, true);
    v.setUint16(32, 1, true);
    const data = plain.slice(36);
    const out = new Uint8Array(12 + fmt.length + data.length);
    out.set(plain.slice(0, 12));
    out.set(fmt, 12);
    out.set(data, 12 + fmt.length);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    const info = await readSessionWavInfo(blobOf(out));
    expect(info).toMatchObject({ encoding: "pcm24", formatTag: 0xfffe, frames: 4801 });
  });

  it("rejects a file that is not a WAV", async () => {
    await expect(
      readSessionWavInfo(blobOf(new TextEncoder().encode("hello world!"))),
    ).rejects.toThrow("not a WAV file");
  });
});

describe("segmentation (work order 02, tests 1 and 2)", () => {
  it("finds three segments with sample-exact boundaries in the 24-bit fixture", async () => {
    const s = await scanFixture();
    expect(s.info.encoding).toBe("pcm24");
    expect(s.info.sampleRate).toBe(48000);
    expect(s.fx.segments[0].start).toBe(3 * FIXTURE_RATE);
    expect(s.segments.map(({ start, end }) => ({ start, end }))).toEqual(s.fx.segments);
    // Leading 3 s and two 2 s gaps; the 200 ms hush inside each pair stays inside it.
    expect(s.scan.zeroRuns).toEqual([
      { start: 0, end: s.fx.segments[0].start },
      { start: s.fx.segments[0].end, end: s.fx.segments[1].start },
      { start: s.fx.segments[1].end, end: s.fx.segments[2].start },
    ]);
  });

  it("finds the same boundaries in 16-bit and float files", async () => {
    for (const encoding of ["pcm16", "float32"] as const) {
      const s = await scanFixture({ encoding });
      expect(s.segments.map(({ start, end }) => ({ start, end }))).toEqual(s.fx.segments);
    }
  });

  it("keeps a zero run one frame short of 500 ms inside a segment", async () => {
    const short = minZeroRunFrames(48000) - 1;
    const s = await scanFixture({ leadMs: 0, gapMs: (short * 1000) / 48000 });
    expect(s.segments).toHaveLength(1);
    const exact = await scanFixture({ leadMs: 0, gapMs: 500 });
    expect(exact.segments).toHaveLength(3);
  });

  it("gives the same result however the bytes arrive", async () => {
    const s = await scanFixture({ pairFrames: [30_001, 40_003], leadMs: 600, gapMs: 700 });
    const scanner = new SampleScanner(s.info);
    const data = s.fx.bytes.subarray(s.info.dataOffset);
    for (let o = 0, k = 1; o < data.length; k++) {
      const n = (k * 7919) % 50_000 || 1;
      scanner.push(data.subarray(o, o + n));
      o += n;
    }
    const r = scanner.finish();
    expect(r.zeroRuns).toEqual(s.scan.zeroRuns);
    expect(r.energy.channels).toEqual(s.scan.energy.channels);
  });

  it("computes 20 ms energy frames on both channels", async () => {
    const s = await scanFixture();
    expect(s.scan.energy.frameMs).toBe(20);
    expect(s.scan.energy.channels[0]).toHaveLength(Math.floor(s.scan.frames / 960));
    expect(s.scan.energy.channels[0][0]).toBe(-100);
    const inPair = Math.floor(s.fx.segments[0].start / 960) + 2;
    expect(s.scan.energy.channels[0][inPair]).toBeGreaterThan(-20);
  });
});

describe("lossless cutting (work order 02, test 3)", () => {
  it("rebuilds the raw file byte for byte from the header, zero runs, and slice samples", async () => {
    const s = await scanFixture();
    const parts: Uint8Array[] = [s.fx.bytes.slice(0, s.info.dataOffset)];
    const frameBytes = (a: number, b: number) =>
      s.fx.bytes.slice(
        s.info.dataOffset + a * s.info.blockAlign,
        s.info.dataOffset + b * s.info.blockAlign,
      );
    let cursor = 0;
    for (const seg of s.segments) {
      parts.push(frameBytes(cursor, seg.start)); // the zero run before this pair
      const slice = new Uint8Array(
        await sliceBlob(s.file, s.info, seg.start, seg.end).arrayBuffer(),
      );
      const sliceInfo = await readSessionWavInfo(blobOf(slice));
      expect(sliceInfo).toMatchObject({
        encoding: "pcm24",
        sampleRate: 48000,
        frames: seg.end - seg.start,
      });
      parts.push(slice.slice(sliceInfo.dataOffset));
      cursor = seg.end;
    }
    parts.push(frameBytes(cursor, s.scan.frames));
    const rebuilt = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      rebuilt.set(p, o);
      o += p.length;
    }
    expect(rebuilt.length).toBe(s.fx.bytes.length);
    expect(sha(rebuilt)).toBe(sha(s.fx.bytes));
  });
});

describe("pair records (work order 02, test 4)", () => {
  it("carries the manifest's left/right swap into the session records and the audio", async () => {
    const s = await scanFixture();
    const { rows } = parseManifestCsv(FIXTURE_MANIFEST);
    const store = new MemoryStore();
    const plan = await importInto(store, s, input(s, rows));
    const recs = plan.records;
    expect(recs.map((r) => r.id)).toEqual([
      "C1_26_MIDS_S1-P01",
      "C1_26_MIDS_S1-P02",
      "C1_26_MIDS_S1-P03",
    ]);
    expect(recs[1].participantIds).toEqual({ A: "S04", B: "S03" });
    expect(recs[1].channelMap).toEqual({ "0": "A", "1": "B" });

    for (const rec of recs) {
      expect(validateSession(rec).errors).toEqual([]);
      expect(rec).toMatchObject({
        captureMode: "file-import",
        instructorLiveScore: null,
        passes: {},
        markers: {
          startMs: 0,
          stopMs: ((rec.source!.endFrame - rec.source!.startFrame) * 1000) / 48000,
        },
        source: { sessionLabel: "C1_26_MIDS_S1", rawPath: "sessions-raw/C1_26_MIDS_S1.wav" },
      });
      // The stored slice's left channel carries participant A's tone, the right channel B's.
      const stored = (await getBytes(store, paths.stereo(rec.id)))!;
      expect(sha(stored)).toBe(rec.source!.sliceSha256);
      const info = await readSessionWavInfo(blobOf(stored));
      const read = sampleReader(info.encoding);
      const v = new DataView(stored.buffer, stored.byteOffset);
      const ch = [0, 1].map((c) =>
        Float32Array.from({ length: info.frames }, (_, k) =>
          read(v, info.dataOffset + k * info.blockAlign + c * 3),
        ),
      );
      for (const [c, P] of [
        [0, "A"],
        [1, "B"],
      ] as const) {
        const own = tonePower(ch[c], FIXTURE_TONES[rec.participantIds[P]]);
        const other = tonePower(ch[c], FIXTURE_TONES[rec.participantIds[P === "A" ? "B" : "A"]]);
        expect(own).toBeGreaterThan(100 * other);
      }
    }
    // Each pair's energy file starts at the slice's first frame.
    const energy = JSON.parse(
      new TextDecoder().decode((await getBytes(store, paths.energy(recs[1].id)))!),
    );
    expect(energy.channels[0]).toHaveLength(
      Math.floor((s.fx.segments[1].end - s.fx.segments[1].start) / 960),
    );
  });

  it("uses an edited measurement window when one is set", async () => {
    const s = await scanFixture();
    const { rows } = parseManifestCsv(FIXTURE_MANIFEST);
    const inp = {
      ...input(s, rows),
      windows: { [s.segments[0].key]: { startMs: 100, stopMs: 2000 } },
    };
    const plan = await planUpload(
      s.file,
      "x.wav",
      inp,
      { zeroRuns: [], energy: s.scan.energy, proposed: [] },
      [],
    );
    expect(plan.records[0].markers).toEqual({ startMs: 100, stopMs: 2000 });
    expect(plan.records[1].markers.startMs).toBe(0);
  });
});

describe("upload gate (work order 02, test 5)", () => {
  const rows = parseManifestCsv(FIXTURE_MANIFEST).rows;
  const base = {
    examReady: true,
    sessionLabel: "C1_26_MIDS_S1",
    sessionDate: "2026-10-19",
    labelTaken: false,
  };

  it("blocks the upload when the segment count differs from the manifest and shows both numbers", () => {
    const g = uploadGate({ ...base, segments: 4, rows });
    expect(g.ok).toBe(false);
    expect(g.reasons).toContain(
      "The file has 4 segments and the manifest has 3 rows. Edit the segments or the manifest until the two numbers match.",
    );
    expect(uploadGate({ ...base, segments: 3, rows: rows.slice(0, 2) }).ok).toBe(false);
  });

  it("opens when the counts match and everything else is set", () => {
    expect(uploadGate({ ...base, segments: 3, rows })).toEqual({
      ok: true,
      segments: 3,
      rows: 3,
      reasons: [],
    });
  });

  it("blocks a taken label, a missing exam, and a bad manifest", () => {
    expect(uploadGate({ ...base, labelTaken: true, segments: 3, rows }).ok).toBe(false);
    expect(uploadGate({ ...base, examReady: false, segments: 3, rows }).ok).toBe(false);
    expect(
      uploadGate({ ...base, segments: 1, rows: [{ order: 1, leftId: "S01", rightId: "S01" }] })
        .reasons,
    ).toContain("Row 1: the same participant sits on both channels.");
  });

  it("refuses to build records when the counts differ", async () => {
    const s = await scanFixture();
    const rows2 = parseManifestCsv(FIXTURE_MANIFEST).rows.slice(0, 2);
    await expect(
      planUpload(
        s.file,
        "x.wav",
        input(s, rows2),
        { zeroRuns: [], energy: s.scan.energy, proposed: [] },
        [],
      ),
    ).rejects.toThrow("3 segments and 2 manifest rows");
  });
});

describe("consent (work order 02, test 6)", () => {
  it("excludes a pair with a declined participant from pass two and keeps its audio", async () => {
    const s = await scanFixture();
    const rows = parseManifestCsv(FIXTURE_MANIFEST).rows;
    const roster = ROSTER.map((r) =>
      r.participantId === "S03" ? { ...r, consentStatus: "declined" as const } : r,
    );
    const store = new MemoryStore();
    const plan = await importInto(store, s, input(s, rows, roster));
    const [p1, p2, p3] = plan.records;
    expect(p2.excluded).toEqual({
      reason: "consent",
      consent: { S04: "granted", S03: "declined" },
    });
    expect(p1.excluded).toBeUndefined();
    expect(validateSession(p2).ok).toBe(true);
    expect(await getBytes(store, paths.stereo(p2.id))).not.toBeNull();

    expect(pass2Queue(plan.records)).toEqual({
      run: [p1.id, p3.id],
      skip: [{ id: p2.id, reason: "excluded: consent" }],
    });

    let transcribed = 0;
    const batch = new MockBatch(async () => {
      transcribed++;
      return [];
    });
    await expect(runPass2(store, p2.id, batch)).rejects.toEqual(
      new Pass2Error(`Session ${p2.id} is excluded: consent`, 409),
    );
    expect(transcribed).toBe(0);
    expect(await getBytes(store, paths.document(p2.id, "A"))).toBeNull();

    const done = await runPass2(store, p1.id, batch);
    expect(transcribed).toBe(1);
    expect(done.record.passes["2"]?.source).toBe("file");
    expect(await getBytes(store, paths.document(p1.id, "A"))).not.toBeNull();
  });

  it("treats a participant missing from the roster, or pending, as unknown consent", async () => {
    const s = await scanFixture();
    const rows = parseManifestCsv(FIXTURE_MANIFEST).rows;
    const roster = ROSTER.filter((r) => r.participantId !== "S06").map((r) =>
      r.participantId === "S01" ? { ...r, consentStatus: "pending" as const } : r,
    );
    const plan = await planUpload(
      s.file,
      "x.wav",
      input(s, rows, roster),
      { zeroRuns: [], energy: s.scan.energy, proposed: [] },
      [],
    );
    expect(plan.records.map((r) => !!r.excluded)).toEqual([true, false, true]);
    expect(plan.records[2].excluded?.consent).toEqual({ S05: "granted", S06: "unknown" });
    const none = await planUpload(
      s.file,
      "x.wav",
      input(s, rows, null),
      { zeroRuns: [], energy: s.scan.energy, proposed: [] },
      [],
    );
    expect(none.records.every((r) => r.excluded)).toBe(true);
  });
});

describe("archive of the raw session file (work order 02, test 7)", () => {
  it("stores the untouched session WAV whose hash matches the input", async () => {
    const s = await scanFixture();
    expect(s.scan.sha256).toBe(sha(s.fx.bytes));
    const store = new MemoryStore();
    const plan = await importInto(store, s, input(s, parseManifestCsv(FIXTURE_MANIFEST).rows));
    const raw = (await getBytes(store, "sessions-raw/C1_26_MIDS_S1.wav"))!;
    expect(sha(raw)).toBe(sha(s.fx.bytes));
    expect(raw.length).toBe(s.fx.bytes.length);
    const rec = JSON.parse(
      new TextDecoder().decode((await getBytes(store, paths.sessionImport("C1_26_MIDS_S1")))!),
    );
    expect(rec.rawSha256).toBe(sha(s.fx.bytes));
    expect(rec.derivedCopies).toEqual([]);
    expect(rec.pairs.map((p: { sessionId: string }) => p.sessionId)).toEqual(
      plan.records.map((r) => r.id),
    );
    expect(plan.items.at(-1)!.pathname).toBe("sessions-raw/C1_26_MIDS_S1.json");
    for (const r of plan.records)
      expect((r as SessionRecord).source!.rawSha256).toBe(sha(s.fx.bytes));
  });
});

describe("segment edits", () => {
  const segs = proposeSegments(
    [
      { start: 0, end: 100 },
      { start: 200, end: 300 },
      { start: 400, end: 500 },
    ],
    600,
  );

  it("proposes a segment between runs and after the last run", () => {
    expect(segs.map(({ start, end }) => [start, end])).toEqual([
      [100, 200],
      [300, 400],
      [500, 600],
    ]);
    expect(proposeSegments([], 50).map(({ start, end }) => [start, end])).toEqual([[0, 50]]);
  });

  it("moves a boundary and keeps it clear of the neighbours", () => {
    expect(moveBoundary(segs, 1, "start", 150, 600)[1].start).toBe(200);
    expect(moveBoundary(segs, 1, "start", 250, 600)[1].start).toBe(250);
    expect(moveBoundary(segs, 1, "end", 1000, 600)[1].end).toBe(500);
    expect(moveBoundary(segs, 1, "end", 10, 600)[1].end).toBe(301);
    expect(moveBoundary(segs, 2, "end", 1000, 600)[2].end).toBe(600);
  });

  it("merges, splits, and removes", () => {
    const m = mergeWithNext(segs, 0);
    expect(m.map(({ start, end }) => [start, end])).toEqual([
      [100, 400],
      [500, 600],
    ]);
    expect(mergeWithNext(segs, 2)).toBe(segs);
    const sp = splitAt(segs, 1, 350);
    expect(sp.map(({ start, end }) => [start, end])).toEqual([
      [100, 200],
      [300, 350],
      [350, 400],
      [500, 600],
    ]);
    expect(splitAt(segs, 1, 300)).toBe(segs);
    expect(removeSegment(segs, 0).map((x) => x.start)).toEqual([300, 500]);
    expect(segmentsValid(sp, 600)).toBe(true);
    expect(segmentsValid([{ key: "a", start: 5, end: 5 }], 600)).toBe(false);
  });

  it("suggests a split in the longest quiet stretch", () => {
    const loud = -10;
    const ch = Array.from({ length: 30 }, (_, k) => (k >= 12 && k < 18 ? -80 : loud));
    const at = suggestSplit({ key: "a", start: 0, end: 30 * 960 }, [ch, ch], 960);
    expect(at).toBe(15 * 960);
  });
});

describe("manifest CSV", () => {
  it("parses the fixture manifest", () => {
    expect(parseManifestCsv(FIXTURE_MANIFEST)).toEqual({
      rows: [
        { order: 1, leftId: "S01", rightId: "S02" },
        { order: 2, leftId: "S04", rightId: "S03" },
        { order: 3, leftId: "S05", rightId: "S06" },
      ],
      problems: [],
    });
  });

  it("names each problem by line", () => {
    const r = parseManifestCsv("﻿order,left_id,right_id\r\n1,S01\r\n2,S0 2,S03\r\n2,S04,S05\r\n");
    expect(r.problems).toEqual([
      "Line 2 has 2 columns; it needs 3.",
      "Row 1: the left participant ID S0 2 may hold only letters, digits, - and _.",
      "Row 2: order 2 appears twice.",
    ]);
    expect(parseManifestCsv("pair,a,b\n1,x,y").problems[0]).toMatch(
      /^Line 1 must read order,left_id,right_id/,
    );
  });
});

describe("recompute with patterns added after pass two (work order 02, item 9)", () => {
  it("updates target counts from the exam, keeps the old measurements, and leaves the transcript", async () => {
    const s = await scanFixture();
    const store = new MemoryStore();
    const plan = await importInto(store, s, input(s, parseManifestCsv(FIXTURE_MANIFEST).rows));
    const id = plan.records[0].id;
    await store.put(
      paths.exam(EXAM.id),
      JSON.stringify({ ...EXAM, title: "Midterm", course: "", unit: "", prompt: "" }),
    );
    const words = say("I stay home because it rains because yes", 100, 0);
    await runPass2(store, id, new MockBatch(async () => words));
    const hits = async () =>
      (
        JSON.parse(new TextDecoder().decode((await getBytes(store, paths.measurements(id, 2)))!))
          .features as { featureId: string; participant: string; value: number }[]
      ).find((f) => f.featureId === "target_structure_hits" && f.participant === "A")!.value;
    expect(await hits()).toBe(0);
    const transcriptBefore = await getBytes(store, paths.transcript(id, 2));

    await store.put(
      paths.exam(EXAM.id),
      JSON.stringify({
        ...EXAM,
        title: "Midterm",
        course: "",
        unit: "",
        prompt: "",
        targetPatterns: ["because"],
      }),
    );
    const out = await recomputeStored(store, id);
    expect(await hits()).toBe(2);
    expect(out.record.config.targetPatterns).toEqual(["because"]);
    expect(out.record.events.at(-1)).toMatchObject({
      type: "recompute",
      detail: { targetPatterns: { before: [], after: ["because"] } },
    });
    expect(await getBytes(store, out.previous)).not.toBeNull();
    expect(await getBytes(store, paths.transcript(id, 2))).toEqual(transcriptBefore);
    const stored = JSON.parse(
      new TextDecoder().decode((await getBytes(store, paths.session(id)))!),
    );
    expect(validateSession(stored).errors).toEqual([]);
  });
});

describe("session list and download", () => {
  it("groups file imports by label and zips each pair's documents and CSV rows", async () => {
    const s = await scanFixture();
    const store = new MemoryStore();
    const roster = ROSTER.map((r) =>
      r.participantId === "S03" ? { ...r, consentStatus: "declined" as const } : r,
    );
    const plan = await importInto(
      store,
      s,
      input(s, parseManifestCsv(FIXTURE_MANIFEST).rows, roster),
    );
    for (const id of pass2Queue(plan.records).run) {
      await runPass2(store, id, new MockBatch(async () => say("hello there friend", 100, 0)));
    }
    const list = await listSessions(store);
    expect(list.map((x) => [x.id, x.captureMode, x.sessionLabel, x.status])).toEqual([
      ["C1_26_MIDS_S1-P01", "file-import", "C1_26_MIDS_S1", "pass two done"],
      ["C1_26_MIDS_S1-P02", "file-import", "C1_26_MIDS_S1", "excluded: consent"],
      ["C1_26_MIDS_S1-P03", "file-import", "C1_26_MIDS_S1", "pass two done"],
    ]);
    const zip = unzipSync((await buildSessionDownload(store, "C1_26_MIDS_S1"))!);
    expect(Object.keys(zip).sort()).toEqual([
      "C1_26_MIDS_S1-P01-A-S01.docx",
      "C1_26_MIDS_S1-P01-B-S02.docx",
      "C1_26_MIDS_S1-P03-A-S05.docx",
      "C1_26_MIDS_S1-P03-B-S06.docx",
      "C1_26_MIDS_S1-long.csv",
      "C1_26_MIDS_S1-pairs.csv",
      "C1_26_MIDS_S1-wide.csv",
    ]);
    const wide = new TextDecoder().decode(zip["C1_26_MIDS_S1-wide.csv"]).trim().split("\n");
    expect(wide).toHaveLength(5);
    expect(new TextDecoder().decode(zip["C1_26_MIDS_S1-pairs.csv"])).toContain(
      "2,C1_26_MIDS_S1-P02,S04,S03,excluded: consent",
    );
    expect(await buildSessionDownload(store, "nothing")).toBeNull();
  });
});
