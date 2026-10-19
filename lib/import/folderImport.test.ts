import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PairFileSource, SessionRecord } from "@/lib/analysis/types";
import { COOKIE_NAME, signSession } from "@/lib/auth";
import type { RosterEntry } from "@/lib/exams";
import { paths, uploadPathAllowed } from "@/lib/storage/paths";
import { getBytes, getJson, MemoryStore, putJson, setStore } from "@/lib/storage/store";
import {
  formatPairLine,
  FolderImportStop,
  importSessionFolder,
  type FolderImportArgs,
  type FolderImportDeps,
} from "./folderImport";
import { makePairFixture } from "./synthetic";

// Work order 04: the command-line import, driven against the app's real route
// handlers on an in-memory store, with synthetic pair files only.

const SECRET = "folder-import-secret-0123456789ab";
const LABEL = "SYN_CLI_S1";
const EXAM = "cli-exam";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart]);
const ROSTER: RosterEntry[] = ["S01", "S02", "S03", "S04", "S05", "S06"].map((id) => ({
  name: `Secret Name ${id}`,
  participantId: id,
  consentStatus: id === "S03" ? "declined" : "granted",
}));

const ROUTES: Record<string, () => Promise<Record<string, unknown>>> = {
  "/api/file": () => import("@/app/api/file/route"),
  "/api/exam": () => import("@/app/api/exam/route"),
  "/api/roster": () => import("@/app/api/roster/route"),
  "/api/pass2": () => import("@/app/api/pass2/route"),
};

