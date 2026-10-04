import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/login", () => {
  beforeEach(() => {
    process.env.VIVA_PASSWORD = "correct horse";
    process.env.VIVA_SESSION_SECRET = "s".repeat(32);
  });
  afterEach(() => {
    delete process.env.VIVA_PASSWORD;
  });

  it("sets a signed HttpOnly cookie on the right password", async () => {
    const res = await post({ password: "correct horse" });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    const value = decodeURIComponent(setCookie.split(";")[0].split("=")[1]);
    expect(await verifySession(process.env.VIVA_SESSION_SECRET, value)).toBe(true);
  });

  it("returns 401 and no cookie on a wrong password", async () => {
    const res = await post({ password: "battery staple" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 400 on a body that is not JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("returns 500 when VIVA_PASSWORD is unset", async () => {
    delete process.env.VIVA_PASSWORD;
    expect((await post({ password: "" })).status).toBe(500);
  });
});
