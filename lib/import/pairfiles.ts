// Pair file import (work order 03). Audacity exports each pair as its own
// stereo WAV, and the manifest names the file for each pair. Each file becomes
// one session record and goes to the archive byte for byte. Nothing here cuts
// or segments audio; the import matches files to rows by name and never by
// position or length.

import { PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import {
  DEFAULT_CONFIG,
  type EnergyTrack,
  type PairFileSource,
  type SessionRecord,
} from "@/lib/analysis/types";
import type { ExamRecord, RosterEntry } from "@/lib/exams";
import { pairSessionId, paths } from "@/lib/storage/paths";
import { cells, checkManifest, sessionReasons, sortedRows } from "./manifest";
import { exclusionFor, headerRecord, json, type UploadItem, type WavHeaderRecord } from "./records";
import { readSessionWavInfo, WavFormatProblem, type SessionWavInfo } from "./wavfile";

export interface PairManifestRow {
  order: number;
  track: string;
  file: string;
  leftId: string;
  rightId: string;
}

export const PAIR_MANIFEST_COLUMNS = ["order", "track", "file", "left_id", "right_id"] as const;

/** File names compare after Unicode normalisation, so macOS and Drive spellings agree. */
export const fileKey = (name: string) => name.normalize("NFC").trim();

/** The name part of a manifest file cell, in case it carries a folder. */
const baseName = (name: string) => name.split(/[\\/]/).at(-1) ?? name;

/**
 * Parses a pair manifest. The header names the columns, in any order; every
 * one of order, track, file, left_id, right_id must appear. Problems name the
 * line.
 */
export function parsePairManifestCsv(text: string): {
  rows: PairManifestRow[];
  problems: string[];
} {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], problems: ["The CSV file is empty."] };
  const head = cells(lines[0].l).map((h) => h.toLowerCase());
  const lacking = PAIR_MANIFEST_COLUMNS.filter((c) => !head.includes(c));
  if (lacking.length) {
    const why = lacking.includes("file")
      ? " Without a file column the page cannot tell which WAV belongs to which pair."
      : "";
    return {
      rows: [],
      problems: [
        `Line 1 must name the columns order,track,file,left_id,right_id. It reads ${lines[0].l.trim()}, which lacks ${lacking.join(", ")}.${why}`,
      ],
    };
  }
  const at = Object.fromEntries(PAIR_MANIFEST_COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<
    (typeof PAIR_MANIFEST_COLUMNS)[number],
    number
  >;
  const problems: string[] = [];
  const rows: PairManifestRow[] = [];
  for (const { l, n } of lines.slice(1)) {
    const c = cells(l);
    if (c.length !== head.length) {
      problems.push(`Line ${n} has ${c.length} columns; the header has ${head.length}.`);
      continue;
    }
    rows.push({
      order: Number(c[at.order]),
      track: c[at.track],
      file: baseName(c[at.file]),
      leftId: c[at.left_id],
      rightId: c[at.right_id],
    });
  }
  return { rows, problems: [...problems, ...checkPairManifest(rows)] };
}

/** The work order 02 rules for order and IDs, plus a file name per row, each used once. */
export function checkPairManifest(rows: PairManifestRow[]): string[] {
  const problems = checkManifest(rows);
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.file) problems.push(`Row ${i + 1}: the file name is empty.`);
    else if (seen.has(fileKey(r.file)))
      problems.push(
        `Row ${i + 1}: the file ${r.file} also appears in row ${seen.get(fileKey(r.file))}.`,
      );
    else seen.set(fileKey(r.file), i + 1);
  });
  return problems;
}

export interface PairMatch {
  /** Manifest rows in recording order, each with the index of its chosen file. */
  matched: { row: PairManifestRow; index: number }[];
  /** Rows whose file is not among the chosen files. */
  missing: PairManifestRow[];
  /** Chosen files that no row names. */
  extra: string[];
}

