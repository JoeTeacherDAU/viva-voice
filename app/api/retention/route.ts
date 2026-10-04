import { requireAuth } from "@/lib/auth/requireAuth";
import { runRetention } from "@/lib/output/retention";
import { getStore } from "@/lib/storage/store";

export const maxDuration = 300;

/**
 * Monthly retention job (build-plan P6.10, ruling R2). Vercel Cron calls it
 * with "Authorization: Bearer $CRON_SECRET"; a signed-in session can also run it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization");
  const cronOk = !!secret && bearer === `Bearer ${secret}`;
  if (!cronOk) {
    const denied = await requireAuth(request);
    if (denied) return denied;
  }
  const lines = await runRetention(getStore());
  return Response.json({ ok: true, exams: lines });
}
