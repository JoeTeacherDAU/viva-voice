import { requireAuth } from "@/lib/auth/requireAuth";

export const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
export const GRANT_TTL_SECONDS = 60;

/**
 * Exchanges the server-side DEEPGRAM_API_KEY for a short-lived JWT the browser
 * uses to open the live socket (PLAN.md section 6.1). The key never leaves the
 * server and this route never logs it.
 */
export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "DEEPGRAM_API_KEY is not configured" }, { status: 500 });

  let res: Response;
  try {
    res = await fetch(GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: GRANT_TTL_SECONDS }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "Deepgram grant request failed" }, { status: 502 });
  }
  if (!res.ok) {
    return Response.json({ error: `Deepgram grant returned HTTP ${res.status}` }, { status: 502 });
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token)
    return Response.json({ error: "Deepgram grant had no token" }, { status: 502 });
  return Response.json(
    { token: body.access_token, expiresIn: body.expires_in ?? GRANT_TTL_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
