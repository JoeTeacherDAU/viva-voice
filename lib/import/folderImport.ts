// Command-line session import (work order 04). It runs the Pair files page's
// own steps on a folder's manifest and WAVs: the same parser, matcher, header
// check, gate, consent rule, and records, through planPairUpload. Only the
// file source and the uploader differ. Nothing here touches the file system,
// so the tests drive it with synthetic blobs.

import { unzipSync } from "fflate";
import type { PairFileSource, SessionRecord } from "@/lib/analysis/types";
import type { ExamRecord, RosterEntry } from "@/lib/exams";
import { paths } from "@/lib/storage/paths";
import {
  checkPairWav,
  matchPairFiles,
  pairUploadGate,
  parsePairManifestCsv,
  planPairUpload,
  type ReadPair,
} from "./pairfiles";
import { pass2Queue, type UploadItem } from "./records";
import {
  newExamRecord,
  pass2Fatal,
  pass2Ready,
  postExam,
  readArchiveJson,
  runPass2For,
  type AppFetch,
} from "./remote";
import { scanSessionFile } from "./scan";

export interface FolderImportArgs {
  /** The folder name. */
  sessionLabel: string;
  examId: string;
  sessionDate: string;
  /** Used only when the exam does not exist yet. */
  title?: string;
  durationMin?: number;
  manifest: { fileName: string; text: string };
  /** Every WAV in the folder. */
  wavs: { name: string; blob: Blob }[];
}

export interface FolderImportDeps {
  /** Bound to the app, with the session cookie. */
  fetch: AppFetch;
  upload: (pathname: string, body: Blob, contentType: string) => Promise<void>;
  /** Whether the uploader's store holds a path, to prove it is the app's store. */
  uploaderHas: (pathname: string) => Promise<boolean>;
  /** Writes one output file into the session folder's outputs/ folder. */
  saveOutput: (name: string, bytes: Uint8Array) => Promise<void>;
  /** Progress lines. They carry no names. */
  log: (line: string) => void;
  retryDelaysMs?: number[];
}

export interface PairLine {
  order: number;
  file: string;
  leftId: string;
  rightId: string;
  upload: string;
  pass2: string;
}

/** A problem that stops the import before anything uploads. */
export class FolderImportStop extends Error {}

async function withRetry(fn: () => Promise<void>, delays: number[]): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

/** Loads the exam, or creates it from --title and --duration-min when the archive has none. */
async function ensureExam(args: FolderImportArgs, deps: FolderImportDeps): Promise<ExamRecord> {
  const found = await readArchiveJson<ExamRecord>(deps.fetch, paths.exam(args.examId));
  if (found) {
    deps.log(`Exam ${found.id} exists: ${found.durationMs / 60000} minutes.`);
    return found;
  }
  if (!args.title?.trim() || !(Number(args.durationMin) >= 1)) {
    throw new FolderImportStop(
      `The archive has no exam ${args.examId}. Pass --title and --duration-min to create it.`,
    );
  }
  const exam = newExamRecord(args.examId, args.title, Number(args.durationMin));
  await postExam(deps.fetch, exam);
  deps.log(`Created exam ${exam.id}: ${exam.durationMs / 60000} minutes.`);
  return exam;
}

/**
 * Fetches the page's "Download all" zip for the label through
 * /api/session-download, saves it, and saves each file in it (every pair's two
 * documents and the session's CSV rows) beside it. Returns the saved names.
 */
