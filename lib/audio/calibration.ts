import type { Channel } from "@/lib/analysis/types";

export const SPEECH_FLOOR_DBFS = -60;

/**
 * Mean level difference (speaking channel minus the other) over frames where
 * the speaking channel reaches the speech floor. Frames pair by index.
 */
export function separationDb(
  frames: [number[], number[]],
  speaking: Channel,
  floor = SPEECH_FLOOR_DBFS,
): number | null {
  const own = frames[speaking];
  const other = frames[speaking === 0 ? 1 : 0];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(own.length, other.length); i++) {
    if (own[i] === undefined || other[i] === undefined || own[i] < floor) continue;
    sum += own[i] - other[i];
    n++;
  }
  return n ? sum / n : null;
}

/** PLAN.md section 7: the smaller separation minus 3 dB, rounded to 0.5 dB. */
export function proposedMargin(sepA: number, sepB: number): number {
  return Math.max(0, Math.round((Math.min(sepA, sepB) - 3) * 2) / 2);
}
