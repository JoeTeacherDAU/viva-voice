"use client";

// Pair files mode (work order 03): Audacity has exported one stereo WAV per
// pair, and the manifest names each file. The page matches files to rows by
// name, checks each header, and uploads every file unchanged. No segmentation
// runs here.

import { useState } from "react";
import type { SessionRecord } from "@/lib/analysis/types";
import {
  checkPairWav,
  matchPairFiles,
  OFFSET_TOLERANCE_MS,
  pairUploadGate,
  parsePairManifestCsv,
  planPairUpload,
  sessionOffsets,
  type ChosenFile,
  type PairManifestRow,
  type ReadPair,
} from "@/lib/import/pairfiles";
import { exclusionFor } from "@/lib/import/records";
import { scanSessionFile, sha256OfBlob } from "@/lib/import/scan";
import { chooseUploader } from "@/lib/storage/archive";
import { paths } from "@/lib/storage/paths";
import { Button, Card, Icon } from "@/lib/ui";
import type { SessionDetails } from "./SessionDetails";
import { clock, exists, mb, Pass2Card, UploadList, useUploads } from "./shared";

type Picked = ChosenFile & { file: File };

const fileButton = "rounded-control border border-outline-variant px-4 py-2.5 cursor-pointer";
const ms = (x: number) => `${Math.abs(x) < 10 ? x.toFixed(1) : Math.round(x)} ms`;

async function pick(file: File): Promise<Picked> {
  return { file, name: file.name, ...(await checkPairWav(file)) };
}

