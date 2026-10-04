import { overlapsAny } from "./window";
import type { Channel, EnergyTrack, Gap, Pause, Turn } from "./types";

export interface Span {
  startMs: number;
  endMs: number;
}

/**
 * Acoustic silences inside one speaker's own turns, from the energy frames,
 * with no reference to word timings (RESEARCH_PRINCIPLES.md principle 5).
 * A frame is voiced for the speaker when their channel reaches the speech
 * floor and is not clearly quieter than the partner's channel (by less than
 * gatingMarginDb). Every other frame inside a turn is silent: room noise, or
 * the partner's voice bleeding in. Frames that overlap a gap break a run.
 */
export function silentRuns(
  track: EnergyTrack | null,
  channel: Channel,
  turns: Turn[],
  gatingMarginDb: number,
  speechFloorDbfs: number,
  gaps: Gap[] = [],
): Span[] {
  if (!track) return [];
  const own = track.channels[channel];
  const other = track.channels[channel === 0 ? 1 : 0];
  const f = track.frameMs;
  const runs: Span[] = [];
  for (const t of turns) {
    const k0 = Math.max(0, Math.ceil((t.startMs - track.startMs) / f));
    const k1 = Math.min(own.length, Math.floor((t.endMs - track.startMs) / f));
    let start: number | null = null;
    const close = (k: number) => {
      if (start !== null)
        runs.push({ startMs: track.startMs + start * f, endMs: track.startMs + k * f });
      start = null;
    };
    for (let k = k0; k < k1; k++) {
      const t0 = track.startMs + k * f;
      if (overlapsAny(gaps, t0, t0 + f)) {
        close(k);
        continue;
      }
      const voiced = own[k] >= speechFloorDbfs && own[k] - (other[k] ?? -100) > -gatingMarginDb;
      if (voiced) close(k);
      else start ??= k;
    }
    close(k1);
  }
  return runs;
}

/**
 * Share of word-gap pauses that acoustic silence covers for at least half of
 * their duration. Null without pauses or without energy frames.
 */
export function pauseAgreement(pauses: Pause[], runs: Span[], hasEnergy: boolean): number | null {
  if (!hasEnergy || pauses.length === 0) return null;
  let agree = 0;
  for (const p of pauses) {
    let covered = 0;
    for (const r of runs)
      covered += Math.max(0, Math.min(p.endMs, r.endMs) - Math.max(p.startMs, r.startMs));
    if (covered >= p.durationMs / 2) agree++;
  }
  return agree / pauses.length;
}
