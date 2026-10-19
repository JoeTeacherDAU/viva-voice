"use client";

// Single session file mode (work order 02): one stereo WAV of a whole class
// session, cut at exact-zero runs into one archived session per pair.

import { useState } from "react";
import type { SessionRecord } from "@/lib/analysis/types";
import {
  checkManifest,
  parseManifestCsv,
  sortedRows,
  uploadGate,
  type ManifestRow,
} from "@/lib/import/manifest";
import { exclusionFor, planUpload, type PairWindow } from "@/lib/import/records";
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
import { chooseUploader } from "@/lib/storage/archive";
import { paths } from "@/lib/storage/paths";
import { Button, Card, Icon } from "@/lib/ui";
import type { SessionDetails } from "./SessionDetails";
import { clock, exists, field, mb, Pass2Card, UploadList, useUploads } from "./shared";
import { WaveStrip } from "./WaveStrip";

export function SingleFileImport({ d, onLock }: { d: SessionDetails; onLock: () => void }) {
  const { exam, examState, roster, sessionLabel, sessionDate, labelTaken, setLabelTaken } = d;

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
  const uploads = useUploads();
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);

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
  const uploadStarted = uploads.started;
  const uploadDone = uploads.done;

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
  async function startUpload() {
    if (!file || !info || !scan || !exam || !gate.ok) return;
    setPreparing("Checking the archive");
    let built: Awaited<ReturnType<typeof planUpload>>;
    let put: Awaited<ReturnType<typeof chooseUploader>>;
    try {
      if (await exists(paths.sessionImport(sessionLabel))) {
        setLabelTaken(true);
        return;
      }
      put = await chooseUploader();
      built = await planUpload(
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
      setRecords(built.records);
    } catch (e) {
      setFileMsg(`The upload could not start: ${(e as Error).message}`);
      return;
    } finally {
      setPreparing(null);
    }
    onLock();
    await uploads.start(built.items, put);
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
    <>
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
          <UploadList files={uploads.files} onRetry={(k) => void uploads.retry(k)} />
          {uploadDone ? (
            <p data-testid="upload-done" className="text-sm">
              Every file arrived. The archive holds {records.length} pair session
              {records.length === 1 ? "" : "s"} for {sessionLabel}.
            </p>
          ) : null}
        </Card>
      ) : null}

      {uploadDone ? <Pass2Card step={6} records={records} sessionLabel={sessionLabel} /> : null}
    </>
  );
}
