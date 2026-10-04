import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "@/lib/analysis/pipeline";
import type { EnergyTrack, FeatureValue, SessionRecord, Word } from "@/lib/analysis/types";
import { COOKIE_NAME, signSession } from "@/lib/auth";
import { MockBatch } from "@/lib/asr/batch";
import { paths } from "@/lib/storage/paths";
import { getJson, MemoryStore, putJson, setStore } from "@/lib/storage/store";
import { runPass2, type MeasurementsFile, type TranscriptFile } from "./pass2";
import { diffFeatures, replicate } from "./replicate";

const fx = join(__dirname, "..", "..", "fixtures", "golden", "balanced");
const load = <T>(f: string) => JSON.parse(readFileSync(join(fx, f), "utf8")) as T;
const session = load<SessionRecord>("session.json");
const words = load<Word[]>("words.json");
const energy = load<EnergyTrack>("energy.json");

async function seeded() {
  const store = new MemoryStore();
  const p1 = run(words, energy, session.config, load("baseline.json"), {
    pass: 1,
    markers: session.markers as { startMs: number; stopMs: number },
  });
  await putJson(store, paths.session(session.id), session);
  await store.put(paths.stereo(session.id), new Uint8Array(8), "audio/wav");
  await putJson(store, paths.energy(session.id), energy);
  await putJson(store, paths.baseline(session.examId), load("baseline.json"));
  await putJson(store, paths.measurements(session.id, 1), {
    pipelineVersion: "1.0.0",
    pass: 1,
    features: p1.features,
  });
  return store;
}

describe("replication", () => {
  it("diffs feature lists by key and tolerance", () => {
    const f = (value: number | null, featureId = "x"): FeatureValue => ({
      featureId,
      participant: "A",
      pass: 2,
      window: "full",
      thresholdMs: null,
      value,
      unit: "u",
    });
    expect(diffFeatures([f(1)], [f(1 + 1e-12)])).toEqual([]);
    expect(diffFeatures([f(1)], [f(2)])).toHaveLength(1);
    expect(diffFeatures([f(null)], [f(null)])).toEqual([]);
    expect(diffFeatures([f(null)], [f(0)])).toHaveLength(1);
    expect(diffFeatures([f(1)], [f(1, "y")])).toHaveLength(2);
  });

  it("reproduces stored pass-two measurements with zero differences", async () => {
    const store = await seeded();
    await runPass2(store, session.id, new MockBatch(async () => words));
    const rec = (await getJson<SessionRecord>(store, paths.session(session.id)))!;
    const t = (await getJson<TranscriptFile>(store, paths.transcript(session.id, 2)))!;
    const m2 = (await getJson<MeasurementsFile>(store, paths.measurements(session.id, 2)))!;
    const m1 = (await getJson<MeasurementsFile>(store, paths.measurements(session.id, 1)))!;
    expect(m2.baseline?.n).toBe(12);
    const fresh = replicate({
      record: rec,
      words: t.words,
      energy,
      baseline: m2.baseline ?? null,
      pass1: m1.features,
    });
    expect(diffFeatures(m2.features, fresh)).toEqual([]);
    // Using today's baseline (which now includes this session) would differ on the composite.
    const today = await getJson<typeof m2.baseline>(store, paths.baseline(session.examId));
    const drift = diffFeatures(
      m2.features,
      replicate({
        record: rec,
        words: t.words,
        energy,
        baseline: today ?? null,
        pass1: m1.features,
      }),
    );
    expect(drift.every((d) => d.featureId === "composite_fluency_index")).toBe(true);
  });

  it("files a robustness check separately and leaves the record of account alone", async () => {
    const store = await seeded();
    await runPass2(store, session.id, new MockBatch(async () => words));
    const before = await getJson<MeasurementsFile>(store, paths.measurements(session.id, 2));
    const baselineBefore = await getJson(store, paths.baseline(session.examId));
    const shifted = words.map((w) => (w.channel === 1 ? { ...w, confidence: 0.5 } : w));
    const r = await runPass2(store, session.id, new MockBatch(async () => shifted), {
      robustness: true,
    });
    expect(r.measurementsPath).toMatch(/^measurements\/fixture-balanced\/robustness-.*\.json$/);
    expect(await getJson(store, paths.measurements(session.id, 2))).toEqual(before);
    expect(await getJson(store, paths.baseline(session.examId))).toEqual(baselineBefore);
    const check = await getJson<MeasurementsFile>(store, r.measurementsPath);
    expect(check!.label).toBe("robustness check");
    const diffs = diffFeatures(before!.features, check!.features);
    expect(diffs.some((d) => d.featureId === "mean_word_confidence" && d.participant === "B")).toBe(
      true,
    );
    expect(r.record.state).toBe("done");
    expect(r.record.events.at(-1)!.type).toBe("robustness_check");
  });
});

describe("exam and roster import", () => {
  const SECRET = "exam-test-secret-0123456789abcdef";
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
    setStore(store);
    process.env.VIVA_SESSION_SECRET = SECRET;
  });
  afterEach(() => setStore(undefined));
  const authed = async (url: string, init: RequestInit = {}) =>
    new Request(url, {
      ...init,
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(await signSession(SECRET))}` },
    });

  const exam = load<object>("../../exams/demo-exam.json");

  it("validates and stores an exam record, then exports it", async () => {
    const { GET, POST } = await import("@/app/api/exam/route");
    expect(
      (
        await POST(
          await authed("http://x/api/exam", { method: "POST", body: JSON.stringify(exam) }),
        )
      ).status,
    ).toBe(200);
    expect(await getJson(store, paths.exam("demo-exam"))).toEqual(exam);
    const bad = { ...exam, durationMs: 5 };
    expect(
      (await POST(await authed("http://x/api/exam", { method: "POST", body: JSON.stringify(bad) })))
        .status,
    ).toBe(422);
    expect(
      (await POST(await authed("http://x/api/exam", { method: "POST", body: "nope" }))).status,
    ).toBe(400);
    const got = await GET(await authed("http://x/api/exam?examId=demo-exam"));
    expect(got.headers.get("content-disposition")).toContain("demo-exam.json");
    expect(await got.json()).toEqual(exam);
    expect((await GET(await authed("http://x/api/exam?examId=missing"))).status).toBe(404);
  });

  it("validates and stores a roster", async () => {
    const { POST } = await import("@/app/api/roster/route");
    const roster = [{ name: "N", participantId: "P1", consentStatus: "granted" }];
    const post = async (body: unknown, examId = "demo-exam") =>
      POST(
        await authed(`http://x/api/roster?examId=${examId}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    expect((await post(roster)).status).toBe(200);
    expect(await getJson(store, paths.roster("demo-exam"))).toEqual(roster);
    expect((await post([...roster, roster[0]])).status).toBe(422);
    expect((await post([{ name: "N", participantId: "P1", consentStatus: "maybe" }])).status).toBe(
      422,
    );
    expect((await post(roster, "../x")).status).toBe(400);
  });
});
