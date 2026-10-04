"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Participant, SessionRecord } from "@/lib/analysis/types";
import { createTranscriber } from "@/lib/asr";
import { getActiveDevice, setActiveDevice } from "@/lib/audio/activeDevice";
import { Capture } from "@/lib/audio/capture";
import { openDevice } from "@/lib/audio/devices";
import { createSyntheticStereo } from "@/lib/audio/synthetic";
import { demoMode } from "@/lib/exams";
import { LiveSession, type LiveView } from "@/lib/session/controller";
import { getSession, putArtifact, putSession } from "@/lib/storage/local";
import { Button, FaultStrip } from "@/lib/ui";

const SCORES = [1, 2, 3, 4, 5] as const;

function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "–" : v.toFixed(digits);

async function acquireStream(rec: SessionRecord): Promise<MediaStream> {
  const active = getActiveDevice();
  if (active && active.stream.getAudioTracks().some((t) => t.readyState === "live"))
    return active.stream;
  const setup = rec.events.find((e) => e.type === "setup")?.detail as
    { device?: { deviceId?: string; synthetic?: boolean } } | undefined;
  if (setup?.device?.synthetic && (demoMode() || process.env.NODE_ENV !== "production")) {
    const synth = createSyntheticStereo("both");
    return synth.stream;
  }
  if (!setup?.device?.deviceId) throw new Error("This session has no device. Go back to setup.");
  const { stream, report } = await openDevice(setup.device.deviceId);
  if (report.blocking.length) throw new Error(report.blocking.join(" "));
  return stream;
}

