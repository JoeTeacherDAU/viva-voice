import { requireAuth } from "@/lib/auth/requireAuth";
import { assertId, paths } from "@/lib/storage/paths";
import { getStore, putJson } from "@/lib/storage/store";
import { validateRoster } from "@/lib/validation";

/**
 * POST /api/roster?examId=... writes roster/{examId}.json. Write only: the
 * setup screen reads the roster through /api/file, and no export or research
 * code reads it (CLAUDE.md).
 */
export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const examId = new URL(request.url).searchParams.get("examId") ?? "";
  try {
    assertId(examId, "exam id");
  } catch {
    return Response.json({ error: "bad examId" }, { status: 400 });
  }
  let roster: unknown;
  try {
    roster = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const v = validateRoster(roster);
  if (!v.ok) return Response.json({ error: v.errors.join("; ") }, { status: 422 });
  await putJson(getStore(), paths.roster(examId), roster);
  return Response.json({ ok: true, entries: (roster as unknown[]).length });
}
