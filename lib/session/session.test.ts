import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run as realRun } from "@/lib/analysis/pipeline";
import { DEFAULT_CONFIG, type SessionRecord, type Word } from "@/lib/analysis/types";
import type { Transcriber, TranscriberEvent } from "@/lib/asr/types";
import { LiveSession, RECOMPUTE_MS, WATCHDOG_MS, type LiveView } from "./controller";
import { reduce } from "./state";
import { TalkTimeEstimator } from "./talktime";

const base: SessionRecord = {
  id: "s1",
  examId: "e1",
  state: "setup",
  participantIds: { A: "P1", B: "P2" },
  channelMap: { "0": "A", "1": "B" },
  config: { ...DEFAULT_CONFIG, durationMs: 60000, targetPatterns: ["used to"] },
  markers: { startMs: null, stopMs: null },
  events: [],
  instructorLiveScore: null,
  passes: {},
  pipelineVersion: "1.0.0",
  deepgramModel: "nova-3",
  firmware: { tx: "x", rx: "y" },
  createdAt: "2026-10-04T00:00:00.000Z",
};

const word = (
  text: string,
  startMs: number,
  endMs: number,
  channel: 0 | 1,
  isFinal = true,
): Word => ({
  word: text.toLowerCase().replace(/[^a-z']/g, ""),
  punctuatedWord: text,
  startMs,
  endMs,
  confidence: 0.9,
  channel,
  isFinal,
  pass: 1,
  removedAsCrosstalk: false,
  speakerLabel: channel === 0 ? "A" : "B",
});

describe("session reducer", () => {
  it("moves setup -> live -> closing -> done and records markers", () => {
    let r = reduce(base, { type: "start", atMs: 500 });
    expect(r.state).toBe("live");
    expect(r.markers).toEqual({ startMs: 500, stopMs: null });
    expect(reduce(r, { type: "start", atMs: 900 })).toBe(r);
    r = reduce(r, { type: "stop", atMs: 60500 });
    expect(r.state).toBe("closing");
    expect(r.markers).toEqual({ startMs: 500, stopMs: 60500 });
    r = reduce(r, { type: "done" });
    expect(r.state).toBe("done");
    expect(r.events.map((e) => e.type)).toEqual(["start", "stop"]);
    expect(reduce(base, { type: "done" })).toBe(base);
    expect(reduce(base, { type: "stop", atMs: 1 })).toBe(base);
  });

  it("stores the first score timestamp and the latest value (ruling R4)", () => {
    let r = reduce(base, { type: "start", atMs: 0 });
    expect(reduce(base, { type: "score", value: 3, atMs: 5 })).toBe(base);
    r = reduce(r, { type: "score", value: 3, atMs: 1000 });
    r = reduce(r, { type: "score", value: 5, atMs: 2000 });
    expect(r.instructorLiveScore).toEqual({ value: 5, atMs: 1000 });
    expect(reduce(r, { type: "score", value: 6, atMs: 3000 })).toBe(r);
    expect(reduce(r, { type: "score", value: 2.5, atMs: 3000 })).toBe(r);
    expect(r.events.filter((e) => e.type === "score")).toHaveLength(2);
  });
});

describe("talk-time estimator", () => {
  it("replaces interims and keeps finals", () => {
    const t = new TalkTimeEstimator();
    expect(t.share()).toBeNull();
    t.add([word("we", 0, 300, 0, false)]);
    t.add([word("we", 0, 300, 0, false), word("went", 340, 600, 0, false)]);
    expect(t.phonationMs(0)).toBe(560);
    t.add([word("we", 0, 300, 0), word("went", 340, 600, 0)]);
    expect(t.phonationMs(0)).toBe(560);
    t.add([word("yes", 1000, 1440, 1, false)]);
    expect(t.share()).toBeCloseTo(560 / 1000);
  });
});

class FakeTranscriber implements Transcriber {
  raws: ((m: { connectionOffsetMs: number | null; receivedAtMs: number; data: string }) => void)[] =
    [];
  onRaw(
    cb: (m: { connectionOffsetMs: number | null; receivedAtMs: number; data: string }) => void,
  ) {
    this.raws.push(cb);
  }
  words: ((w: Word[]) => void)[] = [];
  events: ((e: TranscriberEvent) => void)[] = [];
  sent = 0;
  closed = false;
  async connect() {}
  sendFrames() {
    this.sent++;
  }
  onWords(cb: (w: Word[]) => void) {
    this.words.push(cb);
  }
  onEvent(cb: (e: TranscriberEvent) => void) {
    this.events.push(cb);
  }
  async close() {
    this.closed = true;
  }
  emitWords(w: Word[]) {
    this.words.forEach((cb) => cb(w));
  }
  emitEvent(e: TranscriberEvent) {
    this.events.forEach((cb) => cb(e));
  }
}

describe("LiveSession", () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 2000;
  });
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const tr = new FakeTranscriber();
    // Wraps the real pipeline so the view gets real numbers and calls are countable.
    const run = vi.fn(realRun);
    const persisted: SessionRecord[] = [];
    const s = new LiveSession(base, {
      transcriber: tr,
      now: () => now,
      run,
      persist: (r) => void persisted.push(r),
    });
    let view: LiveView | null = null;
    s.subscribe((v) => (view = v));
    return { s, tr, run, persisted, view: () => view! };
  };

  const advance = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it("recomputes every 10 seconds after Start and once at Stop", async () => {
    const { s, tr, run } = make();
    await s.start();
    expect(s.record.markers.startMs).toBe(2000);
    advance(RECOMPUTE_MS - 1);
    expect(run).toHaveBeenCalledTimes(0);
    advance(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][4].markers).toEqual({ startMs: 2000, stopMs: 12000 });
    advance(RECOMPUTE_MS);
    expect(run).toHaveBeenCalledTimes(2);
    const res = await s.stop();
    expect(run).toHaveBeenCalledTimes(3);
    expect(tr.closed).toBe(true);
    expect(res!.record.state).toBe("closing");
    expect(res!.record.markers).toEqual({ startMs: 2000, stopMs: 22000 });
    advance(RECOMPUTE_MS * 3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("keeps the index hidden until a score tap, then reveals values", async () => {
    const { s, tr, view } = make();
    await s.start();
    // Session-clock words: 1 s after Start becomes capture time 3000.
    tr.emitWords([
      word("We", 1000, 1200, 0),
      word("used", 1240, 1440, 0),
      word("to", 1480, 1600, 0),
      word("go.", 1640, 1900, 0),
    ]);
    tr.emitWords([word("Nice.", 2500, 2800, 1)]);
    expect(s.words()[0].startMs).toBe(3000);
    expect(view().targets).toEqual({ A: 1, B: 0 });
    advance(RECOMPUTE_MS);
    expect(view().revealed).toBe(false);
    expect(view().index.A?.speechRate).toBeCloseTo(4 / (10000 / 60000));
    s.score(4);
    expect(view().revealed).toBe(true);
    expect(view().score).toBe(4);
  });

  it("archives every raw message as one JSON line and returns every final word labelled", async () => {
    const { s, tr } = make();
    tr.raws.forEach((cb) => cb({ connectionOffsetMs: 0, receivedAtMs: 0, data: "before start" }));
    await s.start();
    tr.raws.forEach((cb) =>
      cb({ connectionOffsetMs: 0, receivedAtMs: 100, data: '{"type":"Metadata"}' }),
    );
    tr.emitWords([word("We", 100, 300, 0, false)]);
    tr.emitWords([word("We", 100, 300, 0), word("we", 340, 500, 0), word("went.", 540, 800, 0)]);
    advance(5000);
    const res = await s.stop();
    const lines = res!.rawJsonl
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        captureStartMs: 2000,
        connectionOffsetMs: 0,
        receivedAtMs: 100,
        message: '{"type":"Metadata"}',
      },
    ]);
    expect(res!.words).toHaveLength(3);
    expect(res!.words.map((w) => w.isRepetition)).toEqual([false, true, false]);
  });

  it("sends audio only while live", async () => {
    const { s, tr } = make();
    s.sendAudio(new ArrayBuffer(8));
    await s.start();
    s.sendAudio(new ArrayBuffer(8));
    await s.stop();
    s.sendAudio(new ArrayBuffer(8));
    expect(tr.sent).toBe(1);
  });

  it("raises amber on reconnect, red on fatal failure, and logs gaps in capture time", async () => {
    const { s, tr, view } = make();
    await s.start();
    tr.emitEvent({ type: "reconnecting", atMs: 100 });
    expect(view().fault).toBe("warn");
    tr.emitEvent({ type: "reconnected", atMs: 900 });
    tr.emitEvent({ type: "gap", atMs: 100, detail: { startMs: 100, endMs: 900 } });
    expect(view().fault).toBe("clear");
    expect(s.record.events.find((e) => e.type === "gap")?.detail).toEqual({
      startMs: 2100,
      endMs: 2900,
    });
    tr.emitEvent({ type: "error", atMs: 1000, detail: { fatal: true } });
    expect(view().fault).toBe("fault");
  });

  it("raises red when a channel sits at the noise floor for 10 seconds, and on a device fault", async () => {
    const { s, view } = make();
    await s.start();
    for (let t = 0; t < WATCHDOG_MS; t += 1000) {
      s.onEnergy(0, now, -30);
      s.onEnergy(1, now, -100);
      advance(1000);
    }
    expect(view().fault).toBe("fault");
    expect(view().faultReason).toMatch(/Channel 2/);
    s.onEnergy(1, now, -40);
    advance(250);
    expect(view().fault).toBe("clear");
    s.setDeviceFault("The input device disconnected");
    expect(view().fault).toBe("fault");
    expect(s.record.events.filter((e) => e.type === "fault")).toHaveLength(2);
  });

  it("stops by itself when the configured duration runs out", async () => {
    const { s } = make();
    await s.start();
    for (let t = 0; t < 60000; t += 1000) {
      s.onEnergy(0, now, -30);
      s.onEnergy(1, now, -30);
      advance(1000);
    }
    advance(250);
    await vi.waitFor(() => expect(s.record.state).toBe("closing"));
    expect(s.record.markers.stopMs! - s.record.markers.startMs!).toBeGreaterThanOrEqual(60000);
  });
});
