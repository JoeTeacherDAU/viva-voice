import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendPcm,
  deleteSession,
  getArtifact,
  getSession,
  listSessions,
  PcmWriter,
  putArtifact,
  putSession,
  readPcm,
  resetDbForTests,
} from "@/lib/storage/local";
import { DEFAULT_CONFIG, type SessionRecord } from "@/lib/analysis/types";
import { blockingReasons, browserBlock, captureConstraints } from "./devices";
import {
  Decimator,
  EnergyFramer,
  floatToInt16,
  interleaveInt16,
  lowpassTaps,
  rmsDbfs,
} from "./dsp";
import { buildStereoWav, parseWav, splitMonoWavs, wavFromStore, wavHeader } from "./wav";

const sine = (f: number, n: number, amp = 0.5, rate = 48000) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));

describe("dsp", () => {
  it("converts RMS to dBFS with a floor", () => {
    expect(rmsDbfs(sine(500, 960))).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 3);
    expect(rmsDbfs(new Float32Array(960))).toBe(-100);
    expect(rmsDbfs([])).toBe(-100);
  });

  it("frames 20 ms blocks across render quanta", () => {
    const f = new EnergyFramer();
    const out: [number, number][] = [];
    const x = sine(500, 960 * 3);
    for (let i = 0; i < x.length; i += 128)
      f.push(x.subarray(i, i + 128), (k, d) => out.push([k, d]));
    expect(out.map((o) => o[0])).toEqual([0, 1, 2]);
    out.forEach((o) => expect(o[1]).toBeCloseTo(-9.03, 1));
  });

  it("designs a unity-gain low-pass", () => {
    const t = lowpassTaps(63, 7200, 48000);
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("decimates 48 kHz to 16 kHz, keeping a 1 kHz tone and removing a 12 kHz tone", () => {
    const run = (f: number) => {
      const d = new Decimator();
      const x = sine(f, 48000);
      const parts: Float32Array[] = [];
      for (let i = 0; i < x.length; i += 128) parts.push(d.process(x.subarray(i, i + 128)));
      const y = Float32Array.from(parts.flatMap((p) => [...p]));
      expect(y.length).toBe(16000);
      return rmsDbfs(y.subarray(1000));
    };
    expect(run(1000)).toBeCloseTo(-9.03, 0);
    expect(run(12000)).toBeLessThan(-60);
  });

  it("converts and interleaves 16-bit samples", () => {
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(2)).toBe(32767);
    expect([...interleaveInt16([0.5, -0.5], [0, 1])]).toEqual([16384, 0, -16384, 32767]);
  });
});

describe("wav", () => {
  const chunk = (frames: number, l: number, r: number) => {
    const s = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      s[2 * i] = l;
      s[2 * i + 1] = r;
    }
    return s.buffer;
  };

  it("builds a 48 kHz 16-bit stereo WAV that parses back", async () => {
    const blob = buildStereoWav([chunk(4800, 100, -100), chunk(4800, 200, -200)]);
    const info = parseWav(await blob.arrayBuffer());
    expect(info).toMatchObject({
      format: 1,
      channels: 2,
      sampleRate: 48000,
      bitsPerSample: 16,
      frames: 9600,
    });
  });

  it("splits into two mono WAVs", async () => {
    const [a, b] = splitMonoWavs([chunk(10, 7, -7)]);
    const ab = await a.arrayBuffer();
    const info = parseWav(ab);
    expect(info.channels).toBe(1);
    expect(info.frames).toBe(10);
    expect(new Int16Array(ab, 44)[0]).toBe(7);
    expect(new Int16Array(await b.arrayBuffer(), 44)[0]).toBe(-7);
  });

  it("parses the golden fixture WAV and rejects junk", () => {
    const buf = readFileSync(join(__dirname, "../../fixtures/golden/gappy/stereo.wav"));
    const info = parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(info.frames).toBe(45 * 48000); // 43 s window plus 1 s each side
    expect(() => parseWav(new ArrayBuffer(12))).toThrow();
    expect(() => parseWav(wavHeader(0).slice(0, 12))).toThrow(/data/);
  });
});

