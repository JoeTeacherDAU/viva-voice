import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { byTier } from "@/lib/registry";
import { PIPELINE_VERSION, run } from ".";
import type { Baseline, EnergyTrack, FeatureValue, SessionRecord, Word } from "./types";

interface Expected {
  featureId: string;
  participant: "A" | "B";
  pass: 1 | 2;
  thresholdMs: number | null;
  value: number | null;
  unit: string;
  spans?: { startMs: number; endMs: number }[];
}

const root = join(__dirname, "..", "..", "fixtures", "golden");
const load = <T>(fixture: string, file: string): T =>
  JSON.parse(readFileSync(join(root, fixture, file), "utf8")) as T;

function runFixture(name: string) {
  const words = load<Word[]>(name, "words.json");
  const energy = load<EnergyTrack>(name, "energy.json");
  const session = load<SessionRecord>(name, "session.json");
  const baseline = load<Baseline>(name, "baseline.json");
  const markers = session.markers as { startMs: number; stopMs: number };
  const common = { markers, events: session.events, channelMap: session.channelMap };
  const p1 = run(words, energy, session.config, baseline, { ...common, pass: 1 });
  const p2 = run(words, energy, session.config, baseline, {
    ...common,
    pass: 2,
    previousPass: p1.features,
  });
  return [...p1.features, ...p2.features];
}

function withinTolerance(e: Expected, got: number): boolean {
  const v = e.value as number;
  if (e.unit === "count" || e.unit === "count and spans") return got === v;
  if (e.unit === "ms") return Math.abs(got - v) <= 1;
  if (v === 0) return Math.abs(got) < 1e-9;
  return Math.abs(got - v) / Math.abs(v) <= 0.005;
}

describe.each(["balanced", "asymmetric", "gappy"])("golden fixture %s", (name) => {
  const expected = load<{ values: Expected[] }>(name, "expected.json").values;
  const features = runFixture(name);
  const find = (e: Expected): FeatureValue | undefined =>
    features.find(
      (f) =>
        f.featureId === e.featureId &&
        f.participant === e.participant &&
        f.pass === e.pass &&
        f.window === "full" &&
        f.thresholdMs === e.thresholdMs,
    );

  it.each(
    expected.map((e) => [`${e.featureId}@${e.thresholdMs ?? "-"} ${e.participant} p${e.pass}`, e]),
  )("%s", (_label, e) => {
    const got = find(e as Expected);
    const exp = e as Expected;
    expect(got, "pipeline produced no value").toBeDefined();
    if (exp.value === null) {
      expect(got!.value).toBeNull();
      return;
    }
    expect(got!.value, `expected ${exp.value}`).not.toBeNull();
    expect(withinTolerance(exp, got!.value!), `expected ${exp.value}, got ${got!.value}`).toBe(
      true,
    );
    if (exp.spans) {
      const spans = (got!.detail as { spans: { startMs: number; endMs: number }[] }).spans;
      expect(spans.map((s) => [s.startMs, s.endMs])).toEqual(
        exp.spans.map((s) => [s.startMs, s.endMs]),
      );
    }
  });

  it("covers every tier 1 feature in the registry", () => {
    const ids = new Set(features.map((f) => f.featureId));
    for (const f of byTier(1)) expect(ids.has(f.id), f.id).toBe(true);
  });
});

describe("pipeline version", () => {
  it("is exported as a semantic version", () => {
    expect(PIPELINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
