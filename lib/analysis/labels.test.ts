import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pauseAgreement, silentRuns } from "./acoustic";
import { run } from "./pipeline";
import { say, w } from "./testutil";
import {
  DEFAULT_CONFIG,
  type EnergyTrack,
  type SessionRecord,
  type Turn,
  type Word,
} from "./types";

const LABELS = [
  "removedAsCrosstalk",
  "inWindow",
  "isFiller",
  "isRepetition",
  "isBackchannel",
  "inGap",
] as const;

describe("labels on every word (work order 01, section 2)", () => {
  it("returns every input word, labelled, for every golden fixture and pass", () => {
    for (const name of ["balanced", "asymmetric", "gappy"]) {
      const dir = join(__dirname, "../../fixtures/golden", name);
      const words = JSON.parse(readFileSync(join(dir, "words.json"), "utf8")) as Word[];
      const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionRecord;
      const energy = JSON.parse(readFileSync(join(dir, "energy.json"), "utf8")) as EnergyTrack;
      for (const pass of [1, 2] as const) {
        const r = run(words, energy, session.config, null, {
          pass,
          markers: session.markers as { startMs: number; stopMs: number },
          events: session.events,
          rolling: false,
        });
        expect(r.words, `${name} pass ${pass}`).toHaveLength(words.length);
        for (const x of r.words)
          for (const l of LABELS) expect(typeof x[l], `${name} ${l}`).toBe("boolean");
      }
    }
  });

  it("labels window, gap, filler, repetition, backchannel, and cross-talk words without deleting any", () => {
    const words = [
      w("early", 0, 200, 0),
      ...say("I uh went went home", 1000, 0),
      w("yeah", 2500, 2700, 1),
      ...say("and then", 3000, 0),
      w("lost", 5100, 5300, 0),
      w("late", 30000, 30200, 0),
    ];
    const r = run(words, null, DEFAULT_CONFIG, null, {
      pass: 1,
      markers: { startMs: 500, stopMs: 20000 },
      events: [{ type: "gap", atMs: 5000, detail: { startMs: 5000, endMs: 6000 } }],
      rolling: false,
    });
    const by = (t: string) => r.words.find((x) => x.word === t)!;
    expect(r.words).toHaveLength(words.length);
    expect(by("early").inWindow).toBe(false);
    expect(by("late").inWindow).toBe(false);
    expect(by("lost").inGap).toBe(true);
    expect(by("uh").isFiller).toBe(true);
    expect(r.words.filter((x) => x.word === "went").map((x) => x.isRepetition)).toEqual([
      false,
      true,
    ]);
    expect(by("yeah").isBackchannel).toBe(true);
    expect(by("home").isBackchannel || by("home").isRepetition || by("home").isFiller).toBe(false);
  });

  it("reports long pauses inside a turn instead of splitting it", () => {
    const words = [...say("we went", 0, 0), ...say("there", 3000, 0)];
    const r = run(words, null, DEFAULT_CONFIG, null, {
      pass: 2,
      markers: { startMs: 0, stopMs: 10000 },
      rolling: false,
    });
    expect(r.turns).toHaveLength(1);
    expect(r.longPauses).toEqual([
      { participant: "A", startMs: 440, endMs: 3000, durationMs: 2560 },
    ]);
    expect(
      r.features.find((f) => f.featureId === "long_pause_count" && f.participant === "A")!.value,
    ).toBe(1);
  });
});

