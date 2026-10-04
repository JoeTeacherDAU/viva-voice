export {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  passwordMatches,
  signSession,
  verifySession,
} from "./session";

/** Paths that stay reachable without a session cookie. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/api/login";
}
