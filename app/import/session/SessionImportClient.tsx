"use client";

// /import/session. Two modes: pair files (work order 03, the default), where
// Audacity has already exported one WAV per pair, and a single session file
// (work order 02), which the page cuts at exact-zero runs.

import Link from "next/link";
import { useState } from "react";
import { PairFilesImport } from "./PairFilesImport";
import { SessionDetailsCard, useSessionDetails } from "./SessionDetails";
import { SingleFileImport } from "./SingleFileImport";

type Mode = "pairs" | "single";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  {
    mode: "pairs",
    label: "Pair files",
    hint: "One stereo WAV per pair and a manifest that names each file.",
  },
  {
    mode: "single",
    label: "Single session file",
    hint: "One stereo WAV for the whole session, cut where both channels read exactly zero.",
  },
];

export function SessionImportClient() {
  const d = useSessionDetails();
  const [mode, setMode] = useState<Mode>("pairs");
  // Once an upload starts, the mode stays put, so the running upload keeps its page.
  const [locked, setLocked] = useState(false);

  return (
    <main className="flex flex-col gap-6 p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-baseline gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold">Import a session</h1>
        <Link className="text-primary underline" href="/review">
          Review sessions
        </Link>
      </div>

      <fieldset className="flex gap-6 flex-wrap text-sm" data-testid="import-mode">
        <legend className="sr-only">Import mode</legend>
        {MODES.map((m) => (
          <label key={m.mode} className="flex items-start gap-2 cursor-pointer max-w-sm">
            <input
              type="radio"
              name="import-mode"
              className="mt-1"
              checked={mode === m.mode}
              disabled={locked && mode !== m.mode}
              onChange={() => setMode(m.mode)}
            />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-on-surface-variant">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <SessionDetailsCard d={d} />
      {mode === "pairs" ? (
        <PairFilesImport d={d} onLock={() => setLocked(true)} />
      ) : (
        <SingleFileImport d={d} onLock={() => setLocked(true)} />
      )}
    </main>
  );
}
