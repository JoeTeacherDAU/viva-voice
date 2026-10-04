import type { EnergyFrame, EnergyTrack } from "./types";

export const FRAME_MS = 20;

/** Accepts either storage shape and returns the columnar track. */
export function toTrack(
  frames: EnergyTrack | EnergyFrame[] | null | undefined,
): EnergyTrack | null {
  if (!frames) return null;
  if (!Array.isArray(frames)) return frames;
  if (frames.length === 0) return null;
  const startMs = Math.min(...frames.map((f) => f.atMs));
  const len = Math.max(...frames.map((f) => Math.round((f.atMs - startMs) / FRAME_MS))) + 1;
  const channels: [number[], number[]] = [new Array(len).fill(-100), new Array(len).fill(-100)];
  for (const f of frames) channels[f.channel][Math.round((f.atMs - startMs) / FRAME_MS)] = f.dbfs;
  return { frameMs: FRAME_MS, startMs, channels };
}

/** Mean dBFS on one channel over [startMs, endMs), or null without frames there. */
export function meanDbfs(
  track: EnergyTrack | null,
  channel: 0 | 1,
  startMs: number,
  endMs: number,
): number | null {
  if (!track) return null;
  const k0 = Math.max(0, Math.floor((startMs - track.startMs) / track.frameMs));
  const k1 = Math.min(
    track.channels[channel].length,
    Math.ceil((endMs - track.startMs) / track.frameMs),
  );
  if (k1 <= k0) return null;
  let sum = 0;
  for (let k = k0; k < k1; k++) sum += track.channels[channel][k];
  return sum / (k1 - k0);
}
