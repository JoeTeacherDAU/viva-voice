// The pair manifest for a session file (work order 02): pairs in recording
// order, each with the participant on the left channel and on the right.

export interface ManifestRow {
  order: number;
  leftId: string;
  rightId: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const MANIFEST_HEADER = ["order", "left_id", "right_id"] as const;

/** Splits one CSV line, honouring double quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parses a manifest CSV with the header order,left_id,right_id. Problems name the line. */
export function parseManifestCsv(text: string): { rows: ManifestRow[]; problems: string[] } {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.trim() !== "");
  const problems: string[] = [];
  if (lines.length === 0) return { rows: [], problems: ["The CSV file is empty."] };
  const head = cells(lines[0].l).map((h) => h.toLowerCase());
  if (head.join(",") !== MANIFEST_HEADER.join(",")) {
    return {
      rows: [],
      problems: [`Line 1 must read order,left_id,right_id. It reads ${lines[0].l.trim()}.`],
    };
  }
  const rows: ManifestRow[] = [];
  for (const { l, n } of lines.slice(1)) {
    const c = cells(l);
    if (c.length !== 3) {
      problems.push(`Line ${n} has ${c.length} columns; it needs 3.`);
      continue;
    }
    const order = Number(c[0]);
    rows.push({ order, leftId: c[1], rightId: c[2] });
    if (!Number.isInteger(order) || order < 1)
      problems.push(`Line ${n}: order must be a whole number from 1.`);
  }
  return { rows, problems: [...problems, ...checkManifest(rows)] };
}

/** Rules for a manifest typed on the page or read from CSV. */
export function checkManifest(rows: ManifestRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  rows.forEach((r, i) => {
    const where = `Row ${i + 1}`;
    if (!Number.isInteger(r.order) || r.order < 1)
      problems.push(`${where}: order must be a whole number from 1.`);
    else if (seen.has(r.order)) problems.push(`${where}: order ${r.order} appears twice.`);
    seen.add(r.order);
    for (const [side, id] of [
      ["left", r.leftId],
      ["right", r.rightId],
    ] as const) {
      if (!id) problems.push(`${where}: the ${side} participant ID is empty.`);
      else if (!SAFE_ID.test(id))
        problems.push(
          `${where}: the ${side} participant ID ${id} may hold only letters, digits, - and _.`,
        );
    }
    if (r.leftId && r.leftId === r.rightId)
      problems.push(`${where}: the same participant sits on both channels.`);
  });
  return problems;
}

/** Rows in recording order. */
export function sortedRows(rows: ManifestRow[]): ManifestRow[] {
  return [...rows].sort((a, b) => a.order - b.order);
}

export function manifestToCsv(rows: ManifestRow[]): string {
  return (
    [
      MANIFEST_HEADER.join(","),
      ...sortedRows(rows).map((r) => `${r.order},${r.leftId},${r.rightId}`),
    ].join("\n") + "\n"
  );
}

export interface UploadGate {
  ok: boolean;
  segments: number;
  rows: number;
  reasons: string[];
}

/**
 * The upload waits until every reason clears. Segment i matches manifest row
 * i in recording order, and only when the two counts agree; the import never
 * guesses a match.
 */
export function uploadGate(input: {
  segments: number;
  rows: ManifestRow[];
  examReady: boolean;
  sessionLabel: string;
  sessionDate: string;
  labelTaken: boolean;
}): UploadGate {
  const reasons: string[] = [];
  if (!input.examReady) reasons.push("Choose an exam that exists, or create it.");
  if (!SAFE_ID.test(input.sessionLabel))
    reasons.push("Enter a session label made of letters, digits, - and _.");
  if (input.labelTaken)
    reasons.push(`The archive already holds session ${input.sessionLabel}. Choose another label.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) reasons.push("Enter the session date.");
  reasons.push(...checkManifest(input.rows));
  if (input.segments !== input.rows.length) {
    reasons.push(
      `The file has ${input.segments} segment${input.segments === 1 ? "" : "s"} and the manifest has ${input.rows.length} row${input.rows.length === 1 ? "" : "s"}. Edit the segments or the manifest until the two numbers match.`,
    );
  }
  return { ok: reasons.length === 0, segments: input.segments, rows: input.rows.length, reasons };
}
