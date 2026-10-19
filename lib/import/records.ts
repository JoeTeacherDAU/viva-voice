// Session records and the upload plan for an imported session file
// (work order 02). One record per pair, in the shape the live path writes.

import { PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import {
  DEFAULT_CONFIG,
  type EnergyTrack,
  type Exclusion,
  type SessionRecord,
} from "@/lib/analysis/types";
import type { ExamRecord, RosterEntry } from "@/lib/exams";
import { pairSessionId, paths } from "@/lib/storage/paths";
import { sortedRows, type ManifestRow } from "./manifest";
import { MIN_ZERO_RUN_MS, ENERGY_FRAME_MS, scanSlice, type ZeroRun } from "./scan";
import type { Segment } from "./segments";
import { sliceBlob, sliceHeader, frameBytes, type SessionWavInfo } from "./wavfile";

export type ConsentStatus = Exclusion["consent"][string];

/** Consent per participant: the roster's status, or "unknown" when the roster lacks the id. */
export function consentFor(roster: RosterEntry[] | null, participantId: string): ConsentStatus {
  return roster?.find((r) => r.participantId === participantId)?.consentStatus ?? "unknown";
}

/** A pair proceeds only when both participants have granted consent. */
export function exclusionFor(
  roster: RosterEntry[] | null,
  row: ManifestRow,
): Exclusion | undefined {
  const consent = {
    [row.leftId]: consentFor(roster, row.leftId),
    [row.rightId]: consentFor(roster, row.rightId),
  };
  return Object.values(consent).every((c) => c === "granted")
    ? undefined
    : { reason: "consent", consent };
}

/** Optional measurement window inside a slice, in ms from the slice's first frame. */
export interface PairWindow {
  startMs: number;
  stopMs: number;
}

export interface ImportInput {
  exam: Pick<ExamRecord, "id" | "targetPatterns" | "keyterms" | "durationMs">;
  sessionLabel: string;
  sessionDate: string;
  info: SessionWavInfo;
  rawSha256: string;
  segments: Segment[];
  rows: ManifestRow[];
  roster: RosterEntry[] | null;
  /** Window per segment key; the whole slice when absent. */
  windows?: Record<string, PairWindow | undefined>;
  now?: Date;
}

export const sliceMs = (info: SessionWavInfo, seg: { start: number; end: number }) =>
  ((seg.end - seg.start) * 1000) / info.sampleRate;

/**
 * One session record per pair. Channel 0 (left) is student A and channel 1
 * (right) is student B, so the manifest's left and right IDs land in
 * participantIds.A and participantIds.B. sliceSha256 per segment key comes
 * from scanSlice.
 */
export function buildPairRecords(
  input: ImportInput,
  sliceSha: Record<string, string>,
): SessionRecord[] {
  const rows = sortedRows(input.rows);
  if (rows.length !== input.segments.length) {
    throw new Error(
      `${input.segments.length} segments and ${rows.length} manifest rows; the counts must match.`,
    );
  }
  const now = (input.now ?? new Date()).toISOString();
  const rawPath = paths.sessionRaw(input.sessionLabel);
  return input.segments.map((seg, i) => {
    const row = rows[i];
    const id = pairSessionId(input.sessionLabel, row.order);
    const whole = sliceMs(input.info, seg);
    const w = input.windows?.[seg.key];
    const excluded = exclusionFor(input.roster, row);
    const source = {
      mode: "session-file" as const,
      sessionLabel: input.sessionLabel,
      sessionDate: input.sessionDate,
      order: row.order,
      rawPath,
      rawSha256: input.rawSha256,
      sliceSha256: sliceSha[seg.key],
      startFrame: seg.start,
      endFrame: seg.end,
      sampleRate: input.info.sampleRate,
      bitsPerSample: input.info.bitsPerSample,
      encoding: input.info.encoding,
    };
    const rec: SessionRecord = {
      id,
      examId: input.exam.id,
      captureMode: "file-import",
      source,
      participantIds: { A: row.leftId, B: row.rightId },
      channelMap: { "0": "A", "1": "B" },
      config: {
        ...DEFAULT_CONFIG,
        targetPatterns: input.exam.targetPatterns,
        keyterms: input.exam.keyterms,
        durationMs: input.exam.durationMs,
      },
      markers: { startMs: w?.startMs ?? 0, stopMs: w?.stopMs ?? whole },
      events: [
        {
          type: "file_import",
          atMs: 0,
          detail: { ...source, sliceMs: whole, window: w ? "edited" : "whole slice" },
        },
        ...(excluded ? [{ type: "excluded", atMs: 0, detail: excluded }] : []),
      ],
      instructorLiveScore: null,
      passes: {},
      pipelineVersion: PIPELINE_VERSION,
      deepgramModel: "",
      firmware: { tx: "unknown", rx: "unknown" },
      createdAt: now,
    };
    if (excluded) rec.excluded = excluded;
    return rec;
  });
}

/** sessions-raw/{label}.json: what the import saw and did, for replication. */
export interface ImportRecord {
  mode: "session-file";
  sessionLabel: string;
  sessionDate: string;
  examId: string;
  fileName: string;
  fileBytes: number;
  rawPath: string;
  rawSha256: string;
  header: WavHeaderRecord;
  thresholds: { minZeroRunMs: number; energyFrameMs: number };
  zeroRuns: ZeroRun[];
  proposedSegments: { start: number; end: number }[];
  edits: string[];
  pairs: {
    order: number;
    sessionId: string;
    leftId: string;
    rightId: string;
    startFrame: number;
    endFrame: number;
    startByte: number;
    endByte: number;
    sliceSha256: string;
    excluded: boolean;
  }[];
  derivedCopies: never[];
  createdAt: string;
}

/** A WAV header as the import records store it, with the fmt chunk in hex. */
export type WavHeaderRecord = Omit<SessionWavInfo, "fmtChunk"> & { fmtChunkHex: string };

export function headerRecord(info: SessionWavInfo): WavHeaderRecord {
  const { fmtChunk, ...header } = info;
  return {
    ...header,
    fmtChunkHex: [...fmtChunk].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

export interface UploadItem {
  key: string;
  label: string;
  pathname: string;
  contentType: string;
  /** Builds the body when the upload starts, so slices and energy stay lazy. */
  body: () => Promise<Blob>;
}

export const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: "application/json" });

/**
 * Everything the import uploads, in order: the untouched session file, its
 * energy, then per pair the slice, the slice's energy, and the session
 * record, and last the import record. The page writes the import record only
 * after every other file arrives, so an existing import record means a
 * complete import.
 */
export async function planUpload(
  file: File | Blob,
  fileName: string,
  input: ImportInput,
  scan: { zeroRuns: ZeroRun[]; energy: EnergyTrack; proposed: { start: number; end: number }[] },
  edits: string[],
  onSlice: (done: number, total: number) => void = () => {},
): Promise<{ items: UploadItem[]; records: SessionRecord[]; importRecord: ImportRecord }> {
  const { info, sessionLabel } = input;
  // Each slice's hash and energy come from one read of its bytes.
  const sliceSha: Record<string, string> = {};
  const sliceEnergy: Record<string, EnergyTrack> = {};
  for (const [k, seg] of input.segments.entries()) {
    onSlice(k, input.segments.length);
    const header = sliceHeader(info, (seg.end - seg.start) * info.blockAlign);
    const r = await scanSlice(file, info, seg.start, seg.end, header);
    sliceSha[seg.key] = r.sha256;
    sliceEnergy[seg.key] = r.energy;
  }
  onSlice(input.segments.length, input.segments.length);
  const records = buildPairRecords(input, sliceSha);
  const rows = sortedRows(input.rows);
  const importRecord: ImportRecord = {
    mode: "session-file",
    sessionLabel,
    sessionDate: input.sessionDate,
    examId: input.exam.id,
    fileName,
    fileBytes: file.size,
    rawPath: paths.sessionRaw(sessionLabel),
    rawSha256: input.rawSha256,
    header: headerRecord(info),
    thresholds: { minZeroRunMs: MIN_ZERO_RUN_MS, energyFrameMs: ENERGY_FRAME_MS },
    zeroRuns: scan.zeroRuns,
    proposedSegments: scan.proposed,
    edits,
    pairs: records.map((r, i) => {
      const seg = input.segments[i];
      const bytes = frameBytes(info, seg.start, seg.end);
      return {
        order: rows[i].order,
        sessionId: r.id,
        leftId: rows[i].leftId,
        rightId: rows[i].rightId,
        startFrame: seg.start,
        endFrame: seg.end,
        startByte: bytes.start,
        endByte: bytes.end,
        sliceSha256: sliceSha[seg.key],
        excluded: !!r.excluded,
      };
    }),
    // Deepgram reads 16-bit, 24-bit, and float WAV, and the energy code decodes
    // all three, so no pair needs a converted copy.
    derivedCopies: [],
    createdAt: (input.now ?? new Date()).toISOString(),
  };

  const items: UploadItem[] = [
    {
      key: "raw",
      label: `Session file ${fileName}`,
      pathname: paths.sessionRaw(sessionLabel),
      contentType: "audio/wav",
      body: async () => file,
    },
    {
      key: "raw-energy",
      label: "Session energy frames",
      pathname: paths.sessionEnergy(sessionLabel),
      contentType: "application/json",
      body: async () => json(scan.energy),
    },
  ];
  input.segments.forEach((seg, i) => {
    const rec = records[i];
    const tag = `Pair ${rows[i].order}`;
    items.push(
      {
        key: `${rec.id}-audio`,
        label: `${tag} audio`,
        pathname: paths.stereo(rec.id),
        contentType: "audio/wav",
        body: async () => sliceBlob(file, info, seg.start, seg.end),
      },
      {
        key: `${rec.id}-energy`,
        label: `${tag} energy frames`,
        pathname: paths.energy(rec.id),
        contentType: "application/json",
        body: async () => json(sliceEnergy[seg.key]),
      },
      {
        key: `${rec.id}-record`,
        label: `${tag} session record`,
        pathname: paths.session(rec.id),
        contentType: "application/json",
        body: async () => json(rec),
      },
    );
  });
  items.push({
    key: "import-record",
    label: "Import record",
    pathname: paths.sessionImport(sessionLabel),
    contentType: "application/json",
    body: async () => json(importRecord),
  });
  return { items, records, importRecord };
}

/** Which pairs pass two runs, in order, and which it skips with the reason. */
export function pass2Queue(records: SessionRecord[]): {
  run: string[];
  skip: { id: string; reason: string }[];
} {
  const run: string[] = [];
  const skip: { id: string; reason: string }[] = [];
  for (const r of [...records].sort((a, b) => (a.source?.order ?? 0) - (b.source?.order ?? 0))) {
    if (r.excluded) skip.push({ id: r.id, reason: `excluded: ${r.excluded.reason}` });
    else run.push(r.id);
  }
  return { run, skip };
}
