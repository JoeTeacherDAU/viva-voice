import { describe, expect, it } from "vitest";
import { compositeIndex, updateBaseline } from "./composite";
import { rejectCrosstalk } from "./crosstalk";
import { meanDbfs, toTrack } from "./energy";
import { defineFeature } from "./features/define";
import { falseStartsInTurn } from "./features/repair";
import { mattr, mtld, targetHits } from "./features/lexical";
import { gateFrames } from "./gating";
import { orthographicSyllables } from "./orthographic";
import { pausesInTurns, phonationMs, runsInTurns } from "./pauses";
import { pruneTurn } from "./prune";
import { countSyllables } from "./syllables";
import { indexed, say, w } from "./testutil";
import { hasPunctuation, isClauseFinal, tokenOf } from "./tokens";
import { analyseTurns, buildTurns, overlapIntervals } from "./turns";
import type { Baseline, EnergyTrack, Turn } from "./types";
import { effectiveWindowMs, gapsFrom, trimWords } from "./window";

const MAP = { "0": "A", "1": "B" } as const;
const set = (...xs: string[]) => new Set(xs);

describe("tokens", () => {
  it("normalises words and tests punctuation", () => {
    expect(tokenOf("Hello,")).toBe("hello");
    expect(tokenOf("Uh-huh.")).toBe("uh-huh");
    expect(tokenOf("don't")).toBe("don't");
    expect(isClauseFinal("well.")).toBe(true);
    expect(isClauseFinal("well;")).toBe(true);
    expect(isClauseFinal("well")).toBe(false);
    expect(hasPunctuation("well:")).toBe(true);
    expect(hasPunctuation("well")).toBe(false);
  });
});

describe("syllables", () => {
  it("counts vowel groups and drops a silent final e", () => {
    expect(orthographicSyllables("make")).toBe(1);
    expect(orthographicSyllables("table")).toBe(2);
    expect(orthographicSyllables("busan")).toBe(2);
    expect(orthographicSyllables("rhythm")).toBe(1);
    expect(orthographicSyllables("")).toBe(0);
  });
  it("uses the dictionary table where it disagrees with the rule", () => {
    expect(countSyllables("idea")).toBe(3);
    expect(countSyllables("piano")).toBe(3);
    expect(countSyllables("quiet")).toBe(2);
    expect(countSyllables("Daegu")).toBe(2);
  });
});

describe("energy", () => {
  it("converts frame lists to a track and averages a span", () => {
    const track = toTrack([
      { atMs: 0, channel: 0, dbfs: -10 },
      { atMs: 20, channel: 0, dbfs: -20 },
      { atMs: 0, channel: 1, dbfs: -30 },
    ])!;
    expect(track.channels[0]).toEqual([-10, -20]);
    expect(track.channels[1]).toEqual([-30, -100]);
    expect(meanDbfs(track, 0, 0, 40)).toBe(-15);
    expect(meanDbfs(track, 0, 100, 140)).toBeNull();
    expect(meanDbfs(null, 0, 0, 40)).toBeNull();
    expect(toTrack([])).toBeNull();
    expect(toTrack(null)).toBeNull();
  });
});

describe("window", () => {
  const markers = { startMs: 1000, stopMs: 11000 };
  it("reads gap events and clips them to the window", () => {
    const gaps = gapsFrom(
      [
        { type: "gap", atMs: 500, detail: { startMs: 500, endMs: 1500 } },
        { type: "fault", atMs: 2000 },
        { type: "gap", atMs: 3000, detail: { startMs: 3000, endMs: 4000 } },
        { type: "gap", atMs: 3000, detail: "bad" },
      ],
      markers,
    );
    expect(gaps).toEqual([
      { startMs: 1000, endMs: 1500 },
      { startMs: 3000, endMs: 4000 },
    ]);
    expect(effectiveWindowMs(markers, gaps)).toBe(8500);
    expect(gapsFrom(undefined, markers)).toEqual([]);
  });
  it("keeps words inside the window and outside gaps", () => {
    const words = [w("a", 900, 1100), w("b", 1200, 1400), w("c", 3100, 3300), w("d", 10900, 11100)];
    expect(trimWords(words, markers, [{ startMs: 3000, endMs: 4000 }]).map((x) => x.word)).toEqual([
      "b",
    ]);
  });
});

