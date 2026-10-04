export {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  passwordMatches,
  signSession,
  verifySession,
} from "./session";

/**
 * Paths proxy.ts lets through without a session cookie. /api/upload and
 * /api/retention check auth themselves: Vercel Blob's upload callback carries
 * a signature instead of a cookie, and the monthly cron carries CRON_SECRET.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/upload" ||
    pathname === "/api/retention"
  );
}
