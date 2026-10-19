import { requireAuth } from "@/lib/auth/requireAuth";
import { listSessions } from "@/lib/output/sessionList";
import { getStore } from "@/lib/storage/store";

/** GET /api/sessions lists every archived session for the review list. Reads sessions/ only. */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  return Response.json({ sessions: await listSessions(getStore()) });
}
