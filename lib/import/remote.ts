// Calls to the app's own routes that the import page, the setup page, and the
// command-line import (work order 04) share. Each takes a fetch bound to the
// app: in the browser the plain fetch, on the command line one that adds the
// base URL and the session cookie.

import type { ExamRecord } from "@/lib/exams";

export type AppFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** A JSON object from the archive through /api/file, or null when the archive has none. */
export async function readArchiveJson<T>(f: AppFetch, pathname: string): Promise<T | null> {
  const res = await f(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`Could not load ${pathname} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/** The exam record /import/session creates from only an id, a title, and a duration. */
export function newExamRecord(id: string, title: string, minutes: number): ExamRecord {
  return {
    id: id.trim(),
    title: title.trim(),
    course: "",
    unit: "",
    prompt: "",
    targetPatterns: [],
    keyterms: [],
    durationMs: Math.round(minutes * 60_000),
  };
}

async function postJson(f: AppFetch, path: string, body: unknown) {
  const res = await f(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string;
    examId?: string;
    entries?: number;
  };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

/** POST /api/exam. Returns the exam id the server stored. */
export async function postExam(f: AppFetch, exam: unknown): Promise<string> {
  return (await postJson(f, "/api/exam", exam)).examId ?? "";
}

/** POST /api/roster, as the setup page's Import roster JSON button does. Returns the entry count. */
export async function postRoster(f: AppFetch, examId: string, roster: unknown): Promise<number> {
  return (
    (await postJson(f, `/api/roster?examId=${encodeURIComponent(examId)}`, roster)).entries ?? 0
  );
}

/** GET /api/pass2: whether pass two can run, and why not. */
export async function pass2Ready(
  f: AppFetch,
): Promise<{ ready: boolean; mode?: string; error?: string }> {
  const res = await f("/api/pass2", { cache: "no-store" });
  if (!res.ok) return { ready: false, error: `HTTP ${res.status}` };
  return (await res.json()) as { ready: boolean; mode?: string; error?: string };
}

/** POST /api/pass2 for one session. */
export async function runPass2For(
  f: AppFetch,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await postJson(f, "/api/pass2", { sessionId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** A pass-two error that will fail for every pair, so the run should stop. */
export const pass2Fatal = (error: string) => error.includes("DEEPGRAM_API_KEY");
