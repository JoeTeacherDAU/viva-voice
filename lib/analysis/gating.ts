import { overlapsAny } from "./window";
import type { EnergyTrack, Gap, GatingResult, Markers } from "./types";

export const DEFAULT_SPEECH_FLOOR_DBFS = -60;

/**
 * Per-frame attribution (PLAN.md section 7). A frame inside the window counts
 * as speech when either channel reaches the speech floor; it is attributed to
 * a channel that exceeds the other by gatingMarginDb, and unattributed
 * otherwise. Frames that overlap a gap are skipped.
 */
export function gateFrames(
  track: EnergyTrack | null,
  markers: Markers,
  gatingMarginDb: number,
  speechFloorDbfs = DEFAULT_SPEECH_FLOOR_DBFS,
  gaps: Gap[] = [],
): GatingResult {
  const res: GatingResult = {
    speechFrames: 0,
    attributedFrames: [0, 0],
    unattributedFrames: 0,
    unattributedRatio: null,
  };
  if (!track) return res;
  const [c0, c1] = track.channels;
  const n = Math.min(c0.length, c1.length);
  for (let k = 0; k < n; k++) {
    const t0 = track.startMs + k * track.frameMs;
    const t1 = t0 + track.frameMs;
    if (t0 < markers.startMs || t1 > markers.stopMs) continue;
    if (overlapsAny(gaps, t0, t1)) continue;
    const d0 = c0[k];
    const d1 = c1[k];
    if (Math.max(d0, d1) < speechFloorDbfs) continue;
    res.speechFrames++;
    if (d0 - d1 >= gatingMarginDb) res.attributedFrames[0]++;
    else if (d1 - d0 >= gatingMarginDb) res.attributedFrames[1]++;
    else res.unattributedFrames++;
  }
  res.unattributedRatio = res.speechFrames > 0 ? res.unattributedFrames / res.speechFrames : null;
  return res;
}
