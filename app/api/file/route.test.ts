import { afterEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, signSession } from "@/lib/auth/session";
import { MemoryStore, setStore } from "@/lib/storage/store";
import { GET } from "./route";

const SECRET = "s".repeat(32);

async function get(pathname: string) {
  process.env.VIVA_SESSION_SECRET = SECRET;
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(await signSession(SECRET))}`;
  return GET(
    new Request(`http://localhost/api/file?pathname=${encodeURIComponent(pathname)}`, {
      headers: { cookie },
    }),
  );
}

/** Vercel Blob serves JSON compressed and reports size 0, as it did on 2026-10-19. */
class CompressedSizeStore extends MemoryStore {
  async get(pathname: string) {
    const r = await super.get(pathname);
    return r ? { ...r, size: 0 } : null;
  }
}

describe("GET /api/file", () => {
  afterEach(() => setStore(undefined));

  it("streams the whole body when the store reports size 0", async () => {
    const store = new CompressedSizeStore();
    await store.put("exams/x.json", JSON.stringify({ id: "x", targetPatterns: ["because"] }));
    setStore(store);
    const res = await get("exams/x.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.json()).toEqual({ id: "x", targetPatterns: ["because"] });
  });

  it("declares the length when the store knows it", async () => {
    const store = new MemoryStore();
    await store.put("exams/x.json", "{}");
    setStore(store);
    const res = await get("exams/x.json");
    expect(res.headers.get("content-length")).toBe("2");
  });
});
