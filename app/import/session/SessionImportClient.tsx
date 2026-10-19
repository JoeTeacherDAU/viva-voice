"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { SessionRecord } from "@/lib/analysis/types";
import { loadExam, loadRoster, type ExamRecord, type RosterEntry } from "@/lib/exams";
import {
  checkManifest,
  parseManifestCsv,
  sortedRows,
  uploadGate,
  type ManifestRow,
} from "@/lib/import/manifest";
import {
  exclusionFor,
  pass2Queue,
  planUpload,
  type PairWindow,
  type UploadItem,
} from "@/lib/import/records";
import { ENERGY_FRAME_MS, scanSessionFile, type ScanResult } from "@/lib/import/scan";
import {
  mergeWithNext,
  moveBoundary,
  proposeSegments,
  removeSegment,
  splitAt,
  suggestSplit,
  type Segment,
} from "@/lib/import/segments";
import { readSessionWavInfo, sliceBlob, type SessionWavInfo } from "@/lib/import/wavfile";
import { chooseUploader, type Uploader } from "@/lib/storage/archive";
import { paths } from "@/lib/storage/paths";
import { Button, Card, Icon } from "@/lib/ui";
import { WaveStrip } from "./WaveStrip";

const field = "rounded-control bg-surface-highest border border-outline-variant px-3 py-2";
const today = () => new Date().toLocaleDateString("en-CA");