describe("crosstalk", () => {
  const quietTrack = (len: number, loud: 0 | 1): EnergyTrack => ({
    frameMs: 20,
    startMs: 0,
    channels: [
      new Array(len).fill(loud === 0 ? -10 : -30),
      new Array(len).fill(loud === 1 ? -10 : -30),
    ],
  });

  it("removes the later, less confident copy of a shared sequence", () => {
    const words = [
      ...say("went to busan", 1000, 0),
      w("to", 1280, 1480, 1, { confidence: 0.4 }),
      w("busan", 1520, 1720, 1, { confidence: 0.4 }),
    ];
    const { words: out, removed } = rejectCrosstalk(words, null, 6);
    expect(out.filter((x) => x.removedAsCrosstalk).map((x) => [x.word, x.channel])).toEqual([
      ["to", 1],
      ["busan", 1],
    ]);
    expect(removed).toHaveLength(1);
    expect(removed[0].reason).toBe("sequence");
  });

  it("falls back to energy when onset and confidence disagree", () => {
    // Channel 1 starts earlier but is less confident; channel 1 is louder.
    const words = [
      w("good", 1060, 1260, 0, { confidence: 0.9 }),
      w("idea", 1300, 1500, 0, { confidence: 0.9 }),
      w("good", 1000, 1200, 1, { confidence: 0.5 }),
      w("idea", 1240, 1440, 1, { confidence: 0.5 }),
    ];
    const { words: out } = rejectCrosstalk(words, quietTrack(100, 1), 6);
    expect(out.filter((x) => x.removedAsCrosstalk).every((x) => x.channel === 0)).toBe(true);
    // Without energy the earlier copy stays.
    const { words: out2 } = rejectCrosstalk(words, null, 6);
    expect(out2.filter((x) => x.removedAsCrosstalk).every((x) => x.channel === 0)).toBe(true);
  });

  it("removes a single shared token only when one channel is clearly louder", () => {
    const words = [w("yes", 1000, 1200, 0), w("yes", 1100, 1300, 1)];
    expect(rejectCrosstalk(words, quietTrack(100, 0), 6).removed[0].channel).toBe(1);
    expect(rejectCrosstalk(words, null, 6).removed).toHaveLength(0);
    const even: EnergyTrack = {
      frameMs: 20,
      startMs: 0,
      channels: [new Array(100).fill(-10), new Array(100).fill(-12)],
    };
    expect(rejectCrosstalk(words, even, 6).removed).toHaveLength(0);
  });

  it("ignores matches more than 300 ms apart", () => {
    const words = [...say("we went", 1000, 0), ...say("we went", 1400, 1)];
    expect(rejectCrosstalk(words, null, 6).removed).toHaveLength(0);
  });
});

describe("gating", () => {
  const track: EnergyTrack = {
    frameMs: 20,
    startMs: 0,
    channels: [
      [-100, -10, -10, -9, -70],
      [-100, -30, -12, -9, -100],
    ],
  };
  it("attributes, leaves unattributed, and skips silence", () => {
    const g = gateFrames(track, { startMs: 0, stopMs: 100 }, 6);
    expect(g).toEqual({
      speechFrames: 3,
      attributedFrames: [1, 0],
      unattributedFrames: 2,
      unattributedRatio: 2 / 3,
    });
  });
  it("skips frames outside the window or inside a gap", () => {
    expect(gateFrames(track, { startMs: 20, stopMs: 60 }, 6).speechFrames).toBe(2);
    expect(
      gateFrames(track, { startMs: 0, stopMs: 100 }, 6, -60, [{ startMs: 40, endMs: 80 }])
        .speechFrames,
    ).toBe(1);
    expect(gateFrames(null, { startMs: 0, stopMs: 100 }, 6).unattributedRatio).toBeNull();
  });
});

describe("prune", () => {
  const prune = (text: string) =>
    pruneTurn(indexed(say(text, 0)), set("uh", "um"), set("yeah", "okay"));
  it("drops fillers, word repetitions, bigram repetitions, and backchannel tokens", () => {
    const r = prune("I uh think the the cat yeah I think I think so");
    expect(r.kept.map((x) => x.word)).toEqual(["i", "think", "the", "cat", "i", "think", "so"]);
    expect(r.repetitions).toBe(2);
    expect(r.fillers).toBe(1);
  });
  it("counts a tripled bigram twice, not three times", () => {
    expect(prune("a b a b a b").repetitions).toBe(2);
    expect(prune("go go go").repetitions).toBe(2);
  });
});

