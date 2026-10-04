import { requireAuth } from "@/lib/auth/requireAuth";
import { buildBundle } from "@/lib/output/bundle";
import { assertId, paths } from "@/lib/storage/paths";
import { getBytes, getStore } from "@/lib/storage/store";

export const maxDuration = 120;
const STREAM_LIMIT_BYTES = 4_000_000;

/**
 * GET /api/bundle?sessionId=... builds the evidence zip (build-plan P6.7),
 * stores it at bundles/{id}/bundle.zip, and returns it: streamed when small,
 * otherwise through a 10-minute presigned URL.
 */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("sessionId") ?? "";
  try {
    assertId(id, "session id");
  } catch {
    return Response.json({ error: "bad sessionId" }, { status: 400 });
  }
  const store = getStore();
  const wanted: Record<string, string> = {
    "A.docx": paths.document(id, "A"),
    "B.docx": paths.document(id, "B"),
    "stereo.wav": paths.stereo(id),
    "transcript-pass1.json": paths.transcript(id, 1),
    "transcript-pass2.json": paths.transcript(id, 2),
    "energy.json": paths.energy(id),
    "session.json": paths.session(id),
  };
  const files: Record<string, Uint8Array> = {};
  for (const [name, p] of Object.entries(wanted)) {
    const b = await getBytes(store, p);
    if (b) files[name] = b;
  }
  if (!files["session.json"]) return Response.json({ error: "not found" }, { status: 404 });
  const zip = buildBundle(files);
  const where = paths.bundle(id);
  await store.put(where, zip, "application/zip");
  if (zip.length > STREAM_LIMIT_BYTES) {
    const url = await store.presignGet(where, 10 * 60 * 1000);
    if (url) return new Response(null, { status: 307, headers: { Location: url } });
  }
  return new Response(zip as BlobPart, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${id}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
