// Segments of a session file (work order 02). Every position is a frame index
// into the session file's sample data; end is exclusive. Each edit returns a
// new list and leaves the old one alone.

import type { ZeroRun } from "./scan";

export interface Segment {
  /** Stable key for the review list; not stored in the archive. */
  key: string;
  start: number;
  end: number;
}

let nextKey = 0;
const key = () => `seg-${++nextKey}`;

/**
 * One segment per recording: the stretches between qualifying zero runs.
 * Frames before the first run and after the last run form a segment only when
 * they hold a nonzero sample, which a zero run at the file edge rules out.
 */
export function proposeSegments(zeroRuns: ZeroRun[], totalFrames: number): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const run of zeroRuns) {
    if (run.start > cursor) out.push({ key: key(), start: cursor, end: run.start });
    cursor = run.end;
  }
  if (cursor < totalFrames) out.push({ key: key(), start: cursor, end: totalFrames });
  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

/**
 * Moves one edge of segment i. The edge stays inside the file, at least one
 * frame from the segment's other edge, and clear of the neighbouring segments.
 */
export function moveBoundary(
  segs: Segment[],
  i: number,
  edge: "start" | "end",
  frame: number,
  totalFrames: number,
): Segment[] {
  const s = segs[i];
  if (!s) return segs;
  const lo = edge === "start" ? (segs[i - 1]?.end ?? 0) : s.start + 1;
  const hi = edge === "start" ? s.end - 1 : (segs[i + 1]?.start ?? totalFrames);
  const next = { ...s, [edge]: clamp(frame, lo, hi) };
  return segs.map((x, k) => (k === i ? next : x));
}

/** Joins segment i and segment i + 1 into one, covering the gap between them. */
export function mergeWithNext(segs: Segment[], i: number): Segment[] {
  if (i < 0 || i + 1 >= segs.length) return segs;
  const merged = { key: key(), start: segs[i].start, end: segs[i + 1].end };
  return [...segs.slice(0, i), merged, ...segs.slice(i + 2)];
}

/** Cuts segment i in two at a frame strictly inside it. */
export function splitAt(segs: Segment[], i: number, frame: number): Segment[] {
  const s = segs[i];
  const at = Math.round(frame);
  if (!s || at <= s.start || at >= s.end) return segs;
  return [
    ...segs.slice(0, i),
    { key: key(), start: s.start, end: at },
    { key: key(), start: at, end: s.end },
    ...segs.slice(i + 1),
  ];
}

/** Drops segment i from the pairs. Its audio stays in the archived session file. */
export function removeSegment(segs: Segment[], i: number): Segment[] {
  return segs.filter((_, k) => k !== i);
}

/** A segment list is usable when each segment has frames and none overlap. */
export function segmentsValid(segs: Segment[], totalFrames: number): boolean {
  return segs.every(
    (s, i) =>
      s.start >= 0 &&
      s.end <= totalFrames &&
      s.end > s.start &&
      (i === 0 || segs[i - 1].end <= s.start),
  );
}

/** The quietest point inside a segment, for a default split: the middle of its longest low-energy stretch. */
export function suggestSplit(
  seg: Segment,
  energyDbfs: [number[], number[]],
  framesPerEnergyFrame: number,
  quietDbfs = -50,
): number {
  const k0 = Math.ceil(seg.start / framesPerEnergyFrame);
  const k1 = Math.floor(seg.end / framesPerEnergyFrame);
  let best = { len: 0, at: Math.round((seg.start + seg.end) / 2) };
  let runStart = -1;
  for (let k = k0; k <= k1; k++) {
    const quiet =
      k < k1 && (energyDbfs[0][k] ?? 0) < quietDbfs && (energyDbfs[1][k] ?? 0) < quietDbfs;
    if (quiet && runStart < 0) runStart = k;
    if (!quiet && runStart >= 0) {
      if (k - runStart > best.len) {
        best = { len: k - runStart, at: Math.round(((runStart + k) / 2) * framesPerEnergyFrame) };
      }
      runStart = -1;
    }
  }
  return Math.min(seg.end - 1, Math.max(seg.start + 1, best.at));
}