describe("acoustic silences", () => {
  const turn: Turn = {
    channel: 0,
    participant: "A",
    words: [],
    startMs: 0,
    endMs: 200,
  };
  // Frames: voiced, voiced, silent (floor), bleed (partner louder), voiced, overlap, silent, silent, voiced, voiced
  const track: EnergyTrack = {
    frameMs: 20,
    startMs: 0,
    channels: [
      [-10, -10, -90, -29, -10, -9, -90, -95, -12, -12],
      [-30, -30, -95, -9, -30, -9, -95, -95, -30, -30],
    ],
  };
  it("finds silent runs inside a turn, counting partner bleed as silence and overlap as voice", () => {
    expect(silentRuns(track, 0, [turn], 6, -60)).toEqual([
      { startMs: 40, endMs: 80 },
      { startMs: 120, endMs: 160 },
    ]);
    expect(silentRuns(track, 0, [turn], 6, -60, [{ startMs: 40, endMs: 60 }])).toEqual([
      { startMs: 60, endMs: 80 },
      { startMs: 120, endMs: 160 },
    ]);
    expect(silentRuns(null, 0, [turn], 6, -60)).toEqual([]);
  });
  it("scores agreement by half-coverage and returns null without pauses or energy", () => {
    const p = (startMs: number, endMs: number) =>
      ({
        participant: "A" as const,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        afterWord: w("x", 0, 1),
        boundary: "mid" as const,
      }) as never;
    const runs = [{ startMs: 100, endMs: 300 }];
    expect(pauseAgreement([p(100, 300), p(200, 400), p(260, 500)], runs, true)).toBeCloseTo(2 / 3);
    expect(pauseAgreement([], runs, true)).toBeNull();
    expect(pauseAgreement([p(100, 300)], runs, false)).toBeNull();
  });
});

describe("floor labels on backchannel candidates", () => {
  // A asks, B answers "okay" in a 2,000 ms silence, A resumes; then B says
  // "mhmm" inside a 500 ms pause of A's, and "yeah" while A is talking.
  const words = [
    ...say("are you ready?", 0, 0),
    w("okay.", 1580, 1840, 1),
    ...say("good we start now", 2680, 0),
    w("mhmm", 3800, 3960, 1),
    ...say("and then", 4200, 0),
    w("yeah", 4300, 4400, 1),
    ...say("more words here", 5000, 0),
  ];
  const runWith = (cfg: Partial<typeof DEFAULT_CONFIG>) =>
    run(words, null, { ...DEFAULT_CONFIG, ...cfg }, null, {
      pass: 2,
      markers: { startMs: 0, stopMs: 10000 },
      rolling: false,
    });

  it("labels each candidate word, and only candidate words", () => {
    const r = runWith({});
    const by = (t: string) => r.words.find((x) => x.word === t)!;
    expect(by("okay")).toMatchObject({
      overlapsPartner: false,
      partnerSilenceMs: 2680 - 680,
      partnerResumesNext: true,
      floorClass: "standalone_turn",
    });
    expect(by("mhmm")).toMatchObject({
      overlapsPartner: false,
      floorClass: "backchannel",
      partnerResumesNext: true,
    });
    expect(by("mhmm").partnerSilenceMs).toBeLessThan(1500);
    expect(by("yeah")).toMatchObject({
      overlapsPartner: true,
      partnerSilenceMs: null,
      floorClass: "backchannel",
    });
    expect(by("good").floorClass).toBeUndefined();
    const count = (P: string) =>
      r.features.find((f) => f.featureId === "open_floor_response_count" && f.participant === P)!
        .value;
    expect(count("B")).toBe(1);
    expect(count("A")).toBe(0);
  });

  it("labels a token that opens or sits inside a longer own turn as turn_part, which never counts", () => {
    const r = run(
      [
        ...say("so what now?", 0, 0),
        ...say("yeah, I think that's really right.", 2500, 1),
        ...say("good", 6000, 0),
      ],
      null,
      DEFAULT_CONFIG,
      null,
      { pass: 2, markers: { startMs: 0, stopMs: 10000 }, rolling: false },
    );
    for (const t of ["yeah", "really", "right"])
      expect(r.words.find((x) => x.word === t)!.floorClass).toBe("turn_part");
    expect(
      r.features.find((f) => f.featureId === "open_floor_response_count" && f.participant === "B")!
        .value,
    ).toBe(0);
  });

  it("classifies by floorLapseMs, not by turnThresholdMs", () => {
    const cls = (cfg: Partial<typeof DEFAULT_CONFIG>) =>
      runWith(cfg).words.find((x) => x.word === "okay")!.floorClass;
    expect(cls({ turnThresholdMs: 5000 })).toBe("standalone_turn");
    expect(cls({ floorLapseMs: 2500 })).toBe("backchannel");
    const r = runWith({ floorLapseMs: 2500 });
    expect(
      r.features.find((f) => f.featureId === "open_floor_response_count" && f.participant === "B")!
        .value,
    ).toBe(0);
  });
});
