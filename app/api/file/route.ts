import { requireAuth } from "@/lib/auth/requireAuth";
import { getStore } from "@/lib/storage/store";

/** Above this size the route hands out a presigned URL instead of streaming. */
export const STREAM_LIMIT_BYTES = 4_000_000;
const PRESIGN_TTL_MS = 10 * 60 * 1000;

/**
 * Authenticated read from the private store (build-plan P6.3). Small objects
 * stream through the function; large ones (WAVs, zips) redirect to a
 * 10-minute presigned URL so the download skips the function's body limit.
 */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const pathname = new URL(request.url).searchParams.get("pathname") ?? "";
  if (!pathname || pathname.includes("..") || pathname.startsWith("/")) {
    return Response.json({ error: "bad pathname" }, { status: 400 });
  }
  const store = getStore();
  const obj = await store.get(pathname);
  if (!obj) return Response.json({ error: "not found" }, { status: 404 });
  if (obj.size > STREAM_LIMIT_BYTES) {
    const url = await store.presignGet(pathname, PRESIGN_TTL_MS);
    if (url) {
      await obj.body.cancel();
      return new Response(null, {
        status: 307,
        headers: { Location: url, "Cache-Control": "private, no-store" },
      });
    }
  }
  const name = pathname.split("/").pop() ?? "file";
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.size),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
