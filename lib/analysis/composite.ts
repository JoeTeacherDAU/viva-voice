import type { Baseline, CompositeWeights } from "./types";

export interface CompositeComponents {
  speech_rate_wpm: number | null;
  silent_pause_rate: number | null;
  mean_length_of_run: number | null;
}

/**
 * Composite fluency index (MEASUREMENT_FRAMEWORK.md 4.6): z-scores against the
 * course baseline, pause rate negated so a higher index reads as more fluent,
 * summed with the configured weights. Null below baselineMinSessions, when a
 * component is missing, or when a baseline SD is not positive.
 */
export function compositeIndex(
  c: CompositeComponents,
  baseline: Baseline | null,
  weights: CompositeWeights,
  baselineMinSessions: number,
): number | null {
  if (!baseline || baseline.n < baselineMinSessions) return null;
  const keys = ["speech_rate_wpm", "silent_pause_rate", "mean_length_of_run"] as const;
  const z: Partial<Record<(typeof keys)[number], number>> = {};
  for (const k of keys) {
    const x = c[k];
    const { mean, sd } = baseline.components[k];
    if (x === null || !(sd > 0)) return null;
    z[k] = (x - mean) / sd;
  }
  return (
    weights.silent_pause_rate * -z.silent_pause_rate! +
    weights.speech_rate_wpm * z.speech_rate_wpm! +
    weights.mean_length_of_run * z.mean_length_of_run!
  );
}

/**
 * Adds one session's components to a baseline that stores n, mean, and sample
 * SD per component (Welford's update, recovering the sum of squares from SD).
 * A null component leaves that component's statistics unchanged.
 */
export function updateBaseline(baseline: Baseline | null, c: CompositeComponents): Baseline {
  const keys = ["speech_rate_wpm", "silent_pause_rate", "mean_length_of_run"] as const;
  const prevN = baseline?.n ?? 0;
  const n = prevN + 1;
  const next = { n, components: {} } as Baseline;
  for (const k of keys) {
    const prev = baseline?.components[k] ?? { mean: 0, sd: 0 };
    const x = c[k];
    if (x === null) {
      next.components[k] = { ...prev };
      continue;
    }
    const m2 = prev.sd ** 2 * Math.max(prevN - 1, 0);
    const mean = prev.mean + (x - prev.mean) / n;
    const nextM2 = m2 + (x - prev.mean) * (x - mean);
    next.components[k] = { mean, sd: n > 1 ? Math.sqrt(nextM2 / (n - 1)) : 0 };
  }
  return next;
}
