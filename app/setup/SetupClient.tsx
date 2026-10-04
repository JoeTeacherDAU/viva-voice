"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import { DEFAULT_CONFIG, type Participant, type SessionRecord } from "@/lib/analysis/types";
import { setActiveDevice } from "@/lib/audio/activeDevice";
import { proposedMargin, separationDb } from "@/lib/audio/calibration";
import { Capture } from "@/lib/audio/capture";
import {
  blockingReasons,
  browserBlock,
  listAudioInputs,
  openDevice,
  primePermission,
  type AudioInputInfo,
  type DeviceReport,
} from "@/lib/audio/devices";
import {
  createSyntheticStereo,
  SYNTHETIC_DEVICE_ID,
  SYNTHETIC_MONO_ID,
  type SyntheticSource,
} from "@/lib/audio/synthetic";
import {
  DEMO_EXAM_ID,
  demoData,
  demoMode,
  loadExam,
  loadRoster,
  type ExamRecord,
  type RosterEntry,
} from "@/lib/exams";
import { putSession } from "@/lib/storage/local";
import { Button, Card, Icon, Meter } from "@/lib/ui";

type ChannelMap = { "0": Participant; "1": Participant };

const syntheticAllowed = () => demoMode() || process.env.NODE_ENV !== "production";

function newSessionId(examId: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${examId}-${stamp}-${rand}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

export function SetupClient() {
  const router = useRouter();
  const params = useSearchParams();
  const calSeconds = syntheticAllowed() ? Number(params.get("calSeconds") ?? 10) || 10 : 10;

  const [browserIssue] = useState<string | null>(() => {
    const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
    return browserBlock(nav.userAgentData, navigator.userAgent);
  });
  const [devices, setDevices] = useState<AudioInputInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [report, setReport] = useState<DeviceReport | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [levels, setLevels] = useState<[number, number]>([-100, -100]);
  const [channelMap, setChannelMap] = useState<ChannelMap>({ "0": "A", "1": "B" });
  const [sep, setSep] = useState<{ A?: number; B?: number }>({});
  const [calibrating, setCalibrating] = useState<Participant | null>(null);
  const [margin, setMargin] = useState(DEFAULT_CONFIG.gatingMarginDb);
  const [examId, setExamId] = useState(demoMode() ? DEMO_EXAM_ID : "");
  const [exam, setExam] = useState<ExamRecord | null>(() => demoData()?.exam ?? null);
  const [roster, setRoster] = useState<RosterEntry[]>(() => demoData()?.roster ?? []);
  const [examError, setExamError] = useState<string | null>(null);
  const [who, setWho] = useState<{ A: string; B: string }>({ A: "", B: "" });
  const [gainDb, setGainDb] = useState(0);
  const [firmware, setFirmware] = useState({ tx: "", rx: "" });
  const [saving, setSaving] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const synthRef = useRef<SyntheticSource | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const calFrames = useRef<[number[], number[]] | null>(null);
  const handedOff = useRef(false);

  const closeDevice = useCallback(async () => {
    await captureRef.current?.stop();
    captureRef.current = null;
    if (!handedOff.current) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      await synthRef.current?.stop();
    }
    streamRef.current = null;
    synthRef.current = null;
  }, []);

  useEffect(() => () => void closeDevice(), [closeDevice]);

  async function findDevices() {
    setOpenError(null);
    const synthetic: AudioInputInfo[] = syntheticAllowed()
      ? [
          { deviceId: SYNTHETIC_DEVICE_ID, label: "Synthetic stereo (test)", channelCount: 2 },
          { deviceId: SYNTHETIC_MONO_ID, label: "Synthetic mono (test)", channelCount: 1 },
        ]
      : [];
    try {
      await primePermission();
      setDevices([...(await listAudioInputs()), ...synthetic]);
    } catch (e) {
      setDevices(synthetic);
      setOpenError(`Microphone access failed: ${(e as Error).message}`);
    }
  }

  async function open() {
    await closeDevice();
    setReport(null);
    setOpenError(null);
    setSep({});
    try {
      let stream: MediaStream;
      let rep: DeviceReport;
      if (deviceId === SYNTHETIC_DEVICE_ID || deviceId === SYNTHETIC_MONO_ID) {
        const synth = createSyntheticStereo("both", deviceId === SYNTHETIC_MONO_ID ? 1 : 2);
        synthRef.current = synth;
        stream = synth.stream;
        const settings = {
          channelCount: synth.channelCount,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        };
        rep = {
          deviceId,
          label:
            deviceId === SYNTHETIC_MONO_ID ? "Synthetic mono (test)" : "Synthetic stereo (test)",
          settings,
          synthetic: true,
          blocking: blockingReasons(settings),
        };
      } else {
        ({ stream, report: rep } = await openDevice(deviceId));
      }
      streamRef.current = stream;
      setReport(rep);
      const last: [number, number] = [-100, -100];
      captureRef.current = await Capture.start(stream, {
        onEnergy: (ch, _at, db) => {
          last[ch] = db;
          calFrames.current?.[ch].push(db);
        },
      });
      const tick = setInterval(() => {
        if (!captureRef.current) return clearInterval(tick);
        setLevels([last[0], last[1]]);
      }, 100);
    } catch (e) {
      setOpenError(`Could not open the device: ${(e as Error).message}`);
    }
  }

  const channelOf = (P: Participant): 0 | 1 => (channelMap["0"] === P ? 0 : 1);

  async function calibrate(P: Participant) {
    const ch = channelOf(P);
    setCalibrating(P);
    calFrames.current = [[], []];
    synthRef.current?.setMode(ch === 0 ? "A" : "B");
    await new Promise((r) => setTimeout(r, calSeconds * 1000));
    const frames = calFrames.current;
    calFrames.current = null;
    synthRef.current?.setMode("both");
    setCalibrating(null);
    const s = frames ? separationDb(frames, ch) : null;
    setSep((prev) => {
      const next = { ...prev, [P]: s ?? undefined };
      if (next.A !== undefined && next.B !== undefined) setMargin(proposedMargin(next.A, next.B));
      return next;
    });
  }

  const [configMsg, setConfigMsg] = useState<string | null>(null);

  async function importJson(kind: "exam" | "roster", file: File | undefined) {
    if (!file) return;
    setConfigMsg(null);
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      setConfigMsg(`${file.name} is not valid JSON.`);
      return;
    }
    const url = kind === "exam" ? "/api/exam" : `/api/roster?examId=${encodeURIComponent(examId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as { error?: string; examId?: string };
    if (!res.ok) {
      setConfigMsg(`Import failed: ${out.error ?? res.status}`);
      return;
    }
    if (kind === "exam" && out.examId) setExamId(out.examId);
    setConfigMsg(
      kind === "exam" ? `Imported exam ${out.examId}. Load it to use it.` : "Imported the roster.",
    );
  }

  function exportExam() {
    if (!exam) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exam, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exam.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function chooseExam() {
    setExamError(null);
    setExam(null);
    setRoster([]);
    try {
      const [e, r] = await Promise.all([loadExam(examId), loadRoster(examId)]);
      setExam(e);
      setRoster(r);
    } catch (err) {
      setExamError((err as Error).message);
    }
  }

  const blocking = useMemo(() => {
    const out: string[] = [];
    if (browserIssue) out.push(browserIssue);
    if (!report) out.push("Open a two-channel input device.");
    else out.push(...report.blocking);
    if (!exam) out.push("Choose an exam.");
    if (!who.A || !who.B) out.push("Choose both students.");
    else if (who.A === who.B) out.push("Student A and student B must be different people.");
    for (const P of ["A", "B"] as const) {
      const entry = roster.find((r) => r.participantId === who[P]);
      if (entry && entry.consentStatus !== "granted") {
        out.push(
          `Student ${P} has not consented to recording (ruling R2). Run this pair with the microphones off.`,
        );
      }
    }
    return out;
  }, [browserIssue, report, exam, who, roster]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (report && (sep.A === undefined || sep.B === undefined)) {
      out.push(
        `Calibration has not run for both students, so the gating margin stays at ${margin} dB.`,
      );
    }
    for (const P of ["A", "B"] as const) {
      const s = sep[P];
      if (s !== undefined && s < 6)
        out.push(
          `Separation for student ${P} is only ${s.toFixed(1)} dB. Check the capsule placement.`,
        );
    }
    return out;
  }, [report, sep, margin]);

  async function continueToSession() {
    if (!report || !exam || blocking.length) return;
    setSaving(true);
    const id = newSessionId(exam.id);
    const record: SessionRecord = {
      id,
      examId: exam.id,
      state: "setup",
      participantIds: { A: who.A, B: who.B },
      channelMap,
      config: {
        ...DEFAULT_CONFIG,
        gainDb,
        gatingMarginDb: margin,
        targetPatterns: exam.targetPatterns,
        keyterms: exam.keyterms,
        durationMs: exam.durationMs,
      },
      markers: { startMs: null, stopMs: null },
      events: [
        {
          type: "setup",
          atMs: 0,
          detail: {
            device: {
              deviceId: report.deviceId,
              label: report.label,
              settings: report.settings,
              synthetic: report.synthetic,
            },
            separationDb: sep,
          },
        },
      ],
      instructorLiveScore: null,
      passes: {},
      pipelineVersion: PIPELINE_VERSION,
      deepgramModel: "nova-3",
      firmware: { tx: firmware.tx || "unknown", rx: firmware.rx || "unknown" },
      createdAt: new Date().toISOString(),
    };
    await putSession(record);
    await captureRef.current?.stop();
    captureRef.current = null;
    setActiveDevice({ stream: streamRef.current!, report, synthetic: synthRef.current });
    handedOff.current = true;
    router.push(`/session?id=${encodeURIComponent(id)}`);
  }

  const studentLabel = (ch: "0" | "1") => `Channel ${Number(ch) + 1}: student ${channelMap[ch]}`;

  return (
    <main className="flex flex-col gap-6 p-8 max-w-4xl w-full mx-auto">
      <h1 className="text-3xl font-semibold">Session setup</h1>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">1. Input device</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <Button onClick={findDevices}>Find devices</Button>
          <select
            aria-label="Input device"
            className="rounded-control bg-surface-highest border border-outline-variant px-3 py-2"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            <option value="">Choose a device</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          <Button onClick={open} disabled={!deviceId}>
            Open device
          </Button>
        </div>
        {openError ? <p className="text-fault">{openError}</p> : null}
        {report ? (
          <div className="flex flex-col gap-3" data-testid="device-report">
            <p className="text-on-surface-variant text-sm">
              {report.label}: {report.settings.channelCount ?? "?"} channel(s),{" "}
              {report.settings.sampleRate ?? "?"} Hz, echo cancellation{" "}
              {String(report.settings.echoCancellation)}, noise suppression{" "}
              {String(report.settings.noiseSuppression)}, auto gain{" "}
              {String(report.settings.autoGainControl)}
            </p>
            <Meter dbfs={levels[0]} student={channelMap["0"]} label={studentLabel("0")} />
            <Meter dbfs={levels[1]} student={channelMap["1"]} label={studentLabel("1")} />
            <div className="flex gap-3">
              <Button onClick={() => setChannelMap((m) => ({ "0": m["1"], "1": m["0"] }))}>
                Swap A and B
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">2. Calibration</h2>
        <p className="text-on-surface-variant text-sm">
          Ask one student to talk for {calSeconds} seconds while the other stays silent, then swap.
        </p>
        <div className="flex gap-3 items-center flex-wrap">
          {(["A", "B"] as const).map((P) => (
            <Button key={P} onClick={() => calibrate(P)} disabled={!report || calibrating !== null}>
              {calibrating === P ? `Listening to student ${P}...` : `Calibrate student ${P}`}
            </Button>
          ))}
        </div>
        <p data-testid="calibration-result" className="text-sm">
          Separation A: {sep.A !== undefined ? `${sep.A.toFixed(1)} dB` : "not measured"}.
          Separation B: {sep.B !== undefined ? `${sep.B.toFixed(1)} dB` : "not measured"}.
        </p>
        <label className="flex items-center gap-3 text-sm">
          Gating margin (dB)
          <input
            type="number"
            step="0.5"
            min="0"
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="w-24 rounded-control bg-surface-highest border border-outline-variant px-2 py-1"
          />
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-medium">3. Exam and students</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            aria-label="Exam id"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            placeholder="exam id"
            className="rounded-control bg-surface-highest border border-outline-variant px-3 py-2"
          />
          <Button onClick={chooseExam} disabled={!examId}>
            Load exam
          </Button>
        </div>
        {examError ? <p className="text-fault">{examError}</p> : null}
        <div className="flex gap-3 flex-wrap items-center text-sm" aria-label="Exam configuration">
          <label className="rounded-control border border-outline-variant px-3 py-2 cursor-pointer">
            Import exam JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => void importJson("exam", e.target.files?.[0])}
            />
          </label>
          <label
            className={`rounded-control border border-outline-variant px-3 py-2 ${examId ? "cursor-pointer" : "opacity-40"}`}
          >
            Import roster JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={!examId}
              onChange={(e) => void importJson("roster", e.target.files?.[0])}
            />
          </label>
          <Button onClick={exportExam} disabled={!exam}>
            Export exam JSON
          </Button>
          {configMsg ? <span data-testid="config-message">{configMsg}</span> : null}
        </div>
        {exam ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-on-surface-variant">
              {exam.course}, {exam.unit}. {Math.round(exam.durationMs / 1000)} seconds.
            </p>
            <div className="flex gap-4 flex-wrap">
              {(["A", "B"] as const).map((P) => (
                <label key={P} className="flex flex-col gap-1 text-sm">
                  <span className={P === "A" ? "text-student-a" : "text-student-b"}>
                    Student {P}
                  </span>
                  <select
                    aria-label={`Student ${P}`}
                    value={who[P]}
                    onChange={(e) => setWho((w) => ({ ...w, [P]: e.target.value }))}
                    className="rounded-control bg-surface-highest border border-outline-variant px-3 py-2"
                  >
                    <option value="">Choose</option>
                    {roster.map((r) => (
                      <option key={r.participantId} value={r.participantId}>
                        {r.name}
                        {r.consentStatus !== "granted" ? " (no consent)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex gap-4 flex-wrap text-sm">
          <label className="flex flex-col gap-1">
            Receiver gain (dB)
            <input
              type="number"
              min={-12}
              max={12}
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="w-24 rounded-control bg-surface-highest border border-outline-variant px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            Transmitter firmware
            <input
              value={firmware.tx}
              onChange={(e) => setFirmware((f) => ({ ...f, tx: e.target.value }))}
              className="rounded-control bg-surface-highest border border-outline-variant px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            Receiver firmware
            <input
              value={firmware.rx}
              onChange={(e) => setFirmware((f) => ({ ...f, rx: e.target.value }))}
              className="rounded-control bg-surface-highest border border-outline-variant px-2 py-1"
            />
          </label>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        {blocking.length ? (
          <ul className="flex flex-col gap-2" aria-label="Blocking problems">
            {blocking.map((b) => (
              <li key={b} className="flex items-start gap-2 text-fault" data-testid="blocking">
                <Icon name="block" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-success" data-testid="setup-ready">
            <Icon name="check_circle" />
            Ready to start.
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 text-warn text-sm">
            <Icon name="warning" />
            {w}
          </p>
        ))}
        <div>
          <Button
            variant="filled"
            onClick={continueToSession}
            disabled={blocking.length > 0 || saving}
          >
            Continue to session
          </Button>
        </div>
      </Card>
    </main>
  );
}
