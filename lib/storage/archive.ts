// Browser archive (build-plan P6.2): at Stop, upload the WAV, energy, pass-one
// transcript and measurements, then the session record, to the private store.
// The IndexedDB copy stays until every upload confirms.

import { upload } from "@vercel/blob/client";
import type { SessionRecord } from "@/lib/analysis/types";
import { CAPTURE_RATE } from "@/lib/audio/dsp";
import { buildStereoWav, trimChunks } from "@/lib/audio/wav";
import { deleteSession, getArtifact, getSession, readPcm } from "./local";
import { paths } from "./paths";

/** Audio kept before the Start marker, in ms. */
export const PRE_ROLL_MS = 5000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface ArchiveProgress {
  step: number;
  total: number;
  label: string;
}

export type Uploader = (pathname: string, body: Blob, contentType: string) => Promise<void>;

/** Picks Blob client uploads or the in-memory PUT, as /api/upload reports. */
export async function chooseUploader(): Promise<Uploader> {
  const res = await fetch("/api/upload");
  if (!res.ok) throw new Error(`upload route returned HTTP ${res.status}`);
  const { mode } = (await res.json()) as { mode: "blob" | "memory" };
  if (mode === "memory") {
    return async (pathname, body, contentType) => {
      const r = await fetch(`/api/upload?pathname=${encodeURIComponent(pathname)}`, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body,
      });
      if (!r.ok) throw new Error(`upload of ${pathname} returned HTTP ${r.status}`);
    };
  }
  return async (pathname, body, contentType) => {
    await upload(pathname, body, {
      access: "private",
      handleUploadUrl: "/api/upload",
      contentType,
      multipart: body.size > 20_000_000,
    });
  };
}

async function withRetry(fn: () => Promise<void>, delays = RETRY_DELAYS_MS): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: "application/json" });

export async function archiveSession(
  id: string,
  onProgress: (p: ArchiveProgress) => void = () => {},
): Promise<SessionRecord> {
  const rec = await getSession(id);
  if (!rec) throw new Error(`No local session ${id}`);
  if (rec.markers.startMs === null || rec.markers.stopMs === null)
    throw new Error("The session has not stopped");
  const words = (await getArtifact<unknown[]>(id, "transcript-pass1")) ?? [];
  const features = (await getArtifact<unknown[]>(id, "measurements-pass1")) ?? [];
  const energy = await getArtifact(id, "energy");
  const meta = (await getArtifact<{ rawStartMs: number | null }>(id, "capture-meta")) ?? {
    rawStartMs: 0,
  };

  // Trim pre-roll so a long wait before Start does not bloat the WAV.
  const rawStart = meta.rawStartMs ?? 0;
  const skipFrames = Math.max(
    0,
    Math.round(((rec.markers.startMs - PRE_ROLL_MS - rawStart) * CAPTURE_RATE) / 1000),
  );
  const wav = buildStereoWav(trimChunks(await readPcm(id), skipFrames));
  const wavOffsetMs = rawStart + (skipFrames * 1000) / CAPTURE_RATE;

  const archived: SessionRecord = {
    ...rec,
    passes: {
      ...rec.passes,
      "1": {
        transcript: paths.transcript(id, 1),
        measurements: paths.measurements(id, 1),
        completedAt: new Date().toISOString(),
        source: "usb",
      },
    },
    events: [
      ...rec.events,
      { type: "archive", atMs: rec.markers.stopMs, detail: { wavOffsetMs, wavBytes: wav.size } },
    ],
  };

  const put = await chooseUploader();
  const steps: [string, string, Blob, string][] = [
    ["audio", paths.stereo(id), wav, "audio/wav"],
    ["energy", paths.energy(id), json(energy), "application/json"],
    ["transcript", paths.transcript(id, 1), json({ words }), "application/json"],
    [
      "measurements",
      paths.measurements(id, 1),
      json({ pipelineVersion: rec.pipelineVersion, pass: 1, features }),
      "application/json",
    ],
    ["session record", paths.session(id), json(archived), "application/json"],
  ];
  for (const [i, [label, pathname, body, type]] of steps.entries()) {
    onProgress({ step: i, total: steps.length, label });
    await withRetry(() => put(pathname, body, type));
  }
  onProgress({ step: steps.length, total: steps.length, label: "done" });
  await deleteSession(id);
  return archived;
}
