"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { EnergyTrack, Participant, SessionRecord } from "@/lib/analysis/types";
import { alignTracks, bestLag, envelope } from "@/lib/audio/align";
import { decodeWavMono, encodeWav, type MonoAudio } from "@/lib/audio/decode";
import { CAPTURE_RATE } from "@/lib/audio/dsp";
import { wavOffsetMs } from "@/lib/session/wavOffset";
import { chooseUploader } from "@/lib/storage/archive";
import { paths } from "@/lib/storage/paths";
import { Button, Card, Icon } from "@/lib/ui";

/** Below this correlation the alignment needs a human check. */
const WEAK_MATCH = 0.3;

interface Aligned {
  offsetMs: number;
  score: number;
  audio: MonoAudio;
}

async function fetchJson<T>(pathname: string): Promise<T | null> {
  const r = await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    cache: "no-store",
  });
  return r.ok ? ((await r.json()) as T) : null;
}

/**
 * Onboard import (build-plan P7.1): align each transmitter's onboard mono WAV
 * to the archived session by cross-correlating its energy envelope with the
 * archived energy frames, build an aligned stereo WAV on the archive's
 * timeline, upload it, and offer a pass-two run on it.
 */
export function ImportClient() {
  const id = useSearchParams().get("id") ?? "";
  const [files, setFiles] = useState<{ A?: File; B?: File }>({});
  const [aligned, setAligned] = useState<Partial<Record<Participant, Aligned>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function align() {
    setBusy(true);
    setStatus("Aligning");
    setUploaded(false);
    try {
      const rec = await fetchJson<SessionRecord>(paths.session(id));
      const energy = await fetchJson<EnergyTrack>(paths.energy(id));
      if (!rec || !energy) throw new Error(`Session ${id} has no archived record or energy file.`);
      const map = rec.channelMap ?? { "0": "A", "1": "B" };
      const out: Partial<Record<Participant, Aligned>> = {};
      for (const P of ["A", "B"] as Participant[]) {
        const f = files[P];
        if (!f) continue;
        const audio = decodeWavMono(await f.arrayBuffer());
        if (audio.sampleRate !== CAPTURE_RATE) {
          throw new Error(
            `${f.name} runs at ${audio.sampleRate} Hz. Export the onboard file at 48000 Hz.`,
          );
        }
        const ch = map["0"] === P ? 0 : 1;
        const { lag, score } = bestLag(
          energy.channels[ch],
          envelope(audio.samples, audio.sampleRate, energy.frameMs),
        );
        out[P] = { offsetMs: energy.startMs + lag * energy.frameMs, score, audio };
      }
      setAligned(out);
      setStatus(null);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    setBusy(true);
    setStatus("Uploading the aligned WAV");
    try {
      const rec = await fetchJson<SessionRecord>(paths.session(id));
      if (!rec) throw new Error("No archived record");
      const map = rec.channelMap ?? { "0": "A", "1": "B" };
      const archive = rec.events.find((e) => e.type === "archive")?.detail as
        { wavBytes?: number } | undefined;
      const offset = wavOffsetMs(rec);
      const length =
        archive?.wavBytes !== undefined
          ? (archive.wavBytes - 44) / 4
          : Math.round(((rec.markers.stopMs! - offset + 2000) * CAPTURE_RATE) / 1000);
      const tracks = (["0", "1"] as const).map((ch) => {
        const a = aligned[map[ch]];
        return {
          samples: a?.audio.samples ?? new Float32Array(0),
          startSample: a ? ((a.offsetMs - offset) * CAPTURE_RATE) / 1000 : 0,
        };
      });
      const wav = encodeWav(alignTracks(tracks, length), CAPTURE_RATE);
      const put = await chooseUploader();
      await put(paths.onboardStereo(id), new Blob([wav], { type: "audio/wav" }), "audio/wav");
      setUploaded(true);
      setStatus(null);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPass2() {
    setBusy(true);
    setStatus("Running pass two on the onboard audio");
    const res = await fetch("/api/pass2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: id, source: "onboard" }),
    });
    const out = (await res.json()) as { error?: string; state?: string };
    setBusy(false);
    setStatus(
      res.ok ? `Pass two finished. Session state: ${out.state}.` : `Pass two failed: ${out.error}`,
    );
  }

  return (
    <main className="flex flex-col gap-6 p-8 max-w-3xl w-full mx-auto">
      <h1 className="text-3xl font-semibold">Import onboard recordings</h1>
      <p className="text-on-surface-variant">Session {id || "(add ?id= to the address)"}</p>
      <Card className="flex flex-col gap-4">
        {(["A", "B"] as Participant[]).map((P) => (
          <label key={P} className="flex flex-col gap-1 text-sm">
            <span className={P === "A" ? "text-student-a" : "text-student-b"}>
              Onboard WAV for student {P}
            </span>
            <input
              aria-label={`Onboard WAV for student ${P}`}
              type="file"
              accept="audio/wav,.wav"
              onChange={(e) => setFiles((f) => ({ ...f, [P]: e.target.files?.[0] }))}
            />
          </label>
        ))}
        <div className="flex gap-3">
          <Button onClick={align} disabled={busy || !id || (!files.A && !files.B)}>
            Align
          </Button>
          <Button
            variant="filled"
            onClick={upload}
            disabled={busy || Object.keys(aligned).length === 0}
          >
            Upload aligned audio
          </Button>
          <Button onClick={runPass2} disabled={busy || !uploaded}>
            Run pass two (onboard)
          </Button>
        </div>
        {(["A", "B"] as Participant[]).map((P) =>
          aligned[P] ? (
            <p key={P} className="text-sm flex items-center gap-2">
              Student {P}: onboard file starts at{" "}
              <span data-testid={`offset-${P}`}>{Math.round(aligned[P]!.offsetMs)}</span> ms of
              capture time ({aligned[P]!.audio.encoding}, match {aligned[P]!.score.toFixed(2)})
              {aligned[P]!.score < WEAK_MATCH ? (
                <span className="text-warn flex items-center gap-1">
                  <Icon name="warning" />
                  weak match; check by ear
                </span>
              ) : null}
            </p>
          ) : null,
        )}
        {uploaded ? <p data-testid="import-uploaded">Uploaded {paths.onboardStereo(id)}.</p> : null}
        {status ? (
          <p data-testid="import-status" className="text-on-surface-variant">
            {status}
          </p>
        ) : null}
      </Card>
    </main>
  );
}