/** m:ss.mmm from a frame count. */
function clock(frames: number, rate: number): string {
  const ms = Math.round((frames * 1000) / rate);
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

interface FileStatus {
  key: string;
  label: string;
  pathname: string;
  state: "waiting" | "uploading" | "done" | "failed";
  loaded: number;
  total: number;
  message?: string;
}

async function exists(pathname: string): Promise<boolean> {
  const r = await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (r.body) await r.body.cancel();
  return r.ok;
}

/**
 * Session file import (work order 02): a stereo WAV of a whole class session,
 * one pair per Audacity recording, cut into one archived session per pair.
 */
export function SessionImportClient() {
  // Session details and exam
  const [examId, setExamId] = useState("");
  const [exam, setExam] = useState<ExamRecord | null>(null);
  const [examState, setExamState] = useState<"idle" | "missing" | "found">("idle");
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(5);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [sessionLabel, setSessionLabel] = useState("");
  const [sessionDate, setSessionDate] = useState(today);
  const [labelTaken, setLabelTaken] = useState(false);

  // Manifest
  const [rows, setRows] = useState<ManifestRow[]>([{ order: 1, leftId: "", rightId: "" }]);
  const [csvMsg, setCsvMsg] = useState<string[]>([]);

  // File and segments
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<SessionWavInfo | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [proposed, setProposed] = useState<{ start: number; end: number }[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [edits, setEdits] = useState<string[]>([]);
  const [windows, setWindows] = useState<Record<string, PairWindow | undefined>>({});
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ key: string; url: string } | null>(null);

  // Upload and pass two
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [pass2, setPass2] = useState<Record<string, string>>({});
  const [pass2Msg, setPass2Msg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const plan = useRef<UploadItem[]>([]);
  const uploader = useRef<Uploader | null>(null);

  const rate = info?.sampleRate ?? 48000;
  const fpe = Math.round((rate * ENERGY_FRAME_MS) / 1000);
  const ordered = sortedRows(rows);
  const gate = uploadGate({
    segments: segments.length,
    rows,
    examReady: examState === "found",
    sessionLabel,
    sessionDate,
    labelTaken,
  });
  const uploadStarted = files.length > 0;
  const uploadDone = uploadStarted && files.every((f) => f.state === "done");

  // ------------------------------------------------------------- exam
  async function checkExam() {
    setExamMsg(null);
    try {
      const e = await loadExam(examId.trim());
      setExam(e);
      setExamState("found");
      await refreshRoster(e.id);
    } catch (e) {
      setExam(null);
      // Only a 404 means the exam does not exist; any other failure must not
      // offer to create an exam over one the archive might hold.
      if ((e as Error).message.includes("HTTP 404")) setExamState("missing");
      else {
        setExamState("idle");
        setExamMsg(`The exam did not load: ${(e as Error).message}. Try again.`);
      }
    }
  }

  async function refreshRoster(id: string) {
    try {
      setRoster(await loadRoster(id));
    } catch {
      setRoster(null);
    }
  }

  async function createExam() {
    const record: ExamRecord = {
      id: examId.trim(),
      title: newTitle.trim(),
      course: "",
      unit: "",
      prompt: "",
      targetPatterns: [],
      keyterms: [],
      durationMs: Math.round(newMinutes * 60_000),
    };
    const res = await fetch("/api/exam", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    const out = (await res.json()) as { error?: string };
    if (!res.ok) {
      setExamMsg(`The exam was not created: ${out.error ?? res.status}`);
      return;
    }
    setExam(record);
    setExamState("found");
    setExamMsg(`Created exam ${record.id}.`);
    await refreshRoster(record.id);
  }

  async function checkLabel(label: string) {
    setLabelTaken(
      /^[A-Za-z0-9_-]+$/.test(label) ? await exists(paths.sessionImport(label)) : false,
    );
  }

  // ------------------------------------------------------------- manifest
  function setRow(i: number, patch: Partial<ManifestRow>) {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  async function loadCsv(f: File | undefined) {
    if (!f) return;
    const { rows: parsed, problems } = parseManifestCsv(await f.text());
    setCsvMsg(problems);
    if (parsed.length) setRows(parsed);
  }

  // ------------------------------------------------------------- file
  async function chooseFile(f: File | undefined) {
    setFile(f ?? null);
    setInfo(null);
    setScan(null);
    setSegments([]);
    setProposed([]);
    setEdits([]);
    setWindows({});
    setFileMsg(null);
    if (!f) return;
    try {
      const i = await readSessionWavInfo(f);
      setInfo(i);
      setFileMsg(i.note ?? null);
    } catch (e) {
      setFileMsg((e as Error).message);
    }
  }

  async function findPairs() {
    if (!file || !info) return;
    setScanning("Reading 0 MB");
    try {
      const r = await scanSessionFile(file, info, (done, total) =>
        setScanning(`Reading ${mb(done)} of ${mb(total)}`),
      );
      const segs = proposeSegments(r.zeroRuns, r.frames);
      setScan(r);
      setSegments(segs);
      setProposed(segs.map(({ start, end }) => ({ start, end })));
      setEdits([]);
      setWindows({});
    } catch (e) {
      setFileMsg(`Reading the file stopped: ${(e as Error).message}`);
    } finally {
      setScanning(null);
    }
  }

  function edit(next: Segment[], note: string) {
    setSegments(next);
    if (note) setEdits((x) => [...x, note]);
  }

  function play(seg: Segment) {
    if (!file || !info) return;
    if (playing) URL.revokeObjectURL(playing.url);
    setPlaying({
      key: seg.key,
      url: URL.createObjectURL(sliceBlob(file, info, seg.start, seg.end)),
    });
  }

  // ------------------------------------------------------------- upload
  async function runItem(item: UploadItem) {
    const put = uploader.current!;
    const patch = (p: Partial<FileStatus>) =>
      setFiles((fs) => fs.map((f) => (f.key === item.key ? { ...f, ...p } : f)));
    patch({ state: "uploading", message: undefined });
    try {
      const body = await item.body();
      patch({ total: body.size });
      await put(item.pathname, body, item.contentType, (loaded, total) => patch({ loaded, total }));
      patch({ state: "done", loaded: body.size });
      return true;
    } catch (e) {
      patch({ state: "failed", message: (e as Error).message });
      return false;
    }
  }

  /** Uploads every file except the import record, which waits until the rest arrive. */
  async function runPending(statuses: Map<string, FileStatus["state"]>) {
    const last = plan.current.at(-1)!;
    let allOk = true;
    for (const item of plan.current.slice(0, -1)) {
      if (statuses.get(item.key) === "done") continue;
      if (!(await runItem(item))) allOk = false;
    }
    if (allOk && statuses.get(last.key) !== "done") await runItem(last);
  }

  async function startUpload() {
    if (!file || !info || !scan || !exam || !gate.ok) return;
    setPreparing("Checking the archive");
    try {
      if (await exists(paths.sessionImport(sessionLabel))) {
        setLabelTaken(true);
        return;
      }
      uploader.current = await chooseUploader();
      const built = await planUpload(
        file,
        file.name,
        {
          exam,
          sessionLabel,
          sessionDate,
          info,
          rawSha256: scan.sha256,
          segments,
          rows,
          roster,
          windows,
        },
        { zeroRuns: scan.zeroRuns, energy: scan.energy, proposed },
        edits,
        (k, n) => setPreparing(k < n ? `Reading pair ${k + 1} of ${n}` : "Starting the upload"),
      );
      plan.current = built.items;
      setRecords(built.records);
      setFiles(
        built.items.map((i) => ({
          key: i.key,
          label: i.label,
          pathname: i.pathname,
          state: "waiting",
          loaded: 0,
          total: 0,
        })),
      );
    } catch (e) {
      setFileMsg(`The upload could not start: ${(e as Error).message}`);
      return;
    } finally {
      setPreparing(null);
    }
    await runPending(new Map());
  }

  async function retry(key: string) {
    const statuses = new Map(files.map((f) => [f.key, f.state]));
    statuses.set(key, "waiting");
    await runPending(statuses);
  }

  // ------------------------------------------------------------- pass two
  async function runPass2All() {
    setRunning(true);
    setPass2Msg(null);
    try {
      const ready = (await (await fetch("/api/pass2", { cache: "no-store" })).json()) as {
        ready: boolean;
        error?: string;
      };
      if (!ready.ready) {
        setPass2Msg(ready.error ?? "Pass two cannot run.");
        return;
      }
      const q = pass2Queue(records);
      const status: Record<string, string> = {};
      for (const s of q.skip) status[s.id] = `skipped, ${s.reason}`;
      for (const id of q.run) status[id] = pass2[id] === "done" ? "done" : "waiting";
      setPass2({ ...status });
      for (const id of q.run) {
        if (status[id] === "done") continue;
        setPass2((p) => ({ ...p, [id]: "running" }));
        const res = await fetch("/api/pass2", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        });
        const out = (await res.json()) as { error?: string };
        if (res.ok) {
          status[id] = "done";
          setPass2((p) => ({ ...p, [id]: "done" }));
          continue;
        }
        setPass2((p) => ({ ...p, [id]: `failed: ${out.error ?? res.status}` }));
        if ((out.error ?? "").includes("DEEPGRAM_API_KEY")) {
          setPass2Msg(out.error!);
          return;
        }
      }
    } finally {
      setRunning(false);
    }
  }

  // ------------------------------------------------------------- render
  const consentLine = (row: ManifestRow) => {
    const ex = exclusionFor(roster, row);
    if (!ex) return null;
    const who = Object.entries(ex.consent)
      .filter(([, c]) => c !== "granted")
      .map(([id, c]) => `${id} ${c}`)
      .join(", ");
    return (
      <span className="text-warn text-sm" data-testid="consent-excluded">
        excluded: consent ({who})
      </span>
    );
  };

  return (
    <main className="flex flex-col gap-6 p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-baseline gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold">Import a session file</h1>
        <Link className="text-primary underline" href="/review">
          Review sessions
        </Link>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">1. Session</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            aria-label="Exam id"
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value);
              setExamState("idle");
            }}
            placeholder="exam id"
            className={field}
          />
          <Button onClick={checkExam} disabled={!examId.trim()}>
            Check exam
          </Button>
          {examState === "found" && exam ? (
            <span className="text-sm text-on-surface-variant" data-testid="exam-found">
              Exam {exam.id}
              {exam.title ? `, ${exam.title}` : ""}: {exam.durationMs / 60000} minutes,{" "}
              {exam.targetPatterns.length} target patterns.
            </span>
          ) : null}
        </div>
        {examState === "missing" ? (
          <div className="flex flex-col gap-3 border border-outline-variant rounded-control p-4">
            <p className="text-sm">
              The archive has no exam {examId.trim()}. Create it with a title and a duration. Target
              patterns and keyterms stay empty, and you can add them on the setup screen later.
            </p>
            <div className="flex gap-3 items-center flex-wrap">
              <input
                aria-label="Exam title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="title"
                className={field}
              />
              <label className="flex items-center gap-2 text-sm">
                Duration (minutes)
                <input
                  aria-label="Exam duration in minutes"
                  type="number"
                  min={1}
                  max={15}
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(Number(e.target.value))}
                  className={`${field} w-24`}
                />
              </label>
              <Button onClick={createExam} disabled={!newTitle.trim() || !(newMinutes >= 1)}>
                Create exam
              </Button>
            </div>
          </div>
        ) : null}
        {examMsg ? <p className="text-sm">{examMsg}</p> : null}
        {examState === "found" && roster === null ? (
          <p className="text-warn text-sm flex items-center gap-2">
            <Icon name="warning" />
            Exam {exam?.id} has no roster, so every pair counts as unknown consent and the import
            marks it excluded. Import the roster on the setup screen, then check the exam again.
          </p>
        ) : null}
        <div className="flex gap-3 items-center flex-wrap">
          <input
            aria-label="Session label"
            value={sessionLabel}
            onChange={(e) => {
              setSessionLabel(e.target.value.trim());
              setLabelTaken(false);
            }}
            onBlur={(e) => void checkLabel(e.target.value.trim())}
            placeholder="session label, e.g. C1_26_MIDS_S1"
            className={`${field} w-80`}
          />
          <label className="flex items-center gap-2 text-sm">
            Session date
            <input
              aria-label="Session date"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className={field}
            />
          </label>
        </div>
        {labelTaken ? (
          <p className="text-fault text-sm flex items-center gap-2">
            <Icon name="block" />
            The archive already holds session {sessionLabel}. Choose another label.
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">2. Pair manifest</h2>
        <p className="text-on-surface-variant text-sm">
          One row per pair in recording order: the participant on the left channel and the
          participant on the right. Type the rows, or load a CSV with the columns
          order,left_id,right_id.
        </p>
        <table className="text-sm w-full max-w-2xl" data-testid="manifest-table">
          <thead className="text-on-surface-variant text-left">
            <tr>
              <th className="py-1 pr-3">Order</th>
              <th className="py-1 pr-3 text-student-a">Left channel ID</th>
              <th className="py-1 pr-3 text-student-b">Right channel ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`Order, row ${i + 1}`}
                    type="number"
                    min={1}
                    value={Number.isFinite(r.order) ? r.order : ""}
                    onChange={(e) => setRow(i, { order: Number(e.target.value) })}
                    className={`${field} w-20`}
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`Left channel ID, row ${i + 1}`}
                    value={r.leftId}
                    onChange={(e) => setRow(i, { leftId: e.target.value.trim() })}
                    className={field}
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`Right channel ID, row ${i + 1}`}
                    value={r.rightId}
                    onChange={(e) => setRow(i, { rightId: e.target.value.trim() })}
                    className={field}
                  />
                </td>
                <td className="py-1">
                  <Button
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
                    disabled={uploadStarted}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-3 flex-wrap items-center text-sm">
          <Button
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { order: Math.max(0, ...rs.map((r) => r.order || 0)) + 1, leftId: "", rightId: "" },
              ])
            }
            disabled={uploadStarted}
          >
            Add pair
          </Button>
          <label className="rounded-control border border-outline-variant px-4 py-2.5 cursor-pointer">
            Load manifest CSV
            <input
              aria-label="Manifest CSV"
              type="file"
              accept="text/csv,.csv"
              className="sr-only"
              onChange={(e) => void loadCsv(e.target.files?.[0])}
            />
          </label>
          <span className="text-on-surface-variant">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        {[...csvMsg, ...(rows.some((r) => r.leftId || r.rightId) ? checkManifest(rows) : [])].map(
          (m) => (
            <p key={m} className="text-warn text-sm">
              {m}
            </p>
          ),
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">3. Session file</h2>
        <p className="text-on-surface-variant text-sm">
          The stereo WAV exported from Audacity. The page reads it in pieces on this computer; it
          leaves your computer only when you press Upload.
        </p>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            aria-label="Session WAV"
            type="file"
            accept="audio/wav,.wav"
            onChange={(e) => void chooseFile(e.target.files?.[0])}
            disabled={uploadStarted}
          />
          <Button onClick={findPairs} disabled={!info || scanning !== null || uploadStarted}>
            Find pairs
          </Button>
          {scanning ? <span className="text-sm text-on-surface-variant">{scanning}</span> : null}
        </div>
        {info && file ? (
          <p className="text-sm text-on-surface-variant" data-testid="file-info">
            {file.name}: {mb(file.size)}, {info.sampleRate} Hz, {info.bitsPerSample}-bit{" "}
            {info.encoding === "float32" ? "float" : "PCM"}, {info.channels} channels,{" "}
            {clock(info.frames, info.sampleRate)} long.
          </p>
        ) : null}
        {fileMsg ? (
          <p className="text-fault text-sm flex items-center gap-2" data-testid="file-message">
            <Icon name="block" />
            {fileMsg}
          </p>
        ) : null}
      </Card>

      {scan && info ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-medium">4. Review the segments</h2>
          <p className="text-on-surface-variant text-sm">
            Each segment lies between stretches of at least 500 ms where both channels read exactly
            zero. Drag a boundary, type a time, merge, split, or delete until each segment holds one
            pair. Segment 1 matches manifest row 1 in recording order, and so on.
          </p>
          <WaveStrip
            label="Whole session"
            energy={scan.energy}
            framesPerEnergyFrame={fpe}
            from={0}
            to={scan.frames}
            segments={segments.map((seg, index) => ({ seg, index }))}
            onMove={
              uploadStarted
                ? undefined
                : (i, edge, f) => setSegments((s) => moveBoundary(s, i, edge, f, scan.frames))
            }
            onMoveEnd={() => setEdits((x) => [...x, "dragged a boundary on the session view"])}
          />
          <p
            data-testid="segment-count"
            className={segments.length === rows.length ? "text-sm" : "text-fault text-sm"}
          >
            {segments.length} segment{segments.length === 1 ? "" : "s"}, {rows.length} manifest row
            {rows.length === 1 ? "" : "s"}.
          </p>
          <ol className="flex flex-col gap-4">
            {segments.map((seg, i) => {
              const row = segments.length === rows.length ? ordered[i] : undefined;
              const pad = 2 * rate;
              const w = windows[seg.key];
              return (
                <li
                  key={seg.key}
                  data-testid="segment"
                  className="flex flex-col gap-2 border-t border-outline-variant pt-3"
                >
                  <div className="flex gap-4 flex-wrap items-center text-sm">
                    <span className="font-semibold">Segment {i + 1}</span>
                    <span data-testid="segment-times">
                      {clock(seg.start, rate)} to {clock(seg.end, rate)} (
                      {clock(seg.end - seg.start, rate)})
                    </span>
                    <span data-testid="segment-row">
                      {row ? (
                        <>
                          Manifest row {row.order}:{" "}
                          <span className="text-student-a">left {row.leftId || "?"}</span>,{" "}
                          <span className="text-student-b">right {row.rightId || "?"}</span>
                        </>
                      ) : (
                        <span className="text-on-surface-variant">
                          no match until the counts agree
                        </span>
                      )}
                    </span>
                    {row ? consentLine(row) : null}
                  </div>
                  <WaveStrip
                    label={`Segment ${i + 1}`}
                    height={56}
                    energy={scan.energy}
                    framesPerEnergyFrame={fpe}
                    from={Math.max(0, seg.start - pad)}
                    to={Math.min(scan.frames, seg.end + pad)}
                    segments={[{ seg, index: i }]}
                    onMove={
                      uploadStarted
                        ? undefined
                        : (k, edge, f) =>
                            setSegments((s) => moveBoundary(s, k, edge, f, scan.frames))
                    }
                    onMoveEnd={() =>
                      setEdits((x) => [...x, `dragged a boundary of segment ${i + 1}`])
                    }
                  />
                  <div className="flex gap-3 flex-wrap items-center text-sm">
                    {(["start", "end"] as const).map((edge) => (
                      <label key={edge} className="flex items-center gap-2">
                        {edge === "start" ? "Start (s)" : "End (s)"}
                        <input
                          aria-label={`Segment ${i + 1} ${edge} in seconds`}
                          type="number"
                          step="0.001"
                          value={(seg[edge] / rate).toFixed(3)}
                          disabled={uploadStarted}
                          onChange={(e) =>
                            edit(
                              moveBoundary(
                                segments,
                                i,
                                edge,
                                Number(e.target.value) * rate,
                                scan.frames,
                              ),
                              `set segment ${i + 1} ${edge} to ${e.target.value} s`,
                            )
                          }
                          className={`${field} w-32 py-1`}
                        />
                      </label>
                    ))}
                    <Button onClick={() => play(seg)}>Play</Button>
                    <Button
                      onClick={() =>
                        edit(mergeWithNext(segments, i), `merged segments ${i + 1} and ${i + 2}`)
                      }
                      disabled={uploadStarted || i + 1 >= segments.length}
                    >
                      Merge with next
                    </Button>
                    <Button
                      onClick={() =>
                        edit(
                          splitAt(segments, i, suggestSplit(seg, scan.energy.channels, fpe)),
                          `split segment ${i + 1}`,
                        )
                      }
                      disabled={uploadStarted || seg.end - seg.start < 2}
                    >
                      Split
                    </Button>
                    <Button
                      onClick={() => edit(removeSegment(segments, i), `deleted segment ${i + 1}`)}
                      disabled={uploadStarted}
                    >
                      Delete
                    </Button>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!w}
                        disabled={uploadStarted}
                        onChange={(e) =>
                          setWindows((ws) => ({
                            ...ws,
                            [seg.key]: e.target.checked
                              ? { startMs: 0, stopMs: ((seg.end - seg.start) * 1000) / rate }
                              : undefined,
                          }))
                        }
                      />
                      Set a measurement window
                    </label>
                    {w ? (
                      <>
                        {(["startMs", "stopMs"] as const).map((k) => (
                          <label key={k} className="flex items-center gap-2">
                            {k === "startMs" ? "Window start (s)" : "Window end (s)"}
                            <input
                              type="number"
                              step="0.1"
                              value={(w[k] / 1000).toFixed(1)}
                              disabled={uploadStarted}
                              onChange={(e) =>
                                setWindows((ws) => ({
                                  ...ws,
                                  [seg.key]: { ...w, [k]: Number(e.target.value) * 1000 },
                                }))
                              }
                              className={`${field} w-28 py-1`}
                            />
                          </label>
                        ))}
                      </>
                    ) : (
                      <span className="text-on-surface-variant">Window: the whole segment</span>
                    )}
                  </div>
                  {playing?.key === seg.key ? (
                    // The slice is the original bytes with a new header, so this plays what pass two hears.
                    <audio controls autoPlay src={playing.url} className="w-full" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      {scan ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-medium">5. Upload</h2>
          {gate.ok ? null : (
            <div data-testid="upload-blocked" className="flex flex-col gap-1">
              {gate.reasons.map((r) => (
                <p key={r} className="text-fault text-sm flex items-center gap-2">
                  <Icon name="block" />
                  {r}
                </p>
              ))}
            </div>
          )}
          {!gate.ok ? null : (
            <p className="text-sm text-on-surface-variant">
              The upload sends the untouched session file to {paths.sessionRaw(sessionLabel)}, then
              each pair&apos;s slice, energy frames, and session record.
              {ordered.filter((r) => exclusionFor(roster, r)).length
                ? ` ${ordered.filter((r) => exclusionFor(roster, r)).length} pair(s) go in marked excluded: consent; the archive keeps their audio and pass two skips them.`
                : ""}
            </p>
          )}
          <div>
            <Button
              variant="filled"
              onClick={startUpload}
              disabled={!gate.ok || uploadStarted || preparing !== null}
            >
              Upload session
            </Button>
          </div>
          {preparing ? <p className="text-sm text-on-surface-variant">{preparing}</p> : null}
          {files.length ? (
            <ul className="flex flex-col gap-2 text-sm" data-testid="upload-files">
              {files.map((f) => {
                const pct = f.total ? Math.round((100 * f.loaded) / f.total) : 0;
                return (
                  <li
                    key={f.key}
                    className="flex items-center gap-3 flex-wrap"
                    data-testid={`upload-${f.key}`}
                  >
                    <span className="w-56">{f.label}</span>
                    <span className="w-40 h-2 rounded-pill bg-surface-highest overflow-hidden">
                      <span
                        className={`block h-full ${f.state === "failed" ? "bg-fault" : "bg-primary"}`}
                        style={{ width: `${f.state === "done" ? 100 : pct}%` }}
                      />
                    </span>
                    <span data-testid="upload-state">
                      {f.state === "uploading" ? `${pct}%` : f.state}
                      {f.total ? ` (${mb(f.total)})` : ""}
                    </span>
                    {f.state === "failed" ? (
                      <>
                        <span className="text-fault">{f.message}</span>
                        <Button onClick={() => void retry(f.key)}>Retry</Button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {uploadDone ? (
            <p data-testid="upload-done" className="text-sm">
              Every file arrived. The archive holds {records.length} pair session
              {records.length === 1 ? "" : "s"} for {sessionLabel}.
            </p>
          ) : null}
        </Card>
      ) : null}

      {uploadDone ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-medium">6. Pass two</h2>
          <p className="text-on-surface-variant text-sm">
            Transcribes each pair with Deepgram, one at a time, and writes both documents and the
            CSV rows. Excluded pairs stay untranscribed.
          </p>
          <div className="flex gap-3 flex-wrap items-center">
            <Button variant="filled" onClick={runPass2All} disabled={running}>
              Run pass two for all pairs
            </Button>
            <Link className="text-primary underline" href="/review">
              Review sessions
            </Link>
            <a
              className="rounded-control border border-outline-variant px-4 py-2.5"
              href={`/api/session-download?label=${encodeURIComponent(sessionLabel)}`}
              download={`${sessionLabel}.zip`}
            >
              Download all
            </a>
          </div>
          {pass2Msg ? (
            <p className="text-fault text-sm flex items-center gap-2" data-testid="pass2-message">
              <Icon name="block" />
              {pass2Msg}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {records.map((r) => (
              <li key={r.id} data-testid={`pass2-${r.id}`}>
                Pair {r.source?.order} ({r.id}, left {r.participantIds.A}, right{" "}
                {r.participantIds.B}):{" "}
                {pass2[r.id] ?? (r.excluded ? "excluded: consent" : "waiting")}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