describe("turns", () => {
  it("closes a turn on the partner's floor word or on long silence", () => {
    const words = indexed([
      ...say("one two", 0, 0),
      ...say("three", 1000, 1),
      ...say("four", 1300, 1),
      ...say("five", 3200, 1),
    ]);
    const turns = buildTurns(words, 1500, MAP);
    expect(turns.map((t) => [t.participant, t.words.map((x) => x.word).join(" ")])).toEqual([
      ["A", "one two"],
      ["B", "three four"],
      ["B", "five"],
    ]);
  });

  it("treats a backchannel inside a partner turn as a backchannel", () => {
    const words = indexed([
      ...say("I went", 0, 0),
      w("yeah", 600, 800, 1),
      ...say("home today", 1000, 0),
    ]);
    const r = analyseTurns(words, set("yeah"), 1500, MAP);
    expect(r.turns).toHaveLength(1);
    expect(r.backchannels.map((x) => x.word)).toEqual(["yeah"]);
    expect(r.transitions).toHaveLength(0);
  });

  it("treats a backchannel token outside every partner turn as a floor turn", () => {
    const words = indexed([
      ...say("are you ready", 0, 0),
      w("okay.", 2000, 2200, 1),
      ...say("good", 2600, 0),
    ]);
    const r = analyseTurns(words, set("okay"), 1500, MAP);
    expect(r.turns.map((t) => t.participant)).toEqual(["A", "B", "A"]);
    expect(r.backchannels).toHaveLength(0);
    expect(r.transitions.map((t) => t.latencyMs)).toEqual([2000 - 680, 400]);
  });

  it("reports a negative latency for an overlap and drops transitions across a gap", () => {
    const words = indexed([
      ...say("you go", 0, 0),
      ...say("me too", 380, 1),
      ...say("fine", 2000, 0),
    ]);
    const r = analyseTurns(words, set(), 1500, MAP);
    expect(r.transitions.map((t) => t.latencyMs)).toEqual([380 - 440, 2000 - 820]);
    const gapped = analyseTurns(words, set(), 1500, MAP, [{ startMs: 1000, endMs: 1500 }]);
    expect(gapped.transitions.map((t) => t.latencyMs)).toEqual([-60]);
    expect(overlapIntervals(words)).toEqual([[380, 440]]);
  });

  it("finds no overlap when the channels never coincide", () => {
    expect(overlapIntervals(indexed([...say("a b", 0, 0), ...say("c", 1000, 1)]))).toEqual([]);
  });
});

describe("pauses and runs", () => {
  const turn = (text: string): Turn => {
    // "{pN}" inserts an N ms gap before the next word.
    const words = [];
    let t = 0;
    let gap = 0;
    for (const s of text.split(" ")) {
      const m = s.match(/^\{p(\d+)\}$/);
      if (m) {
        gap = Number(m[1]);
        continue;
      }
      if (words.length) t += gap || 40;
      gap = 0;
      words.push(w(s, t, t + 200));
      t += 200;
    }
    const iw = indexed(words);
    return {
      channel: 0,
      participant: "A",
      words: iw,
      startMs: iw[0].startMs,
      endMs: iw[iw.length - 1].endMs,
    };
  };

  it("classifies pauses and subtracts them from phonation", () => {
    const t = turn("we went {p400} to busan. {p250} it was {p360} fun");
    const p200 = pausesInTurns([t], 200);
    expect(p200.map((p) => [p.durationMs, p.boundary])).toEqual([
      [400, "mid"],
      [250, "end"],
      [360, "mid"],
    ]);
    expect(pausesInTurns([t], 350)).toHaveLength(2);
    expect(phonationMs([t], 350)).toBe(t.endMs - t.startMs - 760);
    expect(phonationMs([t], 200)).toBe(t.endMs - t.startMs - 1010);
  });

  it("splits runs at pauses and counts pruned words", () => {
    const t = turn("we went {p400} to busan. {p250} it was");
    const pruned = new Set(t.words.filter((x) => x.word !== "went").map((x) => x.index));
    expect(runsInTurns([t], 200, pruned).map((r) => r.prunedCount)).toEqual([1, 2, 2]);
    expect(runsInTurns([t], 350, pruned).map((r) => r.prunedCount)).toEqual([1, 4]);
  });
});

