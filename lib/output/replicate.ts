import { run } from "@/lib/analysis/pipeline";
import type {
  Baseline,
  EnergyTrack,
  FeatureValue,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";

export interface FeatureDiff {
  featureId: string;
  participant: string;
  window: string;
  thresholdMs: number | null;
  stored: number | null | undefined;
  fresh: number | null | undefined;
}

const key = (f: FeatureValue) => `${f.featureId}|${f.participant}|${f.window}|${f.thresholdMs}`;

/** Every feature value that differs by more than tol, or is missing on one side. */
export function diffFeatures(
  stored: FeatureValue[],
  fresh: FeatureValue[],
  tol = 1e-9,
): FeatureDiff[] {
  const a = new Map(stored.map((f) => [key(f), f]));
  const b = new Map(fresh.map((f) => [key(f), f]));
  const out: FeatureDiff[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k);
    const y = b.get(k);
    const same =
      x !== undefined &&
      y !== undefined &&
      (x.value === y.value ||
        (x.value !== null && y.value !== null && Math.abs(x.value - y.value) <= tol));
    if (!same) {
      const f = (x ?? y)!;
      out.push({
        featureId: f.featureId,
        participant: f.participant,
        window: f.window,
        thresholdMs: f.thresholdMs,
        stored: x?.value,
        fresh: y?.value,
      });
    }
  }
  return out;
}

/**
 * Replication run (build-plan P7.2): the current pipeline over the stored
 * pass-two transcript, with the baseline and pass-one features that pass two
 * used, so an unchanged pipeline reproduces the stored measurements exactly.
 */
export function replicate(input: {
  record: SessionRecord;
  words: Word[];
  energy: EnergyTrack | null;
  baseline: Baseline | null;
  pass1: FeatureValue[] | null;
}): FeatureValue[] {
  const { record: r } = input;
  if (r.markers.startMs === null || r.markers.stopMs === null)
    throw new Error("session has no markers");
  return run(input.words, input.energy, r.config, input.baseline, {
    pass: 2,
    markers: { startMs: r.markers.startMs, stopMs: r.markers.stopMs },
    channelMap: r.channelMap,
    previousPass: input.pass1,
  }).features;
}
