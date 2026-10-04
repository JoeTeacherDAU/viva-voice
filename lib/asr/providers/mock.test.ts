import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "@/lib/analysis/types";
import { MockTranscriber } from "./mock";

const w = (word: string, startMs: number, endMs: number, channel: 0 | 1): Word => ({
  word,
  punctuatedWord: word,
  startMs,
  endMs,
  confidence: 0.9,
  channel,
  isFinal: true,
  pass: 2,
  removedAsCrosstalk: false,
  speakerLabel: channel === 0 ? "A" : "B",
});

const words = [
  w("we", 1000, 1200, 0),
  w("went", 1240, 1500, 0),
  w("there", 2500, 2800, 0),
  w("nice", 1300, 1600, 1),
];

describe("MockTranscriber", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits interims word by word, then finals per segment", async () => {
    const t = new MockTranscriber(words, { originMs: 1000 });
    const batches: Word[][] = [];
    t.onWords((b) => batches.push(b));
    await t.connect({ channelMap: { "0": "A", "1": "B" } });

    vi.advanceTimersByTime(200); // fixture 1200: "we" ends
    expect(batches).toHaveLength(1);
    expect(batches[0].map((x) => [x.word, x.isFinal])).toEqual([["we", false]]);

    vi.advanceTimersByTime(300); // fixture 1500: "went" ends
    expect(batches.at(-1)!.map((x) => x.word)).toEqual(["we", "went"]);

    vi.advanceTimersByTime(300); // fixture 1800: finals for the first A segment
    const finals = batches.filter((b) => b.every((x) => x.isFinal));
    expect(finals.map((b) => b.map((x) => x.word))).toContainEqual(["we", "went"]);

    vi.advanceTimersByTime(5000);
    const allFinal = batches.filter((b) => b.every((x) => x.isFinal)).flat();
    expect(allFinal.map((x) => x.word).sort()).toEqual(["nice", "there", "we", "went"]);
    expect(allFinal.every((x) => x.pass === 1)).toBe(true);
  });

  it("labels channels from the channel map", async () => {
    const t = new MockTranscriber(words, { originMs: 1000, speed: 10 });
    const got: Word[] = [];
    t.onWords((b) => got.push(...b));
    await t.connect({ channelMap: { "0": "B", "1": "A" } });
    vi.runAllTimers();
    expect(got.find((x) => x.word === "nice")!.speakerLabel).toBe("A");
    expect(got.find((x) => x.word === "we")!.speakerLabel).toBe("B");
  });

  it("stops emitting after close and reports open and close events", async () => {
    const t = new MockTranscriber(words, { originMs: 1000 });
    const events: string[] = [];
    const got: Word[][] = [];
    t.onEvent((e) => events.push(e.type));
    t.onWords((b) => got.push(b));
    await t.connect({ channelMap: { "0": "A", "1": "B" } });
    t.sendFrames(new ArrayBuffer(6400));
    expect(t.framesBytes).toBe(6400);
    await t.close();
    vi.runAllTimers();
    expect(got).toHaveLength(0);
    expect(events).toEqual(["open", "close"]);
  });
});
