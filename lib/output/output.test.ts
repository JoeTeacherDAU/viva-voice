import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "@/lib/analysis/pipeline";
import type {
  Baseline,
  EnergyTrack,
  FeatureValue,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";
import { COOKIE_NAME, signSession } from "@/lib/auth";
import { batchQuery, parseBatchResponse } from "@/lib/asr/batch";
import { byTier } from "@/lib/registry";
import { paths, uploadPathAllowed } from "@/lib/storage/paths";
import { getBytes, getJson, MemoryStore, putJson, setStore } from "@/lib/storage/store";
import { buildBundle } from "./bundle";
import {
  LONG_HEADER,
  longRows,
  mergeCsv,
  parseCsv,
  toCsv,
  wideHeader,
  wideRows,
  WIDE_META,
} from "./csv";
import { featureLabel, formatValue } from "./format";
import { deleteAfter, runRetention } from "./retention";
import { buildStudentDoc } from "./studentDoc";

const fx = join(__dirname, "..", "..", "fixtures", "golden", "balanced");
const load = <T>(f: string) => JSON.parse(readFileSync(join(fx, f), "utf8")) as T;
const session = load<SessionRecord>("session.json");
const words = load<Word[]>("words.json");
const energy = load<EnergyTrack>("energy.json");
const baseline = load<Baseline>("baseline.json");
const markers = session.markers as { startMs: number; stopMs: number };

function passes() {
  const p1 = run(words, energy, session.config, baseline, { pass: 1, markers });
  const p2 = run(words, energy, session.config, baseline, {
    pass: 2,
    markers,
    previousPass: p1.features,
  });
  return { p1, p2 };
}

function docText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const xml = strFromU8(files["word/document.xml"]);
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'");
}

