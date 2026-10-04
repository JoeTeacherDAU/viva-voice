"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Capture } from "@/lib/audio/capture";
import { CAPTURE_RATE } from "@/lib/audio/dsp";
import { createSyntheticStereo, type SyntheticSource } from "@/lib/audio/synthetic";
import { wavFromStore } from "@/lib/audio/wav";
import { deleteSession } from "@/lib/storage/local";
import { Button, Card, Meter } from "@/lib/ui";

const SESSION = "capture-test";

// Exercises the capture graph with a synthetic stereo stream, so CI and
// headless Chrome can test it without hardware (build-plan P3.6).
export function CaptureTest() {
  const seconds = Number(useSearchParams().get("seconds") ?? 60) || 60;
  const [levels, setLevels] = useState<[number, number]>([-100, -100]);
  const [status, setStatus] = useState("idle");
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const synth = useRef<SyntheticSource | null>(null);

  async function start() {
    setStatus("recording");
    setWavUrl(null);
    await deleteSession(SESSION);
    synth.current = createSyntheticStereo("both");
    const last: [number, number] = [-100, -100];
    const timer = setInterval(() => setLevels([last[0], last[1]]), 100);
    const cap = await Capture.start(synth.current.stream, {
      sessionId: SESSION,
      maxFrames: seconds * CAPTURE_RATE,
      onEnergy: (ch, _at, db) => {
        last[ch] = db;
      },
      onDone: async (frames) => {
        clearInterval(timer);
        await cap.stop();
        await synth.current?.stop();
        const wav = await wavFromStore(SESSION);
        setWavUrl(URL.createObjectURL(wav));
        setStatus(`done: ${frames} frames, ${wav.size} bytes`);
      },
    });
  }

  return (
    <main className="flex flex-col gap-6 p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">Capture test</h1>
      <Card className="flex flex-col gap-4">
        <Button variant="filled" onClick={start} disabled={status === "recording"}>
          Start {seconds} s synthetic capture
        </Button>
        <Meter dbfs={levels[0]} student="A" label="Channel 1" />
        <Meter dbfs={levels[1]} student="B" label="Channel 2" />
        <p data-testid="capture-status">{status}</p>
        {wavUrl ? (
          <a
            href={wavUrl}
            download="capture-test.wav"
            className="text-primary underline"
            data-testid="wav-link"
          >
            Download WAV
          </a>
        ) : null}
      </Card>
    </main>
  );
}
