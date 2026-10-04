import { describe, expect, it } from "vitest";
import { isPublicPath, passwordMatches, signSession, verifySession } from ".";
import { requireAuth } from "./requireAuth";
import { COOKIE_NAME, SESSION_TTL_SECONDS } from "./session";

const SECRET = "test-secret-32-bytes-long-enough!!";

describe("passwordMatches", () => {
  it("accepts the right password and rejects others", async () => {
    expect(await passwordMatches("open sesame", "open sesame")).toBe(true);
    expect(await passwordMatches("open sesamE", "open sesame")).toBe(false);
    expect(await passwordMatches("", "open sesame")).toBe(false);
  });
  it("rejects everything when no password is configured", async () => {
    expect(await passwordMatches("", "")).toBe(false);
  });
});

describe("session cookie", () => {
  it("verifies its own signature", async () => {
    const v = await signSession(SECRET);
    expect(await verifySession(SECRET, v)).toBe(true);
  });
  it("rejects a tampered expiry, a wrong secret, and junk", async () => {
    const v = await signSession(SECRET);
    const [exp, sig] = v.split(".");
    expect(await verifySession(SECRET, `${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(await verifySession("other-secret", v)).toBe(false);
    expect(await verifySession(SECRET, "garbage")).toBe(false);
    expect(await verifySession(SECRET, undefined)).toBe(false);
    expect(await verifySession(undefined, v)).toBe(false);
  });
  it("expires after the TTL", async () => {
    const now = Date.UTC(2026, 9, 4);
    const v = await signSession(SECRET, now);
    expect(await verifySession(SECRET, v, now + (SESSION_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(await verifySession(SECRET, v, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("opens only the login page and login route", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/login")).toBe(true);
    expect(isPublicPath("/session")).toBe(false);
    expect(isPublicPath("/api/file")).toBe(false);
  });
});

describe("requireAuth", () => {
  it("passes a request with a valid cookie and blocks one without", async () => {
    process.env.VIVA_SESSION_SECRET = SECRET;
    const v = await signSession(SECRET);
    const ok = new Request("http://x/api/file", {
      headers: { cookie: `a=b; ${COOKIE_NAME}=${encodeURIComponent(v)}` },
    });
    expect(await requireAuth(ok)).toBeNull();
    const blocked = await requireAuth(new Request("http://x/api/file"));
    expect(blocked?.status).toBe(401);
  });
});
