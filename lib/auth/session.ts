// Signed session cookie. Uses Web Crypto only, so the same code runs in the
// route handlers and in proxy.ts.

export const COOKIE_NAME = "viva_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const enc = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

/** Compares two byte arrays in time that depends only on their length. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Constant-time password check. Hashing both sides first gives equal-length
 * inputs, so the comparison time reveals nothing about the password length.
 */
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return equalBytes(a, b);
}

/** Returns a cookie value of the form `<expiry seconds>.<signature>`. */
export async function signSession(secret: string, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = String(exp);
  return `${payload}.${toB64Url(await hmac(secret, payload))}`;
}

export async function verifySession(
  secret: string | undefined,
  value: string | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!secret || !value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(payload)) return false;
  const expected = toB64Url(await hmac(secret, payload));
  if (!equalBytes(enc.encode(sig), enc.encode(expected))) return false;
  return Number(payload) * 1000 > nowMs;
}
