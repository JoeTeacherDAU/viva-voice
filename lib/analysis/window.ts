import type { Gap, Markers, SessionEvent, Word } from "./types";

/** Gap spans from session events, clipped to the window. */
export function gapsFrom(events: SessionEvent[] | undefined, markers: Markers): Gap[] {
  return (events ?? [])
    .filter((e) => e.type === "gap")
    .map((e) => e.detail as { startMs?: number; endMs?: number } | undefined)
    .filter((d): d is Gap => typeof d?.startMs === "number" && typeof d?.endMs === "number")
    .map((g) => ({
      startMs: Math.max(g.startMs, markers.startMs),
      endMs: Math.min(g.endMs, markers.stopMs),
    }))
    .filter((g) => g.endMs > g.startMs);
}

export function overlapsAny(gaps: Gap[], startMs: number, endMs: number): boolean {
  return gaps.some((g) => g.startMs < endMs && startMs < g.endMs);
}

export function gapTotalMs(gaps: Gap[]): number {
  return gaps.reduce((a, g) => a + (g.endMs - g.startMs), 0);
}

/**
 * Keeps words whose start and end fall inside the window. Pass one also drops
 * any word that overlaps a gap; pass two ignores gaps.
 */
export function trimWords(words: Word[], markers: Markers, gaps: Gap[]): Word[] {
  return words.filter(
    (w) =>
      w.startMs >= markers.startMs &&
      w.endMs <= markers.stopMs &&
      !overlapsAny(gaps, w.startMs, w.endMs),
  );
}

/** Window time with gap time removed. */
export function effectiveWindowMs(markers: Markers, gaps: Gap[]): number {
  return markers.stopMs - markers.startMs - gapTotalMs(gaps);
}
