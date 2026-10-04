import { byTier } from "@/lib/registry";
import type { FeatureValue, SessionRecord } from "@/lib/analysis/types";

export const WIDE_META = [
  "examId",
  "sessionId",
  "participantId",
  "pass",
  "pipelineVersion",
] as const;
export const LONG_HEADER = [
  "examId",
  "sessionId",
  "participantId",
  "pass",
  "featureId",
  "window",
  "threshold",
  "value",
  "unit",
  "pipelineVersion",
] as const;
/** Wide rows carry one value per feature; threshold features use 350 ms. */
export const WIDE_THRESHOLD_MS = 350;

export function wideHeader(): string[] {
  return [...WIDE_META, ...byTier(1).map((f) => f.id)];
}

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: readonly string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** One row per student for one pass (PLAN.md 11.2). No instructor score. */
export function wideRows(
  rec: SessionRecord,
  features: FeatureValue[],
  pass: 1 | 2,
  pipelineVersion: string,
): unknown[][] {
  return (["A", "B"] as const).map((P) => [
    rec.examId,
    rec.id,
    rec.participantIds[P],
    pass,
    pipelineVersion,
    ...byTier(1).map((f) => {
      const full = features.filter(
        (v) => v.featureId === f.id && v.participant === P && v.window === "full",
      );
      const pick =
        full.find((v) => v.thresholdMs === WIDE_THRESHOLD_MS) ??
        full.find((v) => v.thresholdMs === null) ??
        full[0];
      return pick?.value ?? "";
    }),
  ]);
}

/** One row per feature value per student per pass, rolling windows included. */
export function longRows(
  rec: SessionRecord,
  features: FeatureValue[],
  pipelineVersion: string,
): unknown[][] {
  return features.map((v) => [
    rec.examId,
    rec.id,
    rec.participantIds[v.participant],
    v.pass,
    v.featureId,
    v.window,
    v.thresholdMs ?? "",
    v.value ?? "",
    v.unit,
    pipelineVersion,
  ]);
}

/** Parses this module's own CSV output (quoted cells, no embedded newlines in practice). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

/**
 * Appends one session's rows to an existing CSV, replacing any earlier rows
 * for the same session (sessionId is column 2 in both layouts).
 */
export function mergeCsv(
  existing: string | null,
  header: readonly string[],
  sessionId: string,
  rows: unknown[][],
): string {
  const kept = existing
    ? parseCsv(existing)
        .slice(1)
        .filter((r) => r[1] !== sessionId)
    : [];
  return toCsv(header, [...kept, ...rows]);
}
