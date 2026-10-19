import type { AudioSource, SessionRecord, Word } from "@/lib/analysis/types";
import { requireAuth } from "@/lib/auth/requireAuth";
import { DeepgramBatch, MockBatch, type BatchTranscriber } from "@/lib/asr/batch";
import { Pass2Error, runPass2, wavOffsetMs, type TranscriptFile } from "@/lib/output/pass2";
import { assertId, paths } from "@/lib/storage/paths";
import { getJson, getStore } from "@/lib/storage/store";

export const maxDuration = 300;

/** CI stand-in for Deepgram: the archived pass-one words, moved back to WAV time. */
function mockBatch(sessionId: string): BatchTranscriber {
  return new MockBatch(async () => {
    const store = getStore();
    const rec = await getJson<SessionRecord>(store, paths.session(sessionId));
    const t = await getJson<TranscriptFile | Word[]>(store, paths.transcript(sessionId, 1));
    const words = Array.isArray(t) ? t : (t?.words ?? []);
    const off = rec ? wavOffsetMs(rec) : 0;
    return words.map((w) => ({ ...w, startMs: w.startMs - off, endMs: w.endMs - off }));
  });
}

const MISSING_KEY_MESSAGE =
  "DEEPGRAM_API_KEY is not set. Add it in the Vercel project's environment variables and redeploy, then run pass two again.";

/** GET /api/pass2 says whether pass two can run, so a page can stop before its first request. */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if (process.env.VIVA_MOCK_ASR === "1") return Response.json({ ready: true, mode: "mock" });
  if (process.env.DEEPGRAM_API_KEY) return Response.json({ ready: true, mode: "deepgram" });
  return Response.json({ ready: false, error: MISSING_KEY_MESSAGE });
}

export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  let body: { sessionId?: string; source?: AudioSource; robustness?: boolean };
  try {
    body = await request.json();
    assertId(body.sessionId ?? "", "session id");
  } catch {
    return Response.json({ error: "body must be {sessionId}" }, { status: 400 });
  }
  const sessionId = body.sessionId!;
  let batch: BatchTranscriber;
  if (process.env.VIVA_MOCK_ASR === "1") batch = mockBatch(sessionId);
  else if (process.env.DEEPGRAM_API_KEY) batch = new DeepgramBatch(process.env.DEEPGRAM_API_KEY);
  else return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });

  try {
    const { record, measurementsPath } = await runPass2(getStore(), sessionId, batch, {
      source: body.source,
      robustness: body.robustness === true,
    });
    return Response.json({
      ok: true,
      state: record.state,
      passes: record.passes,
      measurements: measurementsPath,
    });
  } catch (e) {
    const status = e instanceof Pass2Error ? e.status : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
