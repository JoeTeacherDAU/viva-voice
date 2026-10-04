// IndexedDB crash buffer (PLAN.md section 5). Never the store of record:
// the archive uploads to Blob at Stop, and this copy goes once every upload
// confirms.

import type { SessionRecord } from "@/lib/analysis/types";

export const DB_NAME = "viva";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pcm")) db.createObjectStore("pcm");
      // Version 2: pass-one transcript, energy, and measurements per session.
      if (!db.objectStoreNames.contains("artifacts")) db.createObjectStore("artifacts");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Test hook: close and forget the cached connection so the database can be deleted. */
export async function resetDbForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p).close();
}

function tx<T>(
  store: "sessions" | "pcm" | "artifacts",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function putSession(rec: SessionRecord): Promise<void> {
  await tx("sessions", "readwrite", (s) => s.put(rec));
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return tx<SessionRecord>("sessions", "readonly", (s) => s.get(id));
}

export async function listSessions(): Promise<SessionRecord[]> {
  return (await tx<SessionRecord[]>("sessions", "readonly", (s) => s.getAll())) ?? [];
}

/** Deletes the session record and every PCM chunk it owns. */
export async function deleteSession(id: string): Promise<void> {
  await tx("sessions", "readwrite", (s) => s.delete(id));
  await tx("pcm", "readwrite", (s) => s.delete(IDBKeyRange.bound([id, 0], [id, Infinity])));
  await tx("artifacts", "readwrite", (s) => s.delete(IDBKeyRange.bound([id, ""], [id, "\uffff"])));
}

export type ArtifactName = "transcript-pass1" | "energy" | "measurements-pass1";

export async function putArtifact(
  sessionId: string,
  name: ArtifactName,
  value: unknown,
): Promise<void> {
  await tx("artifacts", "readwrite", (s) => s.put(value, [sessionId, name]));
}

export async function getArtifact<T>(
  sessionId: string,
  name: ArtifactName,
): Promise<T | undefined> {
  return tx<T>("artifacts", "readonly", (s) => s.get([sessionId, name]));
}

export async function appendPcm(sessionId: string, seq: number, buf: ArrayBuffer): Promise<void> {
  await tx("pcm", "readwrite", (s) => s.put(buf, [sessionId, seq]));
}

/** Every PCM chunk for a session, in sequence order. */
export async function readPcm(sessionId: string): Promise<ArrayBuffer[]> {
  return (
    (await tx<ArrayBuffer[]>("pcm", "readonly", (s) =>
      s.getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity])),
    )) ?? []
  );
}

/** Asks the browser not to evict this origin's storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await globalThis.navigator?.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * Buffers raw PCM chunks in memory and writes them to IndexedDB every
 * flushMs (two seconds by default), so a crash loses at most that much audio.
 */
export class PcmWriter {
  private pending: ArrayBuffer[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    flushMs = 2000,
  ) {
    this.timer = setInterval(() => void this.flush(), flushMs);
  }

  push(buf: ArrayBuffer): void {
    this.pending.push(buf);
  }

  flush(): Promise<void> {
    if (this.pending.length === 0) return this.writing;
    const total = this.pending.reduce((a, b) => a + b.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of this.pending) {
      merged.set(new Uint8Array(b), off);
      off += b.byteLength;
    }
    this.pending = [];
    const seq = this.seq++;
    this.writing = this.writing.then(() => appendPcm(this.sessionId, seq, merged.buffer));
    return this.writing;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
