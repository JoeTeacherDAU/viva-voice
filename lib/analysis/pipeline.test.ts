import { describe, expect, it } from "vitest";
import { ROLLING_FEATURES, run } from "./pipeline";
import { say, w } from "./testutil";
import { DEFAULT_CONFIG } from "./types";

const markers = { startMs: 0, stopMs: 30000 };
const words = [
  ...say("so what did you do on the weekend?", 500, 0),
  ...say("I went to the beach with my sister.", 3000, 1),
  ...say("that sounds fun.", 6000, 0),
  ...say("it was cold but we had a good time.", 12500, 1),
];

describe("pipeline.run", () => {
  it("adds rolling 10-second windows for the four live features", () => {
    const r = run(words, null, DEFAULT_CONFIG, null, { pass: 2, markers });
    const windows = new Set(r.features.map((f) => f.window));
    expect([...windows].sort()).toEqual(["full", "roll10:0", "roll10:10000", "roll10:20000"]);
    const rollingIds = new Set(
      r.features.filter((f) => f.window !== "full").map((f) => f.featureId),
    );
    expect([...rollingIds].sort()).toEqual([...ROLLING_FEATURES].sort());
    const firstB = r.features.find(
      (f) => f.featureId === "speech_rate_wpm" && f.participant === "B" && f.window === "roll10:0",
    );
    expect(firstB!.value).toBeCloseTo(8 / (10000 / 60000));
  });

  it("skips rolling windows on request", () => {
    const r = run(words, null, DEFAULT_CONFIG, null, { pass: 2, markers, rolling: false });
    expect(r.features.every((f) => f.window === "full")).toBe(true);
  });

  it("measures only final words in pass one", () => {
    const withInterim = [...words, w("extra", 20000, 20200, 0, { isFinal: false })];
    const p1 = run(withInterim, null, DEFAULT_CONFIG, null, { pass: 1, markers, rolling: false });
    const raw = p1.features.find(
      (f) => f.featureId === "speech_rate_raw_wpm" && f.participant === "A",
    );
    expect(raw!.value).toBeCloseTo(11 / 0.5);
    expect(p1.features.find((f) => f.featureId === "false_start_count")!.value).toBeNull();
  });

  it("labels students from the channel map", () => {
    const r = run(words, null, DEFAULT_CONFIG, null, {
      pass: 2,
      markers,
      channelMap: { "0": "B", "1": "A" },
      rolling: false,
    });
    const turnsA = r.features.find((f) => f.featureId === "turn_count" && f.participant === "A");
    expect(turnsA!.value).toBe(2);
    expect(r.turns[0].participant).toBe("B");
    expect(r.words.find((x) => x.channel === 0)!.speakerLabel).toBe("B");
  });

  it("accepts energy as a frame list and reports quality", () => {
    const frames = [
      { atMs: 500, channel: 0 as const, dbfs: -10 },
      { atMs: 500, channel: 1 as const, dbfs: -11 },
    ];
    const r = run(words, frames, DEFAULT_CONFIG, null, { pass: 2, markers, rolling: false });
    expect(r.quality.speechFrames).toBe(1);
    expect(r.quality.unattributedRatio).toBe(1);
    expect(r.pipelineVersion).toBe("1.0.0");
  });

  it("reports null pass agreement without pass-one features", () => {
    const r = run(words, null, DEFAULT_CONFIG, null, { pass: 2, markers, rolling: false });
    expect(r.features.find((f) => f.featureId === "pass_agreement_speech_rate")!.value).toBeNull();
  });
});