export function SessionClient() {
  const id = useSearchParams().get("id") ?? "";
  const [view, setView] = useState<LiveView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const live = useRef<LiveSession | null>(null);
  const capture = useRef<Capture | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | undefined;
    (async () => {
      const rec = id ? await getSession(id) : undefined;
      if (!rec)
        throw new Error(`No session ${id || "(missing id)"} in this browser. Start from setup.`);
      if (rec.state !== "setup") throw new Error(`Session ${id} is already ${rec.state}.`);
      const stream = await acquireStream(rec);
      if (disposed) return;
      const session = new LiveSession(rec, {
        transcriber: createTranscriber(),
        now: () => capture.current?.nowMs() ?? 0,
        persist: (r) => {
          setRecord(r);
          return putSession(r);
        },
      });
      live.current = session;
      capture.current = await Capture.start(stream, {
        sessionId: rec.id,
        onPcm16k: (buf) => session.sendAudio(buf),
        onEnergy: (ch, atMs, db) => session.onEnergy(ch, atMs, db),
      });
      for (const t of stream.getAudioTracks()) {
        t.addEventListener("ended", () => session.setDeviceFault("The input device disconnected"));
      }
      setRecord(rec);
      unsub = session.subscribe(setView);
    })().catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      unsub?.();
      live.current?.dispose();
      void capture.current?.stop();
    };
  }, [id]);

  async function stop() {
    const s = live.current;
    if (!s) return;
    const res = await s.stop();
    if (!res) return;
    await putArtifact(res.record.id, "transcript-pass1", res.words);
    await putArtifact(res.record.id, "measurements-pass1", res.result.features);
    if (capture.current) await putArtifact(res.record.id, "energy", capture.current.energyTrack());
    await putSession(res.record);
    await capture.current?.stop();
    capture.current = null;
    getActiveDevice()
      ?.stream.getTracks()
      .forEach((t) => t.stop());
    setActiveDevice(null);
    setSaved(true);
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="bg-surface rounded-card p-6 flex flex-col gap-3 max-w-lg">
          <p className="text-fault" data-testid="session-error">
            {error}
          </p>
          <Link href="/setup" className="text-primary underline">
            Back to setup
          </Link>
        </div>
      </main>
    );
  }

  const v = view;
  const shareA = v?.talkShareA ?? 0.5;
  const state = v?.state ?? "setup";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg" data-testid="live-display">
      <div title={v?.faultReason ?? undefined}>
        <FaultStrip level={v?.fault ?? "clear"} message={v?.faultReason ?? undefined} />
      </div>

      <header className="flex items-start justify-between px-10 pt-5">
        <div>
          <p className="text-[20px] text-on-surface-variant">Time remaining</p>
          <p data-testid="timer" className="text-[96px] font-semibold leading-none tabular-nums">
            {mmss(v ? v.remainingMs : (record?.config.durationMs ?? 0))}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3 pt-2">
          <p data-testid="session-state" className="text-[20px] text-on-surface-variant">
            {state === "setup"
              ? "Ready"
              : state === "live"
                ? "Live"
                : saved
                  ? "Stopped and saved"
                  : "Stopping"}
          </p>
          {state === "setup" ? (
            <Button
              variant="filled"
              className="text-[24px] px-10 py-4"
              onClick={() => void live.current?.start()}
              disabled={!v}
            >
              Start
            </Button>
          ) : state === "live" ? (
            <Button className="text-[24px] px-10 py-4" onClick={() => void stop()}>
              Stop
            </Button>
          ) : saved ? (
            <Link
              href={`/review/${encodeURIComponent(id)}`}
              className="text-primary underline text-[20px]"
            >
              Review session
            </Link>
          ) : null}
          {v?.faultReason ? <p className="text-[16px] text-warn">{v.faultReason}</p> : null}
        </div>
      </header>

      <section className="px-10 mt-4">
        <div className="flex justify-between text-[20px] mb-2">
          <span className="text-student-a">A {Math.round(shareA * 100)}%</span>
          <span className="text-student-b">B {Math.round((1 - shareA) * 100)}%</span>
        </div>
        <div
          className="h-12 w-full rounded-pill overflow-hidden flex bg-surface-highest"
          data-testid="talk-bar"
        >
          <div className="h-full bg-student-a" style={{ width: `${shareA * 100}%` }} />
          <div className="h-full bg-student-b flex-1" />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-8 px-10 mt-5 flex-1 min-h-0">
        {(["A", "B"] as Participant[]).map((P) => {
          const idx = v?.index[P];
          const colour = P === "A" ? "text-student-a" : "text-student-b";
          return (
            <div key={P} className="bg-surface rounded-card p-5 flex flex-col gap-3 min-h-0">
              <p className={`text-[20px] ${colour}`}>Student {P}</p>
              {v?.revealed ? (
                <div
                  data-testid={`index-${P}`}
                  data-hidden="false"
                  className="h-[120px] flex items-center"
                >
                  {idx?.composite !== null && idx?.composite !== undefined ? (
                    <p className={`text-[96px] font-semibold leading-none ${colour}`}>
                      {idx.composite.toFixed(2)}
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-4 w-full">
                      {[
                        ["wpm", fmt(idx?.speechRate, 0)],
                        ["pauses/min", fmt(idx?.pauseRate)],
                        ["words/run", fmt(idx?.meanLengthOfRun)],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <p
                            className={`text-[48px] font-semibold leading-none tabular-nums ${colour}`}
                          >
                            {val}
                          </p>
                          <p className="text-[20px] text-on-surface-variant">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  data-testid={`index-${P}`}
                  data-hidden="true"
                  className="h-[120px] rounded-card bg-hidden-slot"
                />
              )}
              <p className="text-[20px] text-on-surface-variant">Target structures</p>
              <p
                data-testid={`targets-${P}`}
                className={`text-[96px] font-semibold leading-none tabular-nums ${colour}`}
              >
                {v?.targets[P] ?? 0}
              </p>
            </div>
          );
        })}
      </section>

      <footer className="flex justify-center gap-4 py-5">
        {SCORES.map((n) => {
          const on = v?.score === n;
          return (
            <button
              key={n}
              aria-label={`Score ${n}`}
              aria-pressed={on}
              disabled={state !== "live"}
              onClick={() => live.current?.score(n)}
              className={`w-[72px] h-[72px] rounded-control text-[32px] font-semibold border disabled:opacity-40 ${
                on ? "bg-primary text-bg border-primary" : "border-outline-variant text-on-surface"
              }`}
            >
              {n}
            </button>
          );
        })}
      </footer>
    </div>
  );
}
