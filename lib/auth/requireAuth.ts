import { COOKIE_NAME, verifySession } from "./session";

/**
 * Route handlers call this as a second check behind proxy.ts. Returns a 401
 * Response when the request carries no valid session cookie, else null.
 */
export async function requireAuth(request: Request): Promise<Response | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : undefined;
  const ok = await verifySession(process.env.VIVA_SESSION_SECRET, value);
  return ok ? null : Response.json({ error: "unauthorised" }, { status: 401 });
}
