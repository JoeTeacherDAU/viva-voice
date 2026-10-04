// Archive layout from PLAN.md section 10. Every path the app writes comes from here.

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function assertId(id: string, what = "id"): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${what}: ${id}`);
  return id;
}

export const paths = {
  exam: (examId: string) => `exams/${assertId(examId, "exam id")}.json`,
  roster: (examId: string) => `roster/${assertId(examId, "exam id")}.json`,
  session: (id: string) => `sessions/${assertId(id)}.json`,
  stereo: (id: string) => `audio/${assertId(id)}/stereo.wav`,
  onboardStereo: (id: string) => `audio/${assertId(id)}/onboard-stereo.wav`,
  energy: (id: string) => `energy/${assertId(id)}.json`,
  transcript: (id: string, pass: 1 | 2) => `transcripts/${assertId(id)}/pass${pass}.json`,
  measurements: (id: string, pass: 1 | 2) => `measurements/${assertId(id)}/pass${pass}.json`,
  document: (id: string, student: "A" | "B") => `documents/${assertId(id)}/${student}.docx`,
  bundle: (id: string) => `bundles/${assertId(id)}/bundle.zip`,
  baseline: (examId: string) => `baselines/${assertId(examId, "exam id")}.json`,
  instructor: (examId: string) => `instructor/${assertId(examId, "exam id")}.json`,
  wide: (examId: string) => `exports/${assertId(examId, "exam id")}/wide.csv`,
  long: (examId: string) => `exports/${assertId(examId, "exam id")}/long.csv`,
  retentionLog: () => "retention/log.json",
};

export const UPLOAD_CONTENT_TYPES = ["audio/wav", "application/json"];
export const UPLOAD_MAX_BYTES = 120_000_000;

/**
 * Pathnames a browser may upload (build-plan P6.1). The session id in the
 * path must be a safe id; no "..", no other prefixes.
 */
export function uploadPathAllowed(pathname: string): boolean {
  if (pathname.includes("..") || pathname.startsWith("/")) return false;
  const id = "[A-Za-z0-9_-]+";
  return [
    new RegExp(`^audio/${id}/(stereo|onboard-stereo)\\.wav$`),
    new RegExp(`^energy/${id}\\.json$`),
    new RegExp(`^transcripts/${id}/pass1\\.json$`),
    new RegExp(`^measurements/${id}/pass1\\.json$`),
    new RegExp(`^sessions/${id}\\.json$`),
  ].some((re) => re.test(pathname));
}

export function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".json")) return "application/json";
  if (pathname.endsWith(".wav")) return "audio/wav";
  if (pathname.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (pathname.endsWith(".zip")) return "application/zip";
  if (pathname.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
