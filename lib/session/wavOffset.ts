import type { SessionRecord } from "@/lib/analysis/types";

/** Capture-time ms of the first WAV sample, from the archive event (0 when absent). */
export function wavOffsetMs(rec: SessionRecord): number {
  const e = [...rec.events].reverse().find((x) => x.type === "archive");
  return (e?.detail as { wavOffsetMs?: number } | undefined)?.wavOffsetMs ?? 0;
}
