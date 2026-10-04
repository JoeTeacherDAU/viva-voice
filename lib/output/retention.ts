import type { SessionRecord } from "@/lib/analysis/types";
import { paths } from "@/lib/storage/paths";
import { getJson, putJson, type ArchiveStore } from "@/lib/storage/store";

export const RETENTION_MONTHS = 24;

export interface RetentionLogLine {
  ranAt: string;
  examId: string;
  termEnd: string;
  deleted: number;
  sessions: string[];
}

/** termEnd plus 24 months, as an ISO date (ruling R2). */
export function deleteAfter(termEnd: string): Date {
  const d = new Date(`${termEnd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + RETENTION_MONTHS);
  return d;
}

/**
 * Deletes audio, transcripts, the documents and bundles that embed them, and
 * the roster for every exam whose term ended more than 24 months ago (ruling
 * R2). Session records, measurements, and the CSVs stay. Appends one line per
 * exam to retention/log.json.
 */
export async function runRetention(
  store: ArchiveStore,
  now = new Date(),
): Promise<RetentionLogLine[]> {
  const lines: RetentionLogLine[] = [];
  const sessions: SessionRecord[] = [];
  for (const o of await store.list("sessions/")) {
    const r = await getJson<SessionRecord>(store, o.pathname);
    if (r) sessions.push(r);
  }
  for (const o of await store.list("exams/")) {
    const exam = await getJson<{ id?: string; termEnd?: string }>(store, o.pathname);
    const examId = o.pathname.replace(/^exams\//, "").replace(/\.json$/, "");
    if (!exam?.termEnd || deleteAfter(exam.termEnd) > now) continue;
    const ids = sessions.filter((s) => s.examId === examId).map((s) => s.id);
    const doomed: string[] = [];
    for (const id of ids) {
      for (const prefix of [
        `audio/${id}/`,
        `transcripts/${id}/`,
        `documents/${id}/`,
        `bundles/${id}/`,
      ]) {
        doomed.push(...(await store.list(prefix)).map((x) => x.pathname));
      }
    }
    const roster = paths.roster(examId);
    if ((await store.list(roster)).some((x) => x.pathname === roster)) doomed.push(roster);
    if (doomed.length === 0) continue;
    await store.del(doomed);
    lines.push({
      ranAt: now.toISOString(),
      examId,
      termEnd: exam.termEnd,
      deleted: doomed.length,
      sessions: ids,
    });
  }
  if (lines.length) {
    const log = (await getJson<RetentionLogLine[]>(store, paths.retentionLog())) ?? [];
    await putJson(store, paths.retentionLog(), [...log, ...lines]);
  }
  return lines;
}
