// The review list and the per-label "Download all" zip (work order 02, items
// 10 and 11). Reads sessions/, measurements/, and documents/; never the roster.

import type { SessionRecord } from "@/lib/analysis/types";
import { paths } from "@/lib/storage/paths";
import { getBytes, getJson, type ArchiveStore } from "@/lib/storage/store";
import { buildBundle } from "./bundle";
import { LONG_HEADER, longRows, toCsv, wideHeader, wideRows } from "./csv";
import type { MeasurementsFile } from "./pass2";

export interface SessionSummary {
  id: string;
  examId: string;
  captureMode: "live" | "file-import";
  /** The session label for a file import; null for a live session. */
  sessionLabel: string | null;
  order: number | null;
  sessionDate: string;
  participantIds: { A: string; B: string };
  status: "excluded: consent" | "pass two done" | "awaiting pass two";
  createdAt: string;
}

export function summarize(rec: SessionRecord): SessionSummary {
  return {
    id: rec.id,
    examId: rec.examId,
    captureMode: rec.captureMode ?? "live",
    sessionLabel: rec.source?.sessionLabel ?? null,
    order: rec.source?.order ?? null,
    sessionDate: rec.source?.sessionDate ?? rec.createdAt.slice(0, 10),
    participantIds: rec.participantIds,
    status: rec.excluded
      ? `excluded: ${rec.excluded.reason}`
      : rec.passes["2"]
        ? "pass two done"
        : "awaiting pass two",
    createdAt: rec.createdAt,
  };
}

async function records(store: ArchiveStore): Promise<SessionRecord[]> {
  const out: SessionRecord[] = [];
  for (const o of await store.list("sessions/")) {
    const r = await getJson<SessionRecord>(store, o.pathname);
    if (r) out.push(r);
  }
  return out;
}

/** Every archived session, file imports by label and order, then live sessions newest first. */
export async function listSessions(store: ArchiveStore): Promise<SessionSummary[]> {
  return (await records(store)).map(summarize).sort((a, b) => {
    if (a.sessionLabel !== b.sessionLabel) {
      if (a.sessionLabel === null) return 1;
      if (b.sessionLabel === null) return -1;
      return a.sessionLabel < b.sessionLabel ? -1 : 1;
    }
    if (a.order !== null && b.order !== null) return a.order - b.order;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/**
 * One zip for a session label: each pair's two documents, named by pair,
 * student, and participant; the label's wide and long CSV rows; and pairs.csv
 * with each pair's channels and status. Returns null when no record has the label.
 */
export async function buildSessionDownload(
  store: ArchiveStore,
  label: string,
): Promise<Uint8Array | null> {
  const recs = (await records(store))
    .filter((r) => r.source?.sessionLabel === label)
    .sort((a, b) => a.source!.order - b.source!.order);
  if (recs.length === 0) return null;
  const files: Record<string, Uint8Array> = {};
  const wide: unknown[][] = [];
  const long: unknown[][] = [];
  const pairs: unknown[][] = [];
  for (const rec of recs) {
    const s = summarize(rec);
    pairs.push([rec.source!.order, rec.id, rec.participantIds.A, rec.participantIds.B, s.status]);
    if (rec.excluded) continue;
    for (const P of ["A", "B"] as const) {
      const doc = await getBytes(store, paths.document(rec.id, P));
      if (doc) files[`${rec.id}-${P}-${rec.participantIds[P]}.docx`] = doc;
    }
    const m2 = await getJson<MeasurementsFile>(store, paths.measurements(rec.id, 2));
    if (m2) {
      wide.push(...wideRows(rec, m2.features, 2, m2.pipelineVersion));
      long.push(...longRows(rec, m2.features, m2.pipelineVersion));
    }
  }
  const enc = (s: string) => new TextEncoder().encode(s);
  files[`${label}-wide.csv`] = enc(toCsv(wideHeader(), wide));
  files[`${label}-long.csv`] = enc(toCsv(LONG_HEADER, long));
  files[`${label}-pairs.csv`] = enc(
    toCsv(["order", "sessionId", "left_id", "right_id", "status"], pairs),
  );
  return buildBundle(files);
}
