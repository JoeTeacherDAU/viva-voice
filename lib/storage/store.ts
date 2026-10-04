// Server-side archive store. VercelBlobStore talks to the private Blob store;
// MemoryStore is the in-memory fake that CI and the e2e tests use
// (build-plan P6 human gate). getStore() picks one per process.

import { del, get, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import { contentTypeFor } from "./paths";

export interface StoredObject {
  pathname: string;
  size: number;
  uploadedAt: string;
}

export interface ArchiveStore {
  readonly kind: "blob" | "memory";
  put(
    pathname: string,
    body: string | Uint8Array | ArrayBuffer | Blob,
    contentType?: string,
  ): Promise<void>;
  get(
    pathname: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number } | null>;
  list(prefix: string): Promise<StoredObject[]>;
  del(pathnames: string[]): Promise<void>;
  /** A short-lived GET URL for direct download, or null when the store has none. */
  presignGet(pathname: string, ttlMs: number): Promise<string | null>;
}

export async function getBytes(store: ArchiveStore, pathname: string): Promise<Uint8Array | null> {
  const r = await store.get(pathname);
  if (!r) return null;
  return new Uint8Array(await new Response(r.body).arrayBuffer());
}

export async function getJson<T>(store: ArchiveStore, pathname: string): Promise<T | null> {
  const b = await getBytes(store, pathname);
  return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null;
}

export async function putJson(
  store: ArchiveStore,
  pathname: string,
  value: unknown,
): Promise<void> {
  await store.put(pathname, JSON.stringify(value), "application/json");
}

export class MemoryStore implements ArchiveStore {
  readonly kind = "memory" as const;
  private objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; uploadedAt: string }
  >();

  async put(
    pathname: string,
    body: string | Uint8Array | ArrayBuffer | Blob,
    contentType?: string,
  ) {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : body;
    this.objects.set(pathname, {
      bytes: new Uint8Array(bytes),
      contentType: contentType ?? contentTypeFor(pathname),
      uploadedAt: new Date().toISOString(),
    });
  }

  async get(pathname: string) {
    const o = this.objects.get(pathname);
    if (!o) return null;
    return {
      body: new Blob([o.bytes as BlobPart]).stream(),
      contentType: o.contentType,
      size: o.bytes.length,
    };
  }

  async list(prefix: string) {
    return [...this.objects]
      .filter(([p]) => p.startsWith(prefix))
      .map(([pathname, o]) => ({ pathname, size: o.bytes.length, uploadedAt: o.uploadedAt }))
      .sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
  }

  async del(pathnames: string[]) {
    for (const p of pathnames) this.objects.delete(p);
  }

  async presignGet(_pathname?: string, _ttlMs?: number): Promise<string | null> {
    void _pathname;
    void _ttlMs;
    return null;
  }

  /** Test hook. */
  clear() {
    this.objects.clear();
  }
}

export class VercelBlobStore implements ArchiveStore {
  readonly kind = "blob" as const;

  async put(
    pathname: string,
    body: string | Uint8Array | ArrayBuffer | Blob,
    contentType?: string,
  ) {
    const data = body instanceof Uint8Array ? new Blob([body as BlobPart]) : body;
    await put(pathname, data as Blob | string | ArrayBuffer, {
      access: "private",
      contentType: contentType ?? contentTypeFor(pathname),
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async get(pathname: string) {
    const r = await get(pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return { body: r.stream, contentType: r.blob.contentType, size: r.blob.size };
  }

  async list(prefix: string) {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: new Date(b.uploadedAt).toISOString(),
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async del(pathnames: string[]) {
    for (let i = 0; i < pathnames.length; i += 500) await del(pathnames.slice(i, i + 500));
  }

  async presignGet(pathname: string, ttlMs: number) {
    const validUntil = Date.now() + ttlMs;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    return presignedUrl;
  }
}

const g = globalThis as unknown as { __vivaStore?: ArchiveStore };

/**
 * The in-memory fake runs when VIVA_STORE=memory, or when no Blob token exists
 * and VIVA_MOCK_ASR=1 (local dev and CI). Everything else uses Vercel Blob.
 */
export function getStore(): ArchiveStore {
  if (!g.__vivaStore) {
    const memory =
      process.env.VIVA_STORE === "memory" ||
      (!process.env.BLOB_READ_WRITE_TOKEN && process.env.VIVA_MOCK_ASR === "1");
    g.__vivaStore = memory ? new MemoryStore() : new VercelBlobStore();
  }
  return g.__vivaStore;
}

/** Test hook: install a store for this process. */
export function setStore(store: ArchiveStore | undefined): void {
  g.__vivaStore = store;
}
