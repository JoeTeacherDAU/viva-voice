import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, signSession } from "@/lib/auth";
import { GRANT_URL, POST } from "./route";

const SECRET = "grant-test-secret-0123456789abcdef";
const KEY = "dg-secret-key-should-never-leak";

async function authedRequest(): Promise<Request> {
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(await signSession(SECRET))}`;
  return new Request("http://localhost/api/asr/grant", { method: "POST", headers: { cookie } });
}

describe("POST /api/asr/grant", () => {
  beforeEach(() => {
    process.env.VIVA_SESSION_SECRET = SECRET;
    process.env.DEEPGRAM_API_KEY = KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.DEEPGRAM_API_KEY;
  });

  it("returns a token from Deepgram's grant endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ access_token: "jwt-abc", expires_in: 60 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(await authedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "jwt-abc", expiresIn: 60 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GRANT_URL);
    expect(init.headers.Authorization).toBe(`Token ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({ ttl_seconds: 60 });
  });

  it("refuses an unauthenticated request without calling Deepgram", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(new Request("http://localhost/api/asr/grant", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing key and an upstream failure without leaking the key", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    const bad = await POST(await authedRequest());
    expect(bad.status).toBe(502);
    expect(await bad.text()).not.toContain(KEY);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect((await POST(await authedRequest())).status).toBe(502);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    expect((await POST(await authedRequest())).status).toBe(502);

    delete process.env.DEEPGRAM_API_KEY;
    expect((await POST(await authedRequest())).status).toBe(500);
    const logged = [...log.mock.calls, ...err.mock.calls].flat().join(" ");
    expect(logged).not.toContain(KEY);
  });
});
