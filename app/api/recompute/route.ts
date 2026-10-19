import { requireAuth } from "@/lib/auth/requireAuth";
import { Pass2Error, recomputeStored } from "@/lib/output/pass2";
import { assertId } from "@/lib/storage/paths";
import { getStore } from "@/lib/storage/store";

export const maxDuration = 120;

/**
 * POST /api/recompute {sessionId} reruns the pipeline over the stored
 * pass-two transcript with the exam's current target patterns and keyterms,
 * and replaces the measurements, documents, and CSV rows (work order 02, item 9).
 */
export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  let sessionId = "";
  try {
    sessionId = ((await request.json()) as { sessionId?: string }).sessionId ?? "";
    assertId(sessionId, "session id");
  } catch {
    return Response.json({ error: "body must be {sessionId}" }, { status: 400 });
  }
  try {
    const { record, previous } = await recomputeStored(getStore(), sessionId);
    return Response.json({ ok: true, targetPatterns: record.config.targetPatterns, previous });
  } catch (e) {
    const status = e instanceof Pass2Error ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
