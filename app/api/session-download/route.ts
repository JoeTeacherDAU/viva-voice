import { requireAuth } from "@/lib/auth/requireAuth";
import { buildSessionDownload } from "@/lib/output/sessionList";
import { assertId, paths } from "@/lib/storage/paths";
import { getStore } from "@/lib/storage/store";

export const maxDuration = 120;
const STREAM_LIMIT_BYTES = 4_000_000;

/**
 * GET /api/session-download?label=... zips every pair's two documents and the
 * session's CSV rows for one session label (work order 02, item 11), stores
 * the zip, and returns it: streamed when small, otherwise by presigned URL.
 */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const label = new URL(request.url).searchParams.get("label") ?? "";
  try {
    assertId(label, "session label");
  } catch {
    return Response.json({ error: "bad label" }, { status: 400 });
  }
  const store = getStore();
  const zip = await buildSessionDownload(store, label);
  if (!zip) return Response.json({ error: "no sessions with that label" }, { status: 404 });
  const where = paths.sessionDownload(label);
  await store.put(where, zip, "application/zip");
  if (zip.length > STREAM_LIMIT_BYTES) {
    const url = await store.presignGet(where, 10 * 60 * 1000);
    if (url) return new Response(null, { status: 307, headers: { Location: url } });
  }
  return new Response(zip as BlobPart, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${label}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