/** An AppFetch that calls the route handlers in process, with a valid session cookie. */
async function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, "http://app.test");
  const mod = await ROUTES[url.pathname]();
  const handler = mod[init.method ?? "GET"] as (r: Request) => Promise<Response>;
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(await signSession(SECRET))}`;
  return handler(
    new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } }),
  );
}

describe("command-line session import", () => {
  let store: MemoryStore;
  let uploads: string[];
  let logs: string[];
  const savedMock = process.env.VIVA_MOCK_ASR;

  beforeEach(() => {
    store = new MemoryStore();
    setStore(store);
    process.env.VIVA_SESSION_SECRET = SECRET;
    process.env.VIVA_MOCK_ASR = "1";
    uploads = [];
    logs = [];
  });
  afterEach(() => {
    setStore(undefined);
    if (savedMock === undefined) delete process.env.VIVA_MOCK_ASR;
    else process.env.VIVA_MOCK_ASR = savedMock;
  });

  function deps(over: Partial<FolderImportDeps> = {}): FolderImportDeps {
    return {
      fetch: appFetch,
      upload: async (pathname, body, contentType) => {
        expect(uploadPathAllowed(pathname), pathname).toBe(true);
        uploads.push(pathname);
        await store.put(pathname, body, contentType);
      },
      uploaderHas: async (p) => (await store.get(p)) !== null,
      log: (l) => logs.push(l),
      retryDelaysMs: [],
      ...over,
    };
  }

  function args(fx = makePairFixture(LABEL), over: Partial<FolderImportArgs> = {}) {
    return {
      sessionLabel: LABEL,
      examId: EXAM,
      sessionDate: "2026-10-19",
      title: "Synthetic midterm",
      durationMin: 5,
      manifest: { fileName: `${LABEL}_manifest.csv`, text: fx.manifest },
      // Handed over in reverse; matching goes by name.
      wavs: [...fx.files].reverse().map((f) => ({ name: f.name, blob: blobOf(f.bytes) })),
      ...over,
    };
  }

  it("creates the exam, stores each file unchanged, writes the page's records, and runs pass two", async () => {
    await putJson(store, paths.roster(EXAM), ROSTER);
    const fx = makePairFixture(LABEL);
    const { lines, ok } = await importSessionFolder(args(fx), deps());
    expect(ok).toBe(true);

    expect(await getJson(store, paths.exam(EXAM))).toMatchObject({
      id: EXAM,
      title: "Synthetic midterm",
      durationMs: 300000,
    });
    expect(uploads).toEqual([
      ...[1, 2, 3].flatMap((n) => [
        `audio/${LABEL}-P0${n}/stereo.wav`,
        `energy/${LABEL}-P0${n}.json`,
        `sessions/${LABEL}-P0${n}.json`,
      ]),
      `sessions-raw/${LABEL}.json`,
    ]);
    for (const [i, f] of fx.files.entries()) {
      const stored = await getBytes(store, paths.stereo(`${LABEL}-P0${i + 1}`));
      expect(sha(stored!)).toBe(sha(f.bytes));
    }
    const p2 = (await getJson<SessionRecord>(store, paths.session(`${LABEL}-P02`)))!;
    expect(p2.captureMode).toBe("file-import");
    expect(p2.participantIds).toEqual({ A: "S04", B: "S03" });
    expect(p2.excluded?.reason).toBe("consent");
    expect(p2.source).toMatchObject({
      mode: "pair-file",
      fileName: `${LABEL}.02.Audio 1.wav`,
      track: "Audio 1",
      fileSha256: sha(fx.files[1].bytes),
    });
    const p1 = (await getJson<SessionRecord>(store, paths.session(`${LABEL}-P01`)))!;
    expect(p1.passes["2"]).toBeDefined();

    expect(lines.map(formatPairLine)).toEqual([
      `${LABEL}.01.Audio 2.wav | left S01 | right S02 | upload: uploaded | pass two: done`,
      `${LABEL}.02.Audio 1.wav | left S04 | right S03 | upload: uploaded | pass two: skipped, excluded: consent`,
      `${LABEL}.03.Audio 3.wav | left S05 | right S06 | upload: uploaded | pass two: done`,
    ]);
    // Names never reach the output.
    expect([...logs, ...lines.map(formatPairLine)].join("\n")).not.toContain("Secret Name");
  });

  it("skips pairs already uploaded with the same file hash, and says so", async () => {
    await putJson(store, paths.roster(EXAM), ROSTER);
    const fx = makePairFixture(LABEL);
    await importSessionFolder(args(fx), deps());
    const importRecord = await getBytes(store, paths.sessionImport(LABEL));
    uploads = [];

    const again = await importSessionFolder(args(fx), deps());
    expect(again.ok).toBe(true);
    expect(uploads).toEqual([]);
    expect(again.lines.map((l) => [l.upload, l.pass2])).toEqual([
      ["skipped, already uploaded with the same file hash", "skipped, already done"],
      ["skipped, already uploaded with the same file hash", "skipped, excluded: consent"],
      ["skipped, already uploaded with the same file hash", "skipped, already done"],
    ]);
    expect(await getBytes(store, paths.sessionImport(LABEL))).toEqual(importRecord);
    expect(logs).toContain(`Exam ${EXAM} exists: 5 minutes.`);
  });

  it("finishes an interrupted import on a re-run", async () => {
    await putJson(store, paths.roster(EXAM), ROSTER);
    const fx = makePairFixture(LABEL);
    const flaky = deps({
      upload: async (pathname, body, type) => {
        if (pathname.startsWith(`audio/${LABEL}-P03/`)) throw new Error("network down");
        await deps().upload(pathname, body, type);
      },
    });
    const first = await importSessionFolder(args(fx), flaky);
    expect(first.ok).toBe(false);
    expect(first.lines[2]).toMatchObject({
      upload: "failed: network down",
      pass2: "not run, the upload failed",
    });
    expect(await store.get(paths.sessionImport(LABEL))).toBeNull();

    uploads = [];
    const second = await importSessionFolder(args(fx), deps());
    expect(second.ok).toBe(true);
    expect(second.lines.map((l) => l.upload)).toEqual([
      "skipped, already uploaded with the same file hash",
      "skipped, already uploaded with the same file hash",
      "uploaded",
    ]);
    expect(uploads).toEqual([
      `audio/${LABEL}-P03/stereo.wav`,
      `energy/${LABEL}-P03.json`,
      `sessions/${LABEL}-P03.json`,
      `sessions-raw/${LABEL}.json`,
    ]);
    expect(second.lines[0].pass2).toBe("skipped, already done");
    expect(second.lines[2].pass2).toBe("done");
  });

  it("stops before uploading anything when the archive holds a different file for a pair", async () => {
    await putJson(store, paths.roster(EXAM), ROSTER);
    await importSessionFolder(args(), deps());
    uploads = [];
    const other = makePairFixture(LABEL, { pairFrames: [48000, 52800, 57600] });
    await expect(importSessionFolder(args(other), deps())).rejects.toThrow(
      `Pair 1 (${LABEL}-P01): the archive already holds a different file for this pair. Nothing was uploaded.`,
    );
    expect(uploads).toEqual([]);
    const rec = (await getJson<SessionRecord>(store, paths.session(`${LABEL}-P01`)))!;
    expect((rec.source as PairFileSource).fileSha256).not.toBe(sha(other.files[0].bytes));
  });

  it("stops on the page's blocks before it creates the exam", async () => {
    const fx = makePairFixture(LABEL);
    const extra = { name: `${LABEL}.04.Audio 4.wav`, blob: blobOf(fx.files[0].bytes) };
    const missing = args(fx).wavs.slice(1);
    await expect(
      importSessionFolder(args(fx, { wavs: [...args(fx).wavs, extra] }), deps()),
    ).rejects.toThrow(`The chosen file ${LABEL}.04.Audio 4.wav matches no manifest row.`);
    await expect(importSessionFolder(args(fx, { wavs: missing }), deps())).rejects.toThrow(
      `Manifest row 3 names ${LABEL}.03.Audio 3.wav, and no chosen file has that name.`,
    );
    expect(await store.get(paths.exam(EXAM))).toBeNull();
    expect(uploads).toEqual([]);
  });

  it("needs a title and a duration to create a missing exam", async () => {
    const e = await importSessionFolder(
      args(undefined, { title: undefined, durationMin: undefined }),
      deps(),
    ).catch((x) => x);
    expect(e).toBeInstanceOf(FolderImportStop);
    expect(e.message).toBe(
      `The archive has no exam ${EXAM}. Pass --title and --duration-min to create it.`,
    );
    expect(uploads).toEqual([]);
  });

  it("refuses an uploader whose store lacks the app's exam", async () => {
    await expect(
      importSessionFolder(args(), deps({ uploaderHas: async () => false })),
    ).rejects.toThrow("The upload credentials point at a different store");
    expect(uploads).toEqual([]);
  });

  it("imports without a roster and marks every pair excluded, as the page does", async () => {
    const { lines } = await importSessionFolder(args(), deps());
    expect(lines.every((l) => l.pass2 === "skipped, excluded: consent")).toBe(true);
    expect(logs).toContain(
      `Exam ${EXAM} has no roster, so every pair counts as unknown consent and goes in excluded.`,
    );
  });
});
