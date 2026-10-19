"use client";

// Pieces both import modes share (work orders 02 and 03): formatting, the
// per-file upload list with Retry, and pass two for every pair.

import Link from "next/link";
import { useRef, useState } from "react";
import type { SessionRecord } from "@/lib/analysis/types";
import { pass2Queue, type UploadItem } from "@/lib/import/records";
import type { Uploader } from "@/lib/storage/archive";
import { Button, Card, Icon } from "@/lib/ui";

export const field = "rounded-control bg-surface-highest border border-outline-variant px-3 py-2";
export const today = () => new Date().toLocaleDateString("en-CA");

/** m:ss.mmm from a frame count. */
export function clock(frames: number, rate: number): string {
  const ms = Math.round((frames * 1000) / rate);
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export async function exists(pathname: string): Promise<boolean> {
  const r = await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (r.body) await r.body.cancel();
  return r.ok;
}

export interface FileStatus {
  key: string;
  label: string;
  pathname: string;
  state: "waiting" | "uploading" | "done" | "failed";
  loaded: number;
  total: number;
  message?: string;
}

/**
 * Uploads a plan's files one at a time with progress. The last item is the
 * import record, and it goes only after every other file arrives.
 */
export function useUploads() {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const plan = useRef<UploadItem[]>([]);
  const uploader = useRef<Uploader | null>(null);

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

  async function runPending(statuses: Map<string, FileStatus["state"]>) {
    const last = plan.current.at(-1)!;
    let allOk = true;
    for (const item of plan.current.slice(0, -1)) {
      if (statuses.get(item.key) === "done") continue;
      if (!(await runItem(item))) allOk = false;
    }
    if (allOk && statuses.get(last.key) !== "done") await runItem(last);
  }

  async function start(items: UploadItem[], put: Uploader) {
    plan.current = items;
    uploader.current = put;
    setFiles(
      items.map((i) => ({
        key: i.key,
        label: i.label,
        pathname: i.pathname,
        state: "waiting",
        loaded: 0,
        total: 0,
      })),
    );
    await runPending(new Map());
  }

  async function retry(key: string) {
    const statuses = new Map(files.map((f) => [f.key, f.state]));
    statuses.set(key, "waiting");
    await runPending(statuses);
  }

  const started = files.length > 0;
  return { files, start, retry, started, done: started && files.every((f) => f.state === "done") };
}

export function UploadList({
  files,
  onRetry,
}: {
  files: FileStatus[];
  onRetry: (key: string) => void;
}) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-col gap-2 text-sm" data-testid="upload-files">
      {files.map((f) => {
        const pct = f.total ? Math.round((100 * f.loaded) / f.total) : 0;
        return (
          <li
            key={f.key}
            className="flex items-center gap-3 flex-wrap"
            data-testid={`upload-${f.key}`}
          >
            <span className="w-56 break-all">{f.label}</span>
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
                <Button onClick={() => onRetry(f.key)}>Retry</Button>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Pass two for every pair of one session label, one at a time, with a status line each. */
export function Pass2Card({
  step,
  records,
  sessionLabel,
}: {
  step: number;
  records: SessionRecord[];
  sessionLabel: string;
}) {
  const [pass2, setPass2] = useState<Record<string, string>>({});
  const [pass2Msg, setPass2Msg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-medium">{step}. Pass two</h2>
      <p className="text-on-surface-variant text-sm">
        Transcribes each pair with Deepgram, one at a time, and writes both documents and the CSV
        rows. Excluded pairs stay untranscribed.
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
            Pair {r.source?.order} ({r.id}, left {r.participantIds.A}, right {r.participantIds.B}):{" "}
            {pass2[r.id] ?? (r.excluded ? "excluded: consent" : "waiting")}
          </li>
        ))}
      </ul>
    </Card>
  );
}