/** Matches chosen files to manifest rows by file name only. */
export function matchPairFiles(rows: PairManifestRow[], names: string[]): PairMatch {
  const byName = new Map(names.map((n, i) => [fileKey(n), i]));
  const named = new Set(rows.map((r) => fileKey(r.file)));
  const matched: PairMatch["matched"] = [];
  const missing: PairManifestRow[] = [];
  for (const row of sortedRows(rows)) {
    const index = byName.get(fileKey(row.file));
    if (index === undefined) missing.push(row);
    else matched.push({ row, index });
  }
  const extra = names.filter((n) => !named.has(fileKey(n)));
  return { matched, missing, extra };
}

/**
 * The header check for a pair file: 2 channels of 16-bit or 24-bit PCM.
 * Returns the header, or a message that names what the file holds.
 */
export async function checkPairWav(
  file: Blob,
): Promise<{ info: SessionWavInfo; problem?: undefined } | { info?: undefined; problem: string }> {
  try {
    const info = await readSessionWavInfo(file);
    if (info.encoding === "float32") {
      return {
        problem: `This file contains 2 channels, ${info.sampleRate} Hz, 32-bit float. Pair files must be PCM; export them from Audacity as signed 24-bit PCM.`,
      };
    }
    return { info };
  } catch (e) {
    if (e instanceof WavFormatProblem) return { problem: e.message };
    throw e;
  }
}

export const durationMs = (frames: number, sampleRate: number) => (frames * 1000) / sampleRate;

/** What a chosen pair file looks like once its header has been read. */
export interface ChosenFile {
  name: string;
  info?: SessionWavInfo;
  problem?: string;
}

export function pairUploadGate(input: {
  examReady: boolean;
  sessionLabel: string;
  sessionDate: string;
  labelTaken: boolean;
  rows: PairManifestRow[];
  manifestProblems: string[];
  files: ChosenFile[];
  confirmed: boolean;
}): { ok: boolean; reasons: string[] } {
  const reasons = sessionReasons(input);
  if (input.rows.length === 0) reasons.push("Load the manifest CSV.");
  reasons.push(...input.manifestProblems);
  const m = matchPairFiles(
    input.rows,
    input.files.map((f) => f.name),
  );
  if (input.files.length === 0) reasons.push("Choose the pair WAV files.");
  for (const row of m.missing) {
    reasons.push(
      `Manifest row ${row.order} names ${row.file}, and no chosen file has that name. Choose it with the other pair files.`,
    );
  }
  for (const name of m.extra) {
    reasons.push(
      `The chosen file ${name} matches no manifest row. Choose the pair files again without it, or add its row to the manifest.`,
    );
  }
  for (const f of input.files) {
    if (f.problem) reasons.push(`${f.name}: ${f.problem}`);
    else if (!f.info) reasons.push(`${f.name}: the page is still reading its header.`);
  }
  if (reasons.length === 0 && !input.confirmed)
    reasons.push("Check the table, then tick the box that confirms it.");
  return { ok: reasons.length === 0, reasons };
}

/** One pair file, read and hashed, ready to become a record. */
export interface ReadPair {
  row: PairManifestRow;
  file: Blob;
  fileName: string;
  info: SessionWavInfo;
  sha256: string;
  energy: EnergyTrack;
}

export interface PairImportInput {
  exam: Pick<ExamRecord, "id" | "targetPatterns" | "keyterms" | "durationMs">;
  sessionLabel: string;
  sessionDate: string;
  roster: RosterEntry[] | null;
  pairs: ReadPair[];
  manifest: { fileName: string; text: string };
  now?: Date;
}

/**
 * One session record per pair file. Channel 0 (left) is student A and channel
 * 1 (right) is student B, as in work order 02.
 */