export function PairFilesImport({ d, onLock }: { d: SessionDetails; onLock: () => void }) {
  const { exam, examState, roster, sessionLabel, sessionDate, labelTaken, setLabelTaken } = d;

  const [manifest, setManifest] = useState<{ fileName: string; text: string } | null>(null);
  const [rows, setRows] = useState<PairManifestRow[]>([]);
  const [manifestProblems, setManifestProblems] = useState<string[]>([]);
  const [files, setFiles] = useState<Picked[]>([]);
  const [session, setSession] = useState<Picked | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const uploads = useUploads();
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);

  const match = matchPairFiles(
    rows,
    files.map((f) => f.name),
  );
  const gate = pairUploadGate({
    examReady: examState === "found",
    sessionLabel,
    sessionDate,
    labelTaken,
    rows,
    manifestProblems,
    files,
    session,
    confirmed,
  });
  const fileFor = (row: PairManifestRow) => {
    const m = match.matched.find((x) => x.row.order === row.order);
    return m ? files[m.index] : undefined;
  };
  // The offset check runs once the session WAV and every matched pair have a header.
  const offsets =
    session?.info && match.matched.length && match.matched.every(({ index }) => files[index].info)
      ? sessionOffsets(
          match.matched.map(({ row, index }) => ({
            order: row.order,
            frames: files[index].info!.frames,
            sampleRate: files[index].info!.sampleRate,
          })),
          session.info,
        )
      : null;
  const nameOf = (id: string) =>
    roster?.find((r) => r.participantId === id)?.name ?? "not in the roster";

  async function loadManifest(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    const parsed = parsePairManifestCsv(text);
    setManifest({ fileName: f.name, text });
    setRows(parsed.rows);
    setManifestProblems(parsed.problems);
    setConfirmed(false);
  }

  async function chooseFiles(list: FileList | null) {
    setConfirmed(false);
    const chosen = [...(list ?? [])];
    setFiles(chosen.map((file) => ({ file, name: file.name })));
    setFiles(await Promise.all(chosen.map(pick)));
  }

  async function chooseSession(f: File | undefined) {
    setConfirmed(false);
    setSession(f ? await pick(f) : null);
  }

  async function startUpload() {
    if (!exam || !gate.ok || !manifest) return;
    setMessage(null);
    setPreparing("Checking the archive");
    let built: ReturnType<typeof planPairUpload>;
    let put: Awaited<ReturnType<typeof chooseUploader>>;
    try {
      if (await exists(paths.sessionImport(sessionLabel))) {
        setLabelTaken(true);
        return;
      }
      put = await chooseUploader();
      // Each pair file is read once for its SHA-256 and its 20 ms energy frames.
      const pairs: ReadPair[] = [];
      for (const [k, { row, index }] of match.matched.entries()) {
        const p = files[index];
        const scan = await scanSessionFile(p.file, p.info!, (done, total) =>
          setPreparing(
            `Reading pair ${k + 1} of ${match.matched.length}: ${mb(done)} of ${mb(total)}`,
          ),
        );
        pairs.push({
          row,
          file: p.file,
          fileName: p.name,
          info: p.info!,
          sha256: scan.sha256,
          energy: scan.energy,
        });
      }
      let sessionInput;
      if (session?.info) {
        setPreparing("Reading the session file");
        sessionInput = {
          file: session.file,
          fileName: session.name,
          info: session.info,
          sha256: await sha256OfBlob(session.file),
        };
      }
      built = planPairUpload({
        exam,
        sessionLabel,
        sessionDate,
        roster,
        pairs,
        session: sessionInput,
        manifest,
      });
      setRecords(built.records);
    } catch (e) {
      setMessage(`The upload could not start: ${(e as Error).message}`);
      return;
    } finally {
      setPreparing(null);
    }
    onLock();
    await uploads.start(built.items, put);
  }

  const locked = uploads.started || preparing !== null;
  const excludedCount = rows.filter((r) => exclusionFor(roster, r)).length;

  return (
    <>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">2. Manifest and pair files</h2>
        <p className="text-on-surface-variant text-sm">
          Load the session folder&apos;s manifest, a CSV with the columns
          order,track,file,left_id,right_id. Then choose every pair WAV in the folder at once. The
          page matches each file to its row by file name. The files leave your computer only when
          you press Upload.
        </p>
        <div className="flex gap-3 items-center flex-wrap text-sm">
          <label className={fileButton}>
            Load manifest CSV
            <input
              aria-label="Pair manifest CSV"
              type="file"
              accept="text/csv,.csv"
              className="sr-only"
              disabled={locked}
              onChange={(e) => void loadManifest(e.target.files?.[0])}
            />
          </label>
          {manifest ? (
            <span className="text-on-surface-variant" data-testid="manifest-loaded">
              {manifest.fileName}: {rows.length} row{rows.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <label className={fileButton}>
            Choose pair WAV files
            <input
              aria-label="Pair WAV files"
              type="file"
              multiple
              accept="audio/wav,.wav"
              className="sr-only"
              disabled={locked}
              onChange={(e) => void chooseFiles(e.target.files)}
            />
          </label>
          {files.length ? (
            <span className="text-on-surface-variant">
              {files.length} file{files.length === 1 ? "" : "s"} chosen
            </span>
          ) : null}
        </div>
        {manifestProblems.map((m) => (
          <p key={m} className="text-warn text-sm">
            {m}
          </p>
        ))}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">3. Session-wide WAV (optional)</h2>
        <p className="text-on-surface-variant text-sm">
          The full mix of the same session, for example &quot;C1_26_02 - Session 1.wav&quot;. The
          archive keeps it unchanged at sessions-raw/{sessionLabel || "{label}"}.wav. The page
          places each pair in it by adding up the pair durations in manifest order, and checks that
          the sum comes within {OFFSET_TOLERANCE_MS} ms of the session file&apos;s length.
        </p>
        <div className="flex gap-3 items-center flex-wrap text-sm">
          <label className={fileButton}>
            Choose session WAV
            <input
              aria-label="Session-wide WAV"
              type="file"
              accept="audio/wav,.wav"
              className="sr-only"
              disabled={locked}
              onChange={(e) => void chooseSession(e.target.files?.[0])}
            />
          </label>
          {session ? (
            <>
              <span className="text-on-surface-variant" data-testid="session-file">
                {session.name}: {mb(session.file.size)}
                {session.info
                  ? `, ${clock(session.info.frames, session.info.sampleRate)} long`
                  : ""}
              </span>
              <Button onClick={() => void chooseSession(undefined)} disabled={locked}>
                Remove
              </Button>
            </>
          ) : null}
        </div>
        {session?.problem ? (
          <p className="text-fault text-sm flex items-center gap-2">
            <Icon name="block" />
            {session.problem}
          </p>
        ) : null}
        {offsets ? (
          <p
            data-testid="offset-check"
            className={`text-sm flex items-center gap-2 ${offsets.ok ? "" : "text-warn"}`}
          >
            <Icon name={offsets.ok ? "check_circle" : "warning"} />
            {offsets.rateProblem
              ? `${offsets.rateProblem} The records will not carry offsets into the session file.`
              : `The pair durations sum to ${clock(offsets.sumMs, 1000)} and the session file runs ${clock(offsets.sessionMs, 1000)}: a difference of ${ms(offsets.differenceMs)}, ${
                  offsets.ok
                    ? `within ${OFFSET_TOLERANCE_MS} ms. Each record carries its pair's place in the session file.`
                    : `more than ${OFFSET_TOLERANCE_MS} ms. The session file still uploads, and the records will not carry offsets into it.`
                }`}
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">4. Check the pairs</h2>
        {rows.length === 0 ? (
          <p className="text-on-surface-variant text-sm">
            The table appears once a manifest loads.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full" data-testid="pair-table">
              <thead className="text-on-surface-variant text-left">
                <tr>
                  <th className="py-1 pr-3">Pair</th>
                  <th className="py-1 pr-3">File</th>
                  <th className="py-1 pr-3">Duration</th>
                  <th className="py-1 pr-3 text-student-a">Left (student A)</th>
                  <th className="py-1 pr-3 text-student-b">Right (student B)</th>
                  {offsets?.ok ? <th className="py-1 pr-3">Starts in session</th> : null}
                  <th className="py-1">Consent</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => a.order - b.order)
                  .map((row) => {
                    const f = fileFor(row);
                    const ex = exclusionFor(roster, row);
                    const place = offsets?.ok
                      ? offsets.pairs.find((p) => p.order === row.order)
                      : undefined;
                    return (
                      <tr
                        key={row.order}
                        data-testid={`pair-row-${row.order}`}
                        className="border-t border-outline-variant align-top"
                      >
                        <td className="py-1 pr-3">
                          {row.order}
                          <span className="block text-on-surface-variant">{row.track}</span>
                        </td>
                        <td className="py-1 pr-3 break-all" data-testid="pair-file">
                          {row.file}
                          {!f ? (
                            <span className="block text-fault">missing</span>
                          ) : f.problem ? (
                            <span className="block text-fault">{f.problem}</span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3" data-testid="pair-duration">
                          {f?.info ? clock(f.info.frames, f.info.sampleRate) : ""}
                        </td>
                        <td className="py-1 pr-3" data-testid="pair-left">
                          {row.leftId}
                          <span className="block">{nameOf(row.leftId)}</span>
                        </td>
                        <td className="py-1 pr-3" data-testid="pair-right">
                          {row.rightId}
                          <span className="block">{nameOf(row.rightId)}</span>
                        </td>
                        {offsets?.ok ? (
                          <td className="py-1 pr-3">
                            {place ? clock(place.startFrame, session!.info!.sampleRate) : ""}
                          </td>
                        ) : null}
                        <td className="py-1">
                          {ex ? (
                            <span className="text-warn" data-testid="consent-excluded">
                              excluded: consent (
                              {Object.entries(ex.consent)
                                .filter(([, c]) => c !== "granted")
                                .map(([id, c]) => `${id} ${c}`)
                                .join(", ")}
                              )
                            </span>
                          ) : (
                            "granted"
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {match.extra.length ? (
          <p className="text-fault text-sm" data-testid="extra-files">
            Chosen but not in the manifest: {match.extra.join(", ")}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="The table is correct"
            checked={confirmed}
            disabled={locked || rows.length === 0}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I checked the table: each file belongs to its pair, and the left and right students are
          the right way round.
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">5. Upload</h2>
        {gate.ok ? (
          <p className="text-sm text-on-surface-variant">
            The upload sends {session ? "the session file, then " : ""}each pair file unchanged, its
            energy frames, and its session record, and last the import record.
            {excludedCount
              ? ` ${excludedCount} pair(s) go in marked excluded: consent; the archive keeps their audio and pass two skips them.`
              : ""}
          </p>
        ) : (
          <div data-testid="upload-blocked" className="flex flex-col gap-1">
            {gate.reasons.map((r) => (
              <p key={r} className="text-fault text-sm flex items-center gap-2">
                <Icon name="block" />
                {r}
              </p>
            ))}
          </div>
        )}
        <div>
          <Button
            variant="filled"
            onClick={startUpload}
            disabled={!gate.ok || uploads.started || preparing !== null}
          >
            Upload pairs
          </Button>
        </div>
        {preparing ? <p className="text-sm text-on-surface-variant">{preparing}</p> : null}
        {message ? (
          <p className="text-fault text-sm flex items-center gap-2">
            <Icon name="block" />
            {message}
          </p>
        ) : null}
        <UploadList files={uploads.files} onRetry={(k) => void uploads.retry(k)} />
        {uploads.done ? (
          <p data-testid="upload-done" className="text-sm">
            Every file arrived. The archive holds {records.length} pair session
            {records.length === 1 ? "" : "s"} for {sessionLabel}.
          </p>
        ) : null}
      </Card>

      {uploads.done ? <Pass2Card step={6} records={records} sessionLabel={sessionLabel} /> : null}
    </>
  );
}
