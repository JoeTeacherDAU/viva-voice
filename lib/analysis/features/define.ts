import type { AnalysisContext } from "../context";
import type { Participant } from "../types";

export interface RawValue {
  thresholdMs: number | null;
  value: number | null;
  detail?: unknown;
}

export type FeatureFn = (ctx: AnalysisContext, participant: Participant) => RawValue[];

const fns = new Map<string, FeatureFn>();

/** Registers the function that computes the registry feature with this id. */
export function defineFeature(id: string, fn: FeatureFn): void {
  if (fns.has(id)) throw new Error(`Feature ${id} is defined twice`);
  fns.set(id, fn);
}

export function featureFunctions(): ReadonlyMap<string, FeatureFn> {
  return fns;
}

/** Helpers shared by the feature files. */
export const perMinute = (count: number, ms: number): number | null =>
  ms > 0 ? count / (ms / 60000) : null;

export const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One value per configured pause threshold. */
export const atThresholds = (
  ctx: AnalysisContext,
  f: (thresholdMs: number) => number | null,
): RawValue[] => ctx.config.pauseThresholdsMs.map((t) => ({ thresholdMs: t, value: f(t) }));

/** The threshold that features without their own threshold use for phonation. */
export const PHONATION_DEFAULT_MS = 350;
