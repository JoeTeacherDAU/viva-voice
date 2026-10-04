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
  weightsVersion?: string,
): number | null {
  if (!baseline || baseline.n < baselineMinSessions) return null;
  if (weightsVersion !== undefined && (baseline.weightsVersion ?? "1.0") !== weightsVersion)
    return null;
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
 * Adds one session to a course baseline. n counts sessions; each component's
 * mean and sample SD run over student observations (two per session), with
 * Welford's update recovering the sum of squares from the stored SD and count.
 * A null value leaves that component unchanged.
 */
export function updateBaseline(
  baseline: Baseline | null,
  students: CompositeComponents[],
  sessionId?: string,
  weightsVersion?: string,
): Baseline {
  if (sessionId && baseline?.sessions?.includes(sessionId)) return baseline;
  // A baseline measured under other weights cannot absorb this session; start over.
  if (
    weightsVersion !== undefined &&
    baseline &&
    (baseline.weightsVersion ?? "1.0") !== weightsVersion
  )
    baseline = null;
  const keys = ["speech_rate_wpm", "silent_pause_rate", "mean_length_of_run"] as const;
  const next = {
    n: (baseline?.n ?? 0) + 1,
    sessions: sessionId ? [...(baseline?.sessions ?? []), sessionId] : baseline?.sessions,
    ...(weightsVersion !== undefined ? { weightsVersion } : {}),
    components: {},
  } as Baseline;
  for (const k of keys) {
    const prev = baseline?.components[k];
    let mean = prev?.mean ?? 0;
    let count = prev ? (prev.count ?? 2 * (baseline?.n ?? 0)) : 0;
    let m2 = (prev?.sd ?? 0) ** 2 * Math.max(count - 1, 0);
    for (const s of students) {
      const x = s[k];
      if (x === null) continue;
      count++;
      const delta = x - mean;
      mean += delta / count;
      m2 += delta * (x - mean);
    }
    next.components[k] = { mean, sd: count > 1 ? Math.sqrt(m2 / (count - 1)) : 0, count };
  }
  return next;
}
