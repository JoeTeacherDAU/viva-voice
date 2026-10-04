import type { FeatureValue } from "@/lib/analysis/types";

const ACRONYMS: Record<string, string> = {
  mattr: "MATTR",
  mtld: "MTLD",
  wpm: "WPM",
  sps: "SPS",
  est: "estimate",
  ms: "ms",
};

/** Human label for a registry id: "silent_pause_rate" -> "Silent pause rate". */
export function featureLabel(id: string): string {
  const words = id.split("_").map((w) => ACRONYMS[w] ?? w);
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first[0].toUpperCase() + first.slice(1);
  return words.join(" ");
}

/** Number formatting shared by the DOCX, the review screen, and the tests. */
export function formatValue(v: number | null | undefined): string {
  if (v === null || v === undefined) return "not computed";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) < 1 ? v.toPrecision(3) : v.toFixed(2);
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function findValue(
  fs: FeatureValue[] | null | undefined,
  id: string,
  participant: string,
  thresholdMs: number | null,
): FeatureValue | undefined {
  return fs?.find(
    (f) =>
      f.featureId === id &&
      f.participant === participant &&
      f.window === "full" &&
      f.thresholdMs === thresholdMs,
  );
}
