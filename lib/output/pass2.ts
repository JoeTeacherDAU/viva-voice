import { updateBaseline } from "@/lib/analysis/composite";
import { run, PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import type {
  Baseline,
  EnergyTrack,
  FeatureValue,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";
import type { BatchTranscriber } from "@/lib/asr/batch";
import { paths } from "@/lib/storage/paths";
import { getBytes, getJson, putJson, type ArchiveStore } from "@/lib/storage/store";
import { LONG_HEADER, longRows, mergeCsv, toCsv, wideHeader, wideRows } from "./csv";
import { findValue } from "./format";
import { buildStudentDoc } from "./studentDoc";

export interface MeasurementsFile {
  pipelineVersion: string;
  pass: 1 | 2;
  features: FeatureValue[];
  removedSpans?: unknown[];
  quality?: {
    unattributedRatio: number | null;
    speechFrames?: number;
    unattributedFrames?: number;
  };
  createdAt?: string;
}

export interface TranscriptFile {
  words: Word[];
  model?: string;
  source?: "usb" | "onboard";
  raw?: unknown;
  createdAt?: string;
}

export interface ExamFile {
  course?: string;
  unit?: string;
}

/** Capture-time ms of the first WAV sample, from the archive event (0 when absent). */
export function wavOffsetMs(rec: SessionRecord): number {
  const e = [...rec.events].reverse().find((x) => x.type === "archive");
  return (e?.detail as { wavOffsetMs?: number } | undefined)?.wavOffsetMs ?? 0;
}

export class Pass2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Pass2Options {
  source?: "usb" | "onboard";
  /** Set by the replication screen's re-transcribe; labels the run. */
  label?: string;
}

/**
 * Pass two (PLAN.md 6.2, build-plan P6.4): transcribe the archived WAV, run the
 * pipeline with pass 2 and the course baseline, write the transcript and
 * measurements, mark the session done, update the baseline, the instructor
 * file, both documents, and the cohort CSVs.
 */
export async function runPass2(
  store: ArchiveStore,
  sessionId: string,
  batch: BatchTranscriber,
  opts: Pass2Options = {},
): Promise<{ record: SessionRecord; features: FeatureValue[] }> {
  const rec = await getJson<SessionRecord>(store, paths.session(sessionId));
  if (!rec) throw new Pass2Error(`No archived session ${sessionId}`, 404);
  if (rec.markers.startMs === null || rec.markers.stopMs === null) {
    throw new Pass2Error(`Session ${sessionId} has no Start and Stop markers`, 409);
  }
  const source = opts.source ?? "usb";
  const audio = source === "onboard" ? paths.onboardStereo(sessionId) : paths.stereo(sessionId);
  if (!(await store.list(audio)).some((o) => o.pathname === audio)) {
    throw new Pass2Error(`No audio at ${audio}`, 404);
  }
  const map = rec.channelMap ?? { "0": "A", "1": "B" };
  const url = (await store.presignGet(audio, 10 * 60 * 1000)) ?? `memory://${audio}`;
  const { words: wavWords, raw, model } = await batch.transcribe(url, map);

  const offset = wavOffsetMs(rec);
  const words = wavWords.map((w) => ({
    ...w,
    startMs: w.startMs + offset,
    endMs: w.endMs + offset,
  }));
  const energy = await getJson<EnergyTrack>(store, paths.energy(sessionId));
  const baseline = await getJson<Baseline>(store, paths.baseline(rec.examId));
  const pass1 = await getJson<MeasurementsFile>(store, paths.measurements(sessionId, 1));
  const markers = { startMs: rec.markers.startMs, stopMs: rec.markers.stopMs };
  const result = run(words, energy, rec.config, baseline, {
    pass: 2,
    markers,
    channelMap: map,
    previousPass: pass1?.features ?? null,
  });
  const now = new Date().toISOString();

  await putJson(store, paths.transcript(sessionId, 2), {
    words: result.words,
    model,
    source,
    raw,
    createdAt: now,
  } satisfies TranscriptFile);
  await putJson(store, paths.measurements(sessionId, 2), {
    pipelineVersion: PIPELINE_VERSION,
    pass: 2,
    features: result.features,
    removedSpans: result.removedSpans,
    quality: result.quality,
    createdAt: now,
  } satisfies MeasurementsFile);

  const record: SessionRecord = {
    ...rec,
    state: "done",
    deepgramModel: model,
    pipelineVersion: PIPELINE_VERSION,
    passes: {
      ...rec.passes,
      "2": {
        transcript: paths.transcript(sessionId, 2),
        measurements: paths.measurements(sessionId, 2),
        completedAt: now,
        source,
      },
    },
    events: [
      ...rec.events,
      {
        type: "pass2",
        atMs: markers.stopMs,
        detail: { model, source, label: opts.label ?? "pass two", at: now },
      },
    ],
  };
  await putJson(store, paths.session(sessionId), record);

  // Course baseline from pass-two values (record of account).
  const comps = (["A", "B"] as const).map((P) => ({
    speech_rate_wpm: findValue(result.features, "speech_rate_wpm", P, null)?.value ?? null,
    silent_pause_rate: findValue(result.features, "silent_pause_rate", P, 350)?.value ?? null,
    mean_length_of_run: findValue(result.features, "mean_length_of_run", P, 350)?.value ?? null,
  }));
  await putJson(store, paths.baseline(rec.examId), updateBaseline(baseline, comps, sessionId));

  // Ruling R1: the live score goes to its own file for the research export.
  const instructor = (await getJson<{ sessions: Record<string, unknown> }>(
    store,
    paths.instructor(rec.examId),
  )) ?? { sessions: {} };
  instructor.sessions[sessionId] = {
    participantIds: rec.participantIds,
    instructorLiveScore: rec.instructorLiveScore,
  };
  await putJson(store, paths.instructor(rec.examId), instructor);

  const exam = await getJson<ExamFile>(store, paths.exam(rec.examId));
  for (const student of ["A", "B"] as const) {
    const doc = await buildStudentDoc({
      record,
      student,
      course: exam?.course,
      unit: exam?.unit,
      words: result.words,
      pass1: pass1?.features ?? null,
      pass2: result.features,
      removedSpans: result.removedSpans,
      unattributedRatio: result.quality.unattributedRatio,
    });
    await store.put(paths.document(sessionId, student), doc);
  }

  await appendExports(store, record, pass1?.features ?? [], result.features);
  return { record, features: result.features };
}

async function readText(store: ArchiveStore, pathname: string): Promise<string | null> {
  const b = await getBytes(store, pathname);
  return b ? new TextDecoder().decode(b) : null;
}

/** Appends one session to exports/{examId}/wide.csv and long.csv. */
export async function appendExports(
  store: ArchiveStore,
  rec: SessionRecord,
  pass1: FeatureValue[],
  pass2: FeatureValue[],
): Promise<void> {
  const wide = mergeCsv(
    await readText(store, paths.wide(rec.examId)),
    wideHeader(),
    rec.id,
    wideRows(rec, pass2, 2, PIPELINE_VERSION),
  );
  const long = mergeCsv(
    await readText(store, paths.long(rec.examId)),
    LONG_HEADER,
    rec.id,
    longRows(rec, [...pass1, ...pass2], PIPELINE_VERSION),
  );
  await store.put(paths.wide(rec.examId), wide, "text/csv; charset=utf-8");
  await store.put(paths.long(rec.examId), long, "text/csv; charset=utf-8");
}

/**
 * Regenerates both cohort CSVs for an exam from the stored measurements
 * (build-plan P6.6, /api/export). Reads sessions/ and measurements/ only;
 * never the roster.
 */
export async function regenerateExports(
  store: ArchiveStore,
  examId: string,
): Promise<{ wide: string; long: string }> {
  const sessions: SessionRecord[] = [];
  for (const o of await store.list("sessions/")) {
    const rec = await getJson<SessionRecord>(store, o.pathname);
    if (rec?.examId === examId) sessions.push(rec);
  }
  sessions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const wideAll: unknown[][] = [];
  const longAll: unknown[][] = [];
  for (const rec of sessions) {
    const m1 = await getJson<MeasurementsFile>(store, paths.measurements(rec.id, 1));
    const m2 = await getJson<MeasurementsFile>(store, paths.measurements(rec.id, 2));
    if (m2) wideAll.push(...wideRows(rec, m2.features, 2, m2.pipelineVersion));
    if (m1) longAll.push(...longRows(rec, m1.features, m1.pipelineVersion));
    if (m2) longAll.push(...longRows(rec, m2.features, m2.pipelineVersion));
  }
  const wide = toCsv(wideHeader(), wideAll);
  const long = toCsv(LONG_HEADER, longAll);
  await store.put(paths.wide(examId), wide, "text/csv; charset=utf-8");
  await store.put(paths.long(examId), long, "text/csv; charset=utf-8");
  return { wide, long };
}
