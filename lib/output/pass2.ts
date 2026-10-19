import { updateBaseline } from "@/lib/analysis/composite";
import { run, PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import type {
  AudioSource,
  Baseline,
  EnergyTrack,
  FeatureValue,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";
import type { BatchTranscriber } from "@/lib/asr/batch";
import { paths } from "@/lib/storage/paths";
import { getBytes, getJson, putJson, type ArchiveStore } from "@/lib/storage/store";
import { wavOffsetMs } from "@/lib/session/wavOffset";
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
  /** The course baseline this run used, so a replication run can reuse it. */
  baseline?: Baseline | null;
  label?: string;
  model?: string;
  createdAt?: string;
}

export interface TranscriptFile {
  words: Word[];
  model?: string;
  source?: AudioSource;
  raw?: unknown;
  createdAt?: string;
}

export interface ExamFile {
  title?: string;
  course?: string;
  unit?: string;
  targetPatterns?: string[];
  keyterms?: string[];
}

export { wavOffsetMs } from "@/lib/session/wavOffset";

export class Pass2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Pass2Options {
  source?: AudioSource;
  /**
   * A robustness check (build-plan P7.2) re-transcribes and re-measures into
   * separate robustness files and leaves the record of account alone.
   */
  robustness?: boolean;
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
): Promise<{ record: SessionRecord; features: FeatureValue[]; measurementsPath: string }> {
  const rec = await getJson<SessionRecord>(store, paths.session(sessionId));
  if (!rec) throw new Pass2Error(`No archived session ${sessionId}`, 404);
  if (rec.excluded) {
    throw new Pass2Error(`Session ${sessionId} is excluded: ${rec.excluded.reason}`, 409);
  }
  if (rec.markers.startMs === null || rec.markers.stopMs === null) {
    throw new Pass2Error(`Session ${sessionId} has no Start and Stop markers`, 409);
  }
  // An imported pair's audio is its slice of the session file, stored where the live WAV goes.
  const source = rec.captureMode === "file-import" ? "file" : (opts.source ?? "usb");
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
  return measureAndPublish(store, rec, words, { raw, model, source, robustness: opts.robustness });
}

/**
 * Runs the pipeline over pass-two words and writes the measurements, the
 * record, the baseline, the instructor file, both documents, and the CSVs.
 * Pass two calls it with fresh words; recomputeStored calls it with the
 * stored transcript and leaves that transcript untouched.
 */
async function measureAndPublish(
  store: ArchiveStore,
  rec: SessionRecord,
  words: Word[],
  t: {
    raw: unknown;
    model: string;
    source: AudioSource;
    robustness?: boolean;
    keepTranscript?: boolean;
    event?: { type: string; detail: unknown };
  },
): Promise<{ record: SessionRecord; features: FeatureValue[]; measurementsPath: string }> {
  const sessionId = rec.id;
  const { raw, model, source } = t;
  const energy = await getJson<EnergyTrack>(store, paths.energy(sessionId));
  const baseline = await getJson<Baseline>(store, paths.baseline(rec.examId));
  const pass1 = await getJson<MeasurementsFile>(store, paths.measurements(sessionId, 1));
  const markers = { startMs: rec.markers.startMs!, stopMs: rec.markers.stopMs! };
  const result = run(words, energy, rec.config, baseline, {
    pass: 2,
    markers,
    channelMap: rec.channelMap ?? { "0": "A", "1": "B" },
    previousPass: pass1?.features ?? null,
  });
  const now = new Date().toISOString();

  if (t.robustness) {
    const stamp = now.replace(/[:.]/g, "-");
    const tPath = `transcripts/${sessionId}/robustness-${stamp}.json`;
    const mPath = `measurements/${sessionId}/robustness-${stamp}.json`;
    await putJson(store, tPath, {
      words: result.words,
      model,
      source,
      raw,
      createdAt: now,
    } satisfies TranscriptFile);
    await putJson(store, mPath, {
      pipelineVersion: PIPELINE_VERSION,
      pass: 2,
      features: result.features,
      removedSpans: result.removedSpans,
      quality: result.quality,
      baseline,
      label: "robustness check",
      model,
      createdAt: now,
    } satisfies MeasurementsFile);
    const record: SessionRecord = {
      ...rec,
      events: [
        ...rec.events,
        {
          type: "robustness_check",
          atMs: markers.stopMs,
          detail: { model, source, at: now, measurements: mPath },
        },
      ],
    };
    await putJson(store, paths.session(sessionId), record);
    return { record, features: result.features, measurementsPath: mPath };
  }

  if (!t.keepTranscript) {
    await putJson(store, paths.transcript(sessionId, 2), {
      words: result.words,
      model,
      source,
      raw,
      createdAt: now,
    } satisfies TranscriptFile);
  }
  await putJson(store, paths.measurements(sessionId, 2), {
    pipelineVersion: PIPELINE_VERSION,
    pass: 2,
    features: result.features,
    removedSpans: result.removedSpans,
    quality: result.quality,
    baseline,
    model,
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
      // A rerun of pass two replaces its own long-pause events.
      ...rec.events.filter(
        (e) =>
          !(e.type === "long_pause" && (e.detail as { pass?: number } | undefined)?.pass === 2),
      ),
      t.event
        ? { type: t.event.type, atMs: markers.stopMs, detail: t.event.detail }
        : { type: "pass2", atMs: markers.stopMs, detail: { model, source, at: now } },
      ...result.longPauses.map((lp) => ({
        type: "long_pause",
        atMs: lp.startMs,
        detail: { pass: 2, ...lp },
      })),
    ],
  };
  await putJson(store, paths.session(sessionId), record);

  // Course baseline from pass-two values (record of account).
  const comps = (["A", "B"] as const).map((P) => ({
    speech_rate_wpm: findValue(result.features, "speech_rate_wpm", P, null)?.value ?? null,
    // Weights 1.1: the pause component is the mid-clause rate.
    silent_pause_rate:
      findValue(result.features, "silent_pause_mid_clause_rate", P, 350)?.value ?? null,
    mean_length_of_run: findValue(result.features, "mean_length_of_run", P, 350)?.value ?? null,
  }));
  await putJson(
    store,
    paths.baseline(rec.examId),
    updateBaseline(baseline, comps, sessionId, rec.config.weightsVersion),
  );

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
      course: exam?.course || exam?.title,
      unit: exam?.unit || undefined,
      words: result.words,
      pass1: pass1?.features ?? null,
      pass2: result.features,
      removedSpans: result.removedSpans,
      unattributedRatio: result.quality.unattributedRatio,
    });
    await store.put(paths.document(sessionId, student), doc);
  }

  await appendExports(store, record, pass1?.features ?? [], result.features);
  return { record, features: result.features, measurementsPath: paths.measurements(sessionId, 2) };
}

