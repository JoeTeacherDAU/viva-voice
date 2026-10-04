import demoExam from "@/fixtures/exams/demo-exam.json";
import demoRoster from "@/fixtures/exams/demo-roster.json";

/** exams/{examId}.json in the Blob store (PLAN.md section 10). */
export interface ExamRecord {
  id: string;
  course: string;
  unit: string;
  prompt: string;
  targetPatterns: string[];
  keyterms: string[];
  durationMs: number;
  /** ISO date the term ends; the retention job counts 24 months from it (ruling R2). */
  termEnd?: string;
}

/** One line of roster/{examId}.json. The roster never leaves the setup screen. */
export interface RosterEntry {
  name: string;
  participantId: string;
  consentStatus: "granted" | "declined" | "pending";
}

export const DEMO_EXAM_ID = "demo-exam";

export function demoMode(): boolean {
  return process.env.VIVA_MOCK_ASR === "1";
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const res = await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load ${pathname} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function loadExam(examId: string): Promise<ExamRecord> {
  if (examId === DEMO_EXAM_ID && demoMode()) return demoExam as ExamRecord;
  return fetchJson<ExamRecord>(`exams/${examId}.json`);
}

export async function loadRoster(examId: string): Promise<RosterEntry[]> {
  if (examId === DEMO_EXAM_ID && demoMode()) return demoRoster as RosterEntry[];
  return fetchJson<RosterEntry[]>(`roster/${examId}.json`);
}

/** The demo exam and roster, available synchronously in mock mode. */
export function demoData(): { exam: ExamRecord; roster: RosterEntry[] } | null {
  return demoMode() ? { exam: demoExam as ExamRecord, roster: demoRoster as RosterEntry[] } : null;
}