export function buildPairFileRecords(input: PairImportInput): SessionRecord[] {
  const now = (input.now ?? new Date()).toISOString();
  return [...input.pairs]
    .sort((a, b) => a.row.order - b.row.order)
    .map((p) => {
      const id = pairSessionId(input.sessionLabel, p.row.order);
      const whole = durationMs(p.info.frames, p.info.sampleRate);
      const excluded = exclusionFor(input.roster, p.row);
      const source: PairFileSource = {
        mode: "pair-file",
        sessionLabel: input.sessionLabel,
        sessionDate: input.sessionDate,
        order: p.row.order,
        fileName: p.fileName,
        track: p.row.track,
        fileSha256: p.sha256,
        fileBytes: p.file.size,
        frames: p.info.frames,
        sampleRate: p.info.sampleRate,
        bitsPerSample: p.info.bitsPerSample,
        encoding: p.info.encoding as PairFileSource["encoding"],
      };
      const rec: SessionRecord = {
        id,
        examId: input.exam.id,
        captureMode: "file-import",
        source,
        participantIds: { A: p.row.leftId, B: p.row.rightId },
        channelMap: { "0": "A", "1": "B" },
        config: {
          ...DEFAULT_CONFIG,
          targetPatterns: input.exam.targetPatterns,
          keyterms: input.exam.keyterms,
          durationMs: input.exam.durationMs,
        },
        markers: { startMs: 0, stopMs: whole },
        events: [
          { type: "file_import", atMs: 0, detail: { ...source, fileMs: whole } },
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

/** sessions-raw/{label}.json for a pair-file import. */
export interface PairImportRecord {
  mode: "pair-file";
  sessionLabel: string;
  sessionDate: string;
  examId: string;
  manifestFileName: string;
  /** The manifest exactly as loaded. */
  manifestCsv: string;
  files: {
    order: number;
    track: string;
    fileName: string;
    fileBytes: number;
    sha256: string;
    sessionId: string;
    leftId: string;
    rightId: string;
    durationMs: number;
    header: WavHeaderRecord;
    excluded: boolean;
  }[];
  derivedCopies: never[];
  createdAt: string;
}

/**
 * Everything a pair-file import uploads, in order: per pair the file
 * unchanged, its energy, and its record, and last the import record, so an existing import record means a complete import.
 */
export function planPairUpload(input: PairImportInput): {
  items: UploadItem[];
  records: SessionRecord[];
  importRecord: PairImportRecord;
} {
  const { sessionLabel } = input;
  const pairs = [...input.pairs].sort((a, b) => a.row.order - b.row.order);
  const records = buildPairFileRecords(input);
  const importRecord: PairImportRecord = {
    mode: "pair-file",
    sessionLabel,
    sessionDate: input.sessionDate,
    examId: input.exam.id,
    manifestFileName: input.manifest.fileName,
    manifestCsv: input.manifest.text,
    files: pairs.map((p, i) => ({
      order: p.row.order,
      track: p.row.track,
      fileName: p.fileName,
      fileBytes: p.file.size,
      sha256: p.sha256,
      sessionId: records[i].id,
      leftId: p.row.leftId,
      rightId: p.row.rightId,
      durationMs: durationMs(p.info.frames, p.info.sampleRate),
      header: headerRecord(p.info),
      excluded: !!records[i].excluded,
    })),
    derivedCopies: [],
    createdAt: (input.now ?? new Date()).toISOString(),
  };

  const items: UploadItem[] = [];
  pairs.forEach((p, i) => {
    const rec = records[i];
    const tag = `Pair ${p.row.order}`;
    items.push(
      {
        key: `${rec.id}-audio`,
        label: `${tag} ${p.fileName}`,
        pathname: paths.stereo(rec.id),
        contentType: "audio/wav",
        body: async () => p.file,
      },
      {
        key: `${rec.id}-energy`,
        label: `${tag} energy frames`,
        pathname: paths.energy(rec.id),
        contentType: "application/json",
        body: async () => json(p.energy),
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