/**
 * Recompute from the stored transcript with the exam's current target
 * patterns and keyterms (work order 02, item 9). The stored pass-two
 * transcript stays as it is; the previous measurements move to a dated file
 * beside the new ones, and the record logs both pattern lists.
 */
export async function recomputeStored(
  store: ArchiveStore,
  sessionId: string,
): Promise<{ record: SessionRecord; features: FeatureValue[]; previous: string }> {
  const rec = await getJson<SessionRecord>(store, paths.session(sessionId));
  if (!rec) throw new Pass2Error(`No archived session ${sessionId}`, 404);
  if (rec.excluded)
    throw new Pass2Error(`Session ${sessionId} is excluded: ${rec.excluded.reason}`, 409);
  const transcript = await getJson<TranscriptFile>(store, paths.transcript(sessionId, 2));
  const before = await getBytes(store, paths.measurements(sessionId, 2));
  if (!transcript || !before) throw new Pass2Error(`Session ${sessionId} has no pass two yet`, 409);
  const exam = await getJson<ExamFile>(store, paths.exam(rec.examId));
  const now = new Date().toISOString();
  const previous = `measurements/${sessionId}/pass2-before-${now.replace(/[:.]/g, "-")}.json`;
  await store.put(previous, before, "application/json");
  const config = {
    ...rec.config,
    targetPatterns: exam?.targetPatterns ?? rec.config.targetPatterns,
    keyterms: exam?.keyterms ?? rec.config.keyterms,
  };
  const out = await measureAndPublish(store, { ...rec, config }, transcript.words, {
    raw: null,
    model: transcript.model ?? rec.deepgramModel,
    source: transcript.source ?? "usb",
    keepTranscript: true,
    event: {
      type: "recompute",
      detail: {
        at: now,
        previousMeasurements: previous,
        targetPatterns: { before: rec.config.targetPatterns, after: config.targetPatterns },
        keyterms: { before: rec.config.keyterms, after: config.keyterms },
      },
    },
  });
  return { ...out, previous };
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
    if (rec.excluded) continue;
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
