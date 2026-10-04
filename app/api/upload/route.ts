import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "@/lib/auth/requireAuth";
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES, uploadPathAllowed } from "@/lib/storage/paths";
import { getStore } from "@/lib/storage/store";

/** Tells the browser which upload route to use: Blob client uploads or direct PUT to the fake. */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  return Response.json({ mode: getStore().kind });
}

/**
 * Vercel Blob client uploads (build-plan P6.1). The token request carries the
 * session cookie; the callback from Vercel Blob after an upload does not, and
 * handleUpload verifies that one by its signature.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  if (body.type === "blob.generate-client-token") {
    const denied = await requireAuth(request);
    if (denied) return denied;
  }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!uploadPathAllowed(pathname)) throw new Error(`Upload path not allowed: ${pathname}`);
        return {
          allowedContentTypes: UPLOAD_CONTENT_TYPES,
          maximumSizeInBytes: UPLOAD_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Direct upload into the in-memory store, for local dev and CI only. */
export async function PUT(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const store = getStore();
  if (store.kind !== "memory")
    return Response.json({ error: "use Blob client uploads" }, { status: 405 });
  const pathname = new URL(request.url).searchParams.get("pathname") ?? "";
  if (!uploadPathAllowed(pathname))
    return Response.json({ error: "path not allowed" }, { status: 400 });
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!UPLOAD_CONTENT_TYPES.includes(type))
    return Response.json({ error: "content type not allowed" }, { status: 415 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > UPLOAD_MAX_BYTES)
    return Response.json({ error: "too large" }, { status: 413 });
  const declared = Number(request.headers.get("content-length") ?? bytes.length);
  if (declared !== bytes.length) {
    return Response.json(
      { error: `received ${bytes.length} of ${declared} bytes` },
      { status: 400 },
    );
  }
  await store.put(pathname, bytes, type);
  return Response.json({ pathname, size: bytes.length });
}
