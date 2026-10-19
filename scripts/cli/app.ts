// Shared by the import commands (work order 04): reads .env.local, logs in to
// the app with VIVA_PASSWORD, and picks the uploader the app reports. It never
// prints the password, the Blob token, or the session cookie.

import { existsSync } from "node:fs";
import type { AppFetch } from "@/lib/import/remote";
import { uploadPathAllowed } from "@/lib/storage/paths";
import { VercelBlobStore } from "@/lib/storage/store";

export const PRODUCTION_URL = "https://viva-voice.vercel.app";

export interface AppConnection {
  baseUrl: string;
  fetch: AppFetch;
  mode: "blob" | "memory";
  upload: (pathname: string, body: Blob, contentType: string) => Promise<void>;
  uploaderHas: (pathname: string) => Promise<boolean>;
}

/** Variables already set win over the file, so a test can blank the real ones. */
export function loadEnv(useFile: boolean): void {
  if (useFile && existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export async function connect(baseUrl: string): Promise<AppConnection> {
  const password = process.env.VIVA_PASSWORD;
  if (!password) throw new Error("VIVA_PASSWORD is not set in .env.local.");
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`Login at ${baseUrl} failed with HTTP ${login.status}.`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const appFetch: AppFetch = (path, init = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), cookie },
    });

  const res = await appFetch("/api/upload");
  if (!res.ok) throw new Error(`The upload route returned HTTP ${res.status}.`);
  const { mode } = (await res.json()) as { mode: "blob" | "memory" };

  const guard = (pathname: string) => {
    if (!uploadPathAllowed(pathname)) throw new Error(`Upload path not allowed: ${pathname}`);
  };

  if (mode === "memory") {
    // The app's in-memory store (local dev and the e2e tests): PUT through its route.
    return {
      baseUrl,
      fetch: appFetch,
      mode,
      upload: async (pathname, body, contentType) => {
        guard(pathname);
        const r = await appFetch(`/api/upload?pathname=${encodeURIComponent(pathname)}`, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body,
        });
        if (!r.ok) throw new Error(`upload of ${pathname} returned HTTP ${r.status}`);
      },
      uploaderHas: async (pathname) => {
        const r = await appFetch(`/api/file?pathname=${encodeURIComponent(pathname)}`);
        await r.body?.cancel();
        return r.ok;
      },
    };
  }

  // The private Blob store, straight from this machine with the token in .env.local.
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("BLOB_READ_WRITE_TOKEN is not set in .env.local.");
  const store = new VercelBlobStore();
  return {
    baseUrl,
    fetch: appFetch,
    mode,
    upload: async (pathname, body, contentType) => {
      guard(pathname);
      await store.put(pathname, body, contentType);
    },
    uploaderHas: async (pathname) => {
      const obj = await store.get(pathname);
      await obj?.body.cancel();
      return obj !== null;
    },
  };
}