const SECRET = "output-test-secret-0123456789abcd";
async function authed(url: string, init: RequestInit = {}) {
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(await signSession(SECRET))}`;
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie },
  });
}

describe("student document", () => {
  it("contains every tier 1 label once, this student's values, and no partner value or instructor score", async () => {
    const { p1, p2 } = passes();
    const rec = { ...session, instructorLiveScore: { value: 4, atMs: 5000 } };
    const doc = await buildStudentDoc({
      record: rec,
      student: "A",
      course: "Demo course",
      unit: "Unit 3",
      words: p2.words,
      pass1: p1.features,
      pass2: p2.features,
      removedSpans: p2.removedSpans,
      unattributedRatio: p2.quality.unattributedRatio,
    });
    const text = docText(doc);
    for (const f of byTier(1)) {
      const needle = `${featureLabel(f.id)} (${f.unit}):`;
      expect(text.split(needle).length - 1, needle).toBe(1);
    }
    // A's own speech rate appears; B's distinctive values do not.
    const val = (fs: FeatureValue[], id: string, P: string, t: number | null) =>
      fs.find(
        (v) =>
          v.featureId === id && v.participant === P && v.window === "full" && v.thresholdMs === t,
      )?.value;
    expect(text).toContain(`pass 2 ${formatValue(val(p2.features, "speech_rate_wpm", "A", null))}`);
    const aValues = new Set(
      p2.features.filter((v) => v.participant === "A").map((v) => formatValue(v.value)),
    );
    let checked = 0;
    for (const v of p2.features.filter(
      (x) => x.participant === "B" && x.window === "full" && x.value !== null,
    )) {
      const s = formatValue(v.value);
      if (s.length < 4 || aValues.has(s) || !s.includes(".")) continue;
      expect(text, `${v.featureId} for B leaked`).not.toContain(s);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(text).not.toContain(session.participantIds.B);
    expect(text.toLowerCase()).not.toMatch(/instructor|live score/);
    // Transcript: speaker labels with timestamps and the removed cross-talk marker.
    expect(text).toMatch(/A 00:00 {2}So,/);
    expect(text).toContain("cross-talk removed from B's microphone");
    expect(text).toContain("Pipeline version: 1.0.0");
  });

  it("formats labels and values", () => {
    expect(featureLabel("mattr")).toBe("MATTR");
    expect(featureLabel("speech_rate_wpm")).toBe("Speech rate WPM");
    expect(formatValue(null)).toBe("not computed");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(0.00301)).toBe("0.00301");
    expect(formatValue(97.123)).toBe("97.12");
  });
});

describe("cohort CSVs", () => {
  it("has wide columns equal to the registry tier 1 ids plus metadata", () => {
    const { p1, p2 } = passes();
    expect(wideHeader()).toEqual([...WIDE_META, ...byTier(1).map((f) => f.id)]);
    const rows = wideRows(session, p2.features, 2, "1.0.0");
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(0, 5)).toEqual([session.examId, session.id, "FIX-A", 2, "1.0.0"]);
    const csv = parseCsv(toCsv(wideHeader(), rows));
    const sr = csv[0].indexOf("speech_rate_wpm");
    expect(Number(csv[1][sr])).toBeCloseTo(97);
    const long = parseCsv(
      toCsv(LONG_HEADER, longRows(session, [...p1.features, ...p2.features], "1.0.0")),
    );
    expect(long[0]).toEqual([...LONG_HEADER]);
    expect(long.length - 1).toBe(p1.features.length + p2.features.length);
    expect(long.some((r) => r[5].startsWith("roll10:"))).toBe(true);
  });

  it("replaces a session's earlier rows when it appends", () => {
    const first = mergeCsv(null, ["examId", "sessionId", "v"], "s1", [["e", "s1", 1]]);
    const second = mergeCsv(first, ["examId", "sessionId", "v"], "s2", [["e", "s2", "a,b"]]);
    const third = mergeCsv(second, ["examId", "sessionId", "v"], "s1", [["e", "s1", 3]]);
    expect(parseCsv(third)).toEqual([
      ["examId", "sessionId", "v"],
      ["e", "s2", "a,b"],
      ["e", "s1", "3"],
    ]);
  });
});

describe("bundle and paths", () => {
  it("zips the evidence files", () => {
    const zip = buildBundle({
      "A.docx": new Uint8Array([1, 2]),
      "session.json": new TextEncoder().encode("{}"),
    });
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(["A.docx", "session.json"]);
  });
  it("allows uploads only under the session prefixes", () => {
    expect(uploadPathAllowed("audio/s1/stereo.wav")).toBe(true);
    expect(uploadPathAllowed("energy/s1.json")).toBe(true);
    expect(uploadPathAllowed("transcripts/s1/pass1.json")).toBe(true);
    expect(uploadPathAllowed("measurements/s1/pass1.json")).toBe(true);
    expect(uploadPathAllowed("sessions/s1.json")).toBe(true);
    expect(uploadPathAllowed("roster/e1.json")).toBe(false);
    expect(uploadPathAllowed("transcripts/s1/pass2.json")).toBe(false);
    expect(uploadPathAllowed("audio/../roster/x.wav")).toBe(false);
    expect(uploadPathAllowed("baselines/e1.json")).toBe(false);
    expect(() => paths.session("../x")).toThrow();
  });
});

describe("routes with the in-memory store", () => {
  let store: MemoryStore;
  // CI sets VIVA_MOCK_ASR=1 for the whole job; each test here decides for itself.
  const savedMock = process.env.VIVA_MOCK_ASR;
  beforeEach(() => {
    store = new MemoryStore();
    setStore(store);
    process.env.VIVA_SESSION_SECRET = SECRET;
    delete process.env.VIVA_MOCK_ASR;
  });
  afterEach(() => {
    setStore(undefined);
    vi.unstubAllGlobals();
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.CRON_SECRET;
    if (savedMock === undefined) delete process.env.VIVA_MOCK_ASR;
    else process.env.VIVA_MOCK_ASR = savedMock;
  });

  async function seed() {
    const { p1 } = passes();
    await putJson(store, paths.session(session.id), session);
    await store.put(paths.stereo(session.id), readFileSync(join(fx, "stereo.wav")), "audio/wav");
    await putJson(store, paths.energy(session.id), energy);
    await putJson(store, paths.transcript(session.id, 1), { words });
    await putJson(store, paths.measurements(session.id, 1), {
      pipelineVersion: "1.0.0",
      pass: 1,
      features: p1.features,
    });
  }

  it("pass two transcribes with Deepgram, writes every output, and marks the session done", async () => {
    await seed();
    await putJson(store, paths.baseline(session.examId), baseline);
    process.env.DEEPGRAM_API_KEY = "dg-test";
    const channels = [0, 1].map((ch) => ({
      alternatives: [
        {
          words: words
            .filter((w) => w.channel === ch)
            .map((w) => ({
              word: w.word,
              punctuated_word: w.punctuatedWord,
              start: w.startMs / 1000,
              end: w.endMs / 1000,
              confidence: w.confidence,
            })),
        },
      ],
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        metadata: { model_info: { x: { name: "nova-3", version: "2026-09" } } },
        results: { channels },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/pass2/route");
    const res = await POST(
      await authed("http://x/api/pass2", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.deepgram.com/v1/listen?${batchQuery()}`);
    expect(JSON.parse(init.body).url).toBe(`memory://${paths.stereo(session.id)}`);

    const rec = await getJson<SessionRecord>(store, paths.session(session.id));
    expect(rec!.state).toBe("done");
    expect(rec!.passes["2"]!.measurements).toBe(paths.measurements(session.id, 2));
    expect(rec!.deepgramModel).toBe("nova-3 2026-09");
    const m2 = await getJson<{ features: FeatureValue[] }>(
      store,
      paths.measurements(session.id, 2),
    );
    const expected = load<{
      values: {
        featureId: string;
        participant: string;
        pass: number;
        thresholdMs: number | null;
        value: number | null;
      }[];
    }>("expected.json").values.filter((v) => v.pass === 2);
    for (const e of expected) {
      const got = m2!.features.find(
        (f) =>
          f.featureId === e.featureId &&
          f.participant === e.participant &&
          f.window === "full" &&
          f.thresholdMs === e.thresholdMs,
      );
      if (e.value === null) expect(got?.value, e.featureId).toBeNull();
      else expect(got?.value, e.featureId).toBeCloseTo(e.value, 6);
    }
    expect(await getBytes(store, paths.document(session.id, "A"))).not.toBeNull();
    expect(await getBytes(store, paths.document(session.id, "B"))).not.toBeNull();
    const b = await getJson<Baseline>(store, paths.baseline(session.examId));
    expect(b!.n).toBe(13);
    expect(b!.sessions).toEqual([session.id]);
    expect(await getJson(store, paths.instructor(session.examId))).toEqual({
      sessions: {
        [session.id]: { participantIds: session.participantIds, instructorLiveScore: null },
      },
    });
    const long = parseCsv(
      new TextDecoder().decode((await getBytes(store, paths.long(session.examId)))!),
    );
    expect(long.slice(1).every((r) => r[1] === session.id)).toBe(true);
    expect(new Set(long.slice(1).map((r) => r[3]))).toEqual(new Set(["1", "2"]));

    // A second run replaces rather than duplicates.
    await POST(
      await authed("http://x/api/pass2", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
    const long2 = parseCsv(
      new TextDecoder().decode((await getBytes(store, paths.long(session.examId)))!),
    );
    expect(long2.length).toBe(long.length);
    expect((await getJson<Baseline>(store, paths.baseline(session.examId)))!.n).toBe(13);

    const { GET } = await import("@/app/api/export/route");
    const exp = await GET(await authed(`http://x/api/export?examId=${session.examId}&format=wide`));
    expect(parseCsv(await exp.text())).toHaveLength(3);
  });

  it("pass two reports missing sessions, missing audio, and a bad body", async () => {
    process.env.VIVA_MOCK_ASR = "1";
    const { POST } = await import("@/app/api/pass2/route");
    const call = (body: string) => authed("http://x/api/pass2", { method: "POST", body });
    expect((await POST(await call("{}"))).status).toBe(400);
    expect((await POST(await call(JSON.stringify({ sessionId: "nope" })))).status).toBe(404);
    await putJson(store, paths.session(session.id), session);
    expect((await POST(await call(JSON.stringify({ sessionId: session.id })))).status).toBe(404);
    expect(
      (await POST(new Request("http://x/api/pass2", { method: "POST", body: "{}" }))).status,
    ).toBe(401);
  });

  it("pass two with the mock transcriber reuses the pass-one words", async () => {
    await seed();
    process.env.VIVA_MOCK_ASR = "1";
    const { POST } = await import("@/app/api/pass2/route");
    const res = await POST(
      await authed("http://x/api/pass2", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
    expect(res.status).toBe(200);
    const t2 = await getJson<{ words: Word[]; model: string }>(
      store,
      paths.transcript(session.id, 2),
    );
    expect(t2!.model).toBe("mock");
    expect(t2!.words).toHaveLength(words.length);
  });

  it("upload accepts allowed paths into the memory store and rejects the rest", async () => {
    const { GET, PUT } = await import("@/app/api/upload/route");
    expect(await (await GET(await authed("http://x/api/upload"))).json()).toEqual({
      mode: "memory",
    });
    const put = (p: string, type: string, body = "{}") =>
      authed(`http://x/api/upload?pathname=${encodeURIComponent(p)}`, {
        method: "PUT",
        body,
        headers: { "content-type": type },
      });
    expect((await PUT(await put("sessions/s9.json", "application/json"))).status).toBe(200);
    expect(await getJson(store, "sessions/s9.json")).toEqual({});
    expect((await PUT(await put("roster/e1.json", "application/json"))).status).toBe(400);
    expect((await PUT(await put("sessions/s9.json", "text/plain"))).status).toBe(415);
    const short = await authed("http://x/api/upload?pathname=sessions/s9.json", {
      method: "PUT",
      body: "{}",
      headers: { "content-type": "application/json", "content-length": "99" },
    });
    expect((await PUT(short)).status).toBe(400);
    expect(
      (
        await PUT(
          new Request("http://x/api/upload?pathname=sessions/s9.json", {
            method: "PUT",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("file streams small objects, redirects large ones when presigning works, and guards access", async () => {
    const { GET, STREAM_LIMIT_BYTES } = await import("@/app/api/file/route");
    await putJson(store, "sessions/s1.json", { ok: true });
    const ok = await GET(await authed("http://x/api/file?pathname=sessions/s1.json"));
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await ok.json()).toEqual({ ok: true });
    expect((await GET(await authed("http://x/api/file?pathname=nope.json"))).status).toBe(404);
    expect((await GET(await authed("http://x/api/file?pathname=../etc"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/file?pathname=sessions/s1.json"))).status).toBe(
      401,
    );
    await store.put("audio/s1/stereo.wav", new Uint8Array(STREAM_LIMIT_BYTES + 1), "audio/wav");
    vi.spyOn(store, "presignGet").mockResolvedValue("https://blob.example/signed");
    const big = await GET(await authed("http://x/api/file?pathname=audio/s1/stereo.wav"));
    expect(big.status).toBe(307);
    expect(big.headers.get("location")).toBe("https://blob.example/signed");
  });

  it("bundle zips the stored evidence", async () => {
    await seed();
    const { GET } = await import("@/app/api/bundle/route");
    const res = await GET(await authed(`http://x/api/bundle?sessionId=${session.id}`));
    // The fixture WAV exceeds the stream limit; the memory store cannot presign, so it streams.
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "energy.json",
      "session.json",
      "stereo.wav",
      "transcript-pass1.json",
    ]);
    expect((await GET(await authed("http://x/api/bundle?sessionId=missing"))).status).toBe(404);
  });

  it("retention deletes audio, transcripts, documents, bundles, and the roster 24 months after term end", async () => {
    expect(deleteAfter("2024-02-29").toISOString().slice(0, 10)).toBe("2026-03-01");
    await putJson(store, paths.exam("old"), { termEnd: "2024-06-30" });
    await putJson(store, paths.exam("new"), { termEnd: "2026-06-30" });
    for (const [id, examId] of [
      ["s-old", "old"],
      ["s-new", "new"],
    ]) {
      await putJson(store, paths.session(id), { ...session, id, examId });
      await store.put(paths.stereo(id), new Uint8Array(4));
      await putJson(store, paths.transcript(id, 2), {});
      await putJson(store, paths.measurements(id, 2), {});
      await store.put(paths.document(id, "A"), new Uint8Array(2));
    }
    await putJson(store, paths.roster("old"), []);
    await putJson(store, paths.roster("new"), []);
    process.env.CRON_SECRET = "cron";
    const { GET } = await import("@/app/api/retention/route");
    expect((await GET(new Request("http://x/api/retention"))).status).toBe(401);
    vi.useFakeTimers({ now: new Date("2026-10-04T00:00:00Z"), toFake: ["Date"] });
    const res = await GET(
      new Request("http://x/api/retention", { headers: { authorization: "Bearer cron" } }),
    );
    vi.useRealTimers();
    expect((await res.json()).exams).toHaveLength(1);
    const left = (await store.list("")).map((o) => o.pathname);
    expect(left).not.toContain(paths.stereo("s-old"));
    expect(left).not.toContain(paths.transcript("s-old", 2));
    expect(left).not.toContain(paths.document("s-old", "A"));
    expect(left).not.toContain(paths.roster("old"));
    expect(left).toContain(paths.measurements("s-old", 2));
    expect(left).toContain(paths.session("s-old"));
    expect(left).toContain(paths.stereo("s-new"));
    expect(left).toContain(paths.roster("new"));
    const log = await getJson<{ examId: string; deleted: number }[]>(store, paths.retentionLog());
    expect(log).toEqual([expect.objectContaining({ examId: "old", deleted: 4 })]);
    expect(await runRetention(store, new Date("2026-10-04"))).toEqual([]);
  });

  it("parses a Deepgram batch response into pass-two words", () => {
    const w = parseBatchResponse(
      {
        results: {
          channels: [
            { alternatives: [{ words: [{ word: "hi", start: 1.2, end: 1.5, confidence: 0.9 }] }] },
            { alternatives: [{ words: [] }] },
          ],
        },
      },
      { "0": "B", "1": "A" },
    );
    expect(w).toEqual([
      expect.objectContaining({
        word: "hi",
        startMs: 1200,
        endMs: 1500,
        channel: 0,
        speakerLabel: "B",
        pass: 2,
      }),
    ]);
  });
});