describe("device rules", () => {
  it("passes a clean stereo device and blocks each fault", () => {
    const clean = {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
    };
    expect(blockingReasons(clean)).toEqual([]);
    expect(blockingReasons({ ...clean, channelCount: 1 })[0]).toMatch(/two/);
    expect(blockingReasons({ ...clean, echoCancellation: true })).toHaveLength(1);
    expect(blockingReasons({ ...clean, noiseSuppression: true })).toHaveLength(1);
    expect(blockingReasons({ ...clean, autoGainControl: true })).toHaveLength(1);
    expect(blockingReasons({ ...clean, sampleRate: 44100 })).toHaveLength(1);
    expect(blockingReasons({})[0]).toMatch(/unknown/);
  });

  it("asks for the exact PLAN.md constraints", () => {
    const c = captureConstraints("abc").audio as MediaTrackConstraints;
    expect(c).toMatchObject({
      deviceId: { exact: "abc" },
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
    });
  });

  it("allows Chrome and Chromium only", () => {
    expect(browserBlock({ brands: [{ brand: "Google Chrome" }] })).toBeNull();
    expect(browserBlock({ brands: [{ brand: "Chromium" }] })).toBeNull();
    expect(browserBlock(undefined, "Mozilla/5.0 HeadlessChrome/140")).toBeNull();
    expect(browserBlock({ brands: [{ brand: "Chromium" }, { brand: "Microsoft Edge" }] })).toMatch(
      /Chrome/,
    );
    expect(browserBlock(undefined, "Safari/605")).toMatch(/R5/);
  });
});

describe("IndexedDB buffer", () => {
  beforeEach(async () => {
    await resetDbForTests();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("viva");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  const rec: SessionRecord = {
    id: "s1",
    examId: "e1",
    state: "setup",
    participantIds: { A: "P1", B: "P2" },
    config: DEFAULT_CONFIG,
    markers: { startMs: null, stopMs: null },
    events: [],
    instructorLiveScore: null,
    passes: {},
    pipelineVersion: "1.0.0",
    deepgramModel: "nova-3",
    firmware: { tx: "x", rx: "y" },
    createdAt: "2026-10-04T00:00:00.000Z",
  };

  it("stores, lists, and deletes session records with their PCM", async () => {
    await putSession(rec);
    await appendPcm("s1", 0, new Int16Array([1, 2]).buffer);
    await appendPcm("s1", 1, new Int16Array([3, 4]).buffer);
    await appendPcm("s2", 0, new Int16Array([9, 9]).buffer);
    expect((await getSession("s1"))?.examId).toBe("e1");
    expect(await listSessions()).toHaveLength(1);
    expect((await readPcm("s1")).map((b) => [...new Int16Array(b)])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    await putArtifact("s1", "energy", { frameMs: 20 });
    expect(await getArtifact("s1", "energy")).toEqual({ frameMs: 20 });
    await deleteSession("s1");
    expect(await getSession("s1")).toBeUndefined();
    expect(await getArtifact("s1", "energy")).toBeUndefined();
    expect(await readPcm("s1")).toEqual([]);
    expect(await readPcm("s2")).toHaveLength(1);
  });

  it("flushes PCM every two seconds and on close, then builds the WAV", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const w = new PcmWriter("s3");
    w.push(new Int16Array([1, -1, 2, -2]).buffer);
    w.push(new Int16Array([3, -3]).buffer);
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    await w.flush(); // waits for the interval's write; nothing new is pending
    expect(await readPcm("s3")).toHaveLength(1);
    w.push(new Int16Array([4, -4]).buffer);
    await w.close();
    const info = parseWav(await (await wavFromStore("s3")).arrayBuffer());
    expect(info.frames).toBe(4);
  });
});

describe("calibration", () => {
  it("measures separation over speech frames and proposes a margin", async () => {
    const { separationDb, proposedMargin } = await import("./calibration");
    const frames: [number[], number[]] = [
      [-10, -12, -90, -11],
      [-30, -31, -95, -29],
    ];
    expect(separationDb(frames, 0)).toBeCloseTo((20 + 19 + 18) / 3);
    expect(separationDb(frames, 1)).toBeCloseTo(-19);
    expect(separationDb([[-90], [-95]], 0)).toBeNull();
    expect(proposedMargin(19, 12.2)).toBe(9);
    expect(proposedMargin(2, 30)).toBe(0);
  });
});