export async function saveSessionOutputs(
  label: string,
  deps: Pick<FolderImportDeps, "fetch" | "saveOutput">,
): Promise<string[]> {
  const res = await deps.fetch(`/api/session-download?label=${encodeURIComponent(label)}`);
  if (!res.ok) throw new Error(`the session download returned HTTP ${res.status}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const saved = [`${label}.zip`];
  await deps.saveOutput(saved[0], zip);
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    await deps.saveOutput(name, bytes);
    saved.push(name);
  }
  return saved;
}

export async function importSessionFolder(
  args: FolderImportArgs,
  deps: FolderImportDeps,
): Promise<{ lines: PairLine[]; ok: boolean; outputs: string[]; outputsError?: string }> {
  const delays = deps.retryDelaysMs ?? [1000, 2000, 4000];
  const { sessionLabel, sessionDate } = args;

  // 1. The manifest and the WAV headers, checked exactly as the page checks them.
  const { rows, problems } = parsePairManifestCsv(args.manifest.text);
  const files = await Promise.all(
    args.wavs.map(async (w) => ({ name: w.name, ...(await checkPairWav(w.blob)) })),
  );
  const gate = pairUploadGate({
    examReady: true,
    sessionLabel,
    sessionDate,
    // A re-run meets its own earlier import; the per-pair hash check below handles it.
    labelTaken: false,
    rows,
    manifestProblems: problems,
    files,
    // The command has no table to tick; Joe checks the printed lines instead.
    confirmed: true,
  });
  if (!gate.ok) throw new FolderImportStop(gate.reasons.join("\n"));
  const exam = await ensureExam(args, deps);
  const roster = await readArchiveJson<RosterEntry[]>(deps.fetch, paths.roster(exam.id));

  // 2. The store the uploader writes to must be the one the app reads.
  if (!(await deps.uploaderHas(paths.exam(exam.id)))) {
    throw new FolderImportStop(
      `The upload credentials point at a different store: it lacks ${paths.exam(exam.id)}, which the app holds.`,
    );
  }
  if (!roster) {
    deps.log(
      `Exam ${exam.id} has no roster, so every pair counts as unknown consent and goes in excluded.`,
    );
  } else {
    const known = new Set(roster.map((r) => r.participantId));
    const unknown = rows.flatMap((r) => [r.leftId, r.rightId]).filter((id) => !known.has(id));
    if (unknown.length) {
      deps.log(`Not in the roster, so excluded as unknown consent: ${unknown.join(", ")}`);
    }
  }

  // 3. Each file read once, for its SHA-256 and its 20 ms energy frames.
  const match = matchPairFiles(
    rows,
    args.wavs.map((w) => w.name),
  );
  const pairs: ReadPair[] = [];
  for (const [k, { row, index }] of match.matched.entries()) {
    const w = args.wavs[index];
    deps.log(`Reading pair ${k + 1} of ${match.matched.length}: ${w.name}`);
    const info = files[index].info!;
    const scan = await scanSessionFile(w.blob, info);
    pairs.push({
      row,
      file: w.blob,
      fileName: w.name,
      info,
      sha256: scan.sha256,
      energy: scan.energy,
    });
  }
  const plan = planPairUpload({
    exam,
    sessionLabel,
    sessionDate,
    roster,
    pairs,
    manifest: args.manifest,
  });

  // 4. Re-run safety: a pair whose record already names the same file hash is
  // skipped; a different hash stops the run before anything uploads.
  const existing = new Map<string, SessionRecord>();
  const clashes: string[] = [];
  for (const [i, rec] of plan.records.entries()) {
    const prior = await readArchiveJson<SessionRecord>(deps.fetch, paths.session(rec.id));
    if (!prior) continue;
    const priorSha = (prior.source as PairFileSource | undefined)?.fileSha256;
    if (priorSha === pairs[i].sha256) existing.set(rec.id, prior);
    else
      clashes.push(
        `Pair ${rec.source?.order} (${rec.id}): the archive already holds a different file for this pair. Nothing was uploaded.`,
      );
  }
  if (clashes.length) throw new FolderImportStop(clashes.join("\n"));

  const lines = new Map<string, PairLine>(
    plan.records.map((rec, i) => [
      rec.id,
      {
        order: pairs[i].row.order,
        file: pairs[i].fileName,
        leftId: rec.participantIds.A,
        rightId: rec.participantIds.B,
        upload: existing.has(rec.id) ? "skipped, already uploaded with the same file hash" : "",
        pass2: "",
      },
    ]),
  );

  // 5. Uploads in the page's order; the import record goes last, and only
  // when every pair arrived and the archive lacks one.
  const byPair = new Map<string, UploadItem[]>();
  for (const item of plan.items.slice(0, -1)) {
    const id = item.key.replace(/-(audio|energy|record)$/, "");
    byPair.set(id, [...(byPair.get(id) ?? []), item]);
  }
  let allArrived = true;
  for (const rec of plan.records) {
    const line = lines.get(rec.id)!;
    if (existing.has(rec.id)) {
      deps.log(`Pair ${line.order}: ${line.upload}.`);
      continue;
    }
    try {
      for (const item of byPair.get(rec.id) ?? []) {
        deps.log(`Uploading ${item.label}`);
        const body = await item.body();
        await withRetry(() => deps.upload(item.pathname, body, item.contentType), delays);
      }
      line.upload = "uploaded";
    } catch (e) {
      line.upload = `failed: ${(e as Error).message}`;
      allArrived = false;
    }
  }
  const importItem = plan.items.at(-1)!;
  if (allArrived) {
    if (await readArchiveJson(deps.fetch, importItem.pathname)) {
      deps.log(`The import record ${importItem.pathname} already exists; it stays as it was.`);
    } else {
      const body = await importItem.body();
      await withRetry(() => deps.upload(importItem.pathname, body, importItem.contentType), delays);
    }
  }

  // 6. Pass two through the app's route, one pair at a time.
  const ready = await pass2Ready(deps.fetch);
  const queue = pass2Queue(plan.records);
  for (const s of queue.skip) lines.get(s.id)!.pass2 = `skipped, ${s.reason}`;
  let stopped: string | null = ready.ready ? null : (ready.error ?? "pass two cannot run");
  for (const id of queue.run) {
    const line = lines.get(id)!;
    if (line.upload.startsWith("failed")) {
      line.pass2 = "not run, the upload failed";
      continue;
    }
    if (stopped) {
      line.pass2 = `not run: ${stopped}`;
      continue;
    }
    const current = await readArchiveJson<SessionRecord>(deps.fetch, paths.session(id));
    if (current?.passes?.["2"]) {
      line.pass2 = "skipped, already done";
      continue;
    }
    deps.log(`Pass two for pair ${line.order}`);
    const out = await runPass2For(deps.fetch, id);
    if (out.ok) line.pass2 = "done";
    else {
      line.pass2 = `failed: ${out.error}`;
      if (pass2Fatal(out.error)) stopped = out.error;
    }
  }

  // 7. The outputs, saved into the session folder even when a pair failed, so
  // Joe has whatever the archive holds; a re-run replaces them.
  let outputs: string[] = [];
  let outputsError: string | undefined;
  if (allArrived) {
    deps.log("Saving the outputs");
    try {
      outputs = await saveSessionOutputs(sessionLabel, deps);
    } catch (e) {
      outputsError = (e as Error).message;
    }
  } else outputsError = "not saved, because an upload failed";

  const result = [...lines.values()].sort((a, b) => a.order - b.order);
  const ok =
    allArrived &&
    !outputsError &&
    result.every((l) => !l.upload.startsWith("failed") && !/^(failed|not run)/.test(l.pass2));
  return { lines: result, ok, outputs, outputsError };
}

/** One printed line per pair: file, IDs, upload status, pass-two status. No names. */
export function formatPairLine(l: PairLine): string {
  return `${l.file} | left ${l.leftId} | right ${l.rightId} | upload: ${l.upload} | pass two: ${l.pass2}`;
}