describe("false starts", () => {
  const turnOf = (text: string): Turn => {
    const iw = indexed(say(text, 0));
    return { channel: 0, participant: "A", words: iw, startMs: 0, endMs: iw[iw.length - 1].endMs };
  };
  const fillers = set("uh", "um");
  it("counts an abandoned clause opening", () => {
    expect(falseStartsInTurn(turnOf("We uh I can go."), fillers)).toBe(1);
    expect(falseStartsInTurn(turnOf("I went home. My uh we left."), fillers)).toBe(1);
  });
  it("ignores a restart that repeats the fragment, a punctuated fragment, and a late filler", () => {
    expect(falseStartsInTurn(turnOf("We uh we can go."), fillers)).toBe(0);
    expect(falseStartsInTurn(turnOf("Yes, uh I can go."), fillers)).toBe(0);
    expect(falseStartsInTurn(turnOf("I think it is uh fine."), fillers)).toBe(0);
    expect(falseStartsInTurn(turnOf("um I can go."), fillers)).toBe(0);
    expect(falseStartsInTurn(turnOf("We uh"), fillers)).toBe(0);
  });
});

describe("lexical", () => {
  it("computes MATTR over a sliding window", () => {
    expect(mattr(["a", "b", "a", "c"], 2)).toBeCloseTo((1 + 1 + 1) / 3);
    expect(mattr(["a", "a", "a"], 2)).toBeCloseTo(0.5);
    expect(mattr(["a"], 50)).toBeNull();
  });
  it("computes MTLD with partial factors", () => {
    // Each direction: "a b a" falls to 2/3 and closes one factor; "b" leaves a zero partial.
    expect(mtld(["a", "b", "a", "b"])).toBeCloseTo(4);
    // Five tokens: one factor, then "b a" with ratio 1 adds nothing.
    expect(mtld(["a", "b", "a", "b", "a"])).toBeCloseTo(5);
    expect(mtld([])).toBeNull();
    expect(mtld(["a", "b", "c"])).toBeNull();
  });
  it("matches target patterns on word boundaries and maps spans", () => {
    const words = indexed(say("I used to play. She is used to it. unused to", 0));
    const hits = targetHits(words, ["used to", "", "would like to"]);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      pattern: "used to",
      startMs: words[1].startMs,
      endMs: words[2].endMs,
    });
  });
});

describe("composite", () => {
  const baseline: Baseline = {
    n: 12,
    components: {
      speech_rate_wpm: { mean: 100, sd: 20 },
      silent_pause_rate: { mean: 20, sd: 5 },
      mean_length_of_run: { mean: 5, sd: 1 },
    },
  };
  const weights = { silent_pause_rate: 0.5, speech_rate_wpm: 0.25, mean_length_of_run: 0.25 };
  it("weights z-scores and inverts the pause rate", () => {
    const v = compositeIndex(
      { speech_rate_wpm: 120, silent_pause_rate: 15, mean_length_of_run: 6 },
      baseline,
      weights,
      10,
    );
    expect(v).toBeCloseTo(0.5 * 1 + 0.25 * 1 + 0.25 * 1);
  });
  it("returns null below the minimum, without a baseline, with a null component, or a zero SD", () => {
    const c = { speech_rate_wpm: 120, silent_pause_rate: 15, mean_length_of_run: 6 };
    expect(compositeIndex(c, { ...baseline, n: 9 }, weights, 10)).toBeNull();
    expect(compositeIndex(c, null, weights, 10)).toBeNull();
    expect(compositeIndex({ ...c, mean_length_of_run: null }, baseline, weights, 10)).toBeNull();
    const flat = {
      ...baseline,
      components: { ...baseline.components, speech_rate_wpm: { mean: 100, sd: 0 } },
    };
    expect(compositeIndex(c, flat, weights, 10)).toBeNull();
  });
  it("updates a baseline to the sample mean and SD", () => {
    const xs = [100, 120, 80, 110];
    let b: Baseline | null = null;
    for (const x of xs)
      b = updateBaseline(b, {
        speech_rate_wpm: x,
        silent_pause_rate: x / 10,
        mean_length_of_run: null,
      });
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
    expect(b!.n).toBe(4);
    expect(b!.components.speech_rate_wpm.mean).toBeCloseTo(m);
    expect(b!.components.speech_rate_wpm.sd).toBeCloseTo(sd);
    expect(b!.components.mean_length_of_run).toEqual({ mean: 0, sd: 0 });
  });
});

describe("feature definitions", () => {
  it("refuses to register an id twice", () => {
    expect(() => defineFeature("mattr", () => [])).toThrow(/twice/);
  });
});
