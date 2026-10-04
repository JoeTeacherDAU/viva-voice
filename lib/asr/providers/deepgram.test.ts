import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "@/lib/analysis/pipeline";
import type { Baseline, EnergyTrack, SessionRecord, Word } from "@/lib/analysis/types";
import { pcmDurationMs, SessionClock } from "../clock";
import type { TranscriberEvent } from "../types";
import {
  buildListenUrl,
  DeepgramTranscriber,
  RECONNECT_DELAYS_MS,
  type SocketLike,
} from "./deepgram";

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = "blob";
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: (string | ArrayBuffer)[] = [];
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data === "string" && JSON.parse(data).type === "CloseStream") {
      queueMicrotask(() => this.serverClose(1000));
    }
  }
  close(code = 1000) {
    this.serverClose(code);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get jsonSent() {
    return this.sent
      .filter((d): d is string => typeof d === "string")
      .map((d) => JSON.parse(d).type);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  let tokenCount = 0;
  const t = new DeepgramTranscriber({
    getToken: async () => `jwt-${++tokenCount}`,
    socketFactory: (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      return s;
    },
  });
  const words: Word[] = [];
  const events: TranscriberEvent[] = [];
  t.onWords((w) => words.push(...w));
  t.onEvent((e) => events.push(e));
  return { t, sockets, words, events, tokens: () => tokenCount };
}

// Drains pending promise callbacks without touching timers, so fake timers stay usable.
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const chunk100ms = () => new ArrayBuffer(6400); // 1600 frames x 2 ch x 2 bytes

async function connected() {
  const ctx = setup();
  const p = ctx.t.connect({ channelMap: { "0": "A", "1": "B" }, keyterms: ["Busan", "used to"] });
  await flush();
  ctx.sockets[0].open();
  await p;
  return ctx;
}

const root = join(__dirname, "..", "..", "..", "fixtures");
const stream = JSON.parse(readFileSync(join(root, "deepgram/balanced-stream.json"), "utf8")) as ({
  _atMs: number;
} & Record<string, unknown>)[];

describe("listen URL", () => {
  it("carries the PLAN.md 6.1 query with one keyterm per term", () => {
    const u = new URL(buildListenUrl(["Busan", "used to", " "]));
    expect(u.origin + u.pathname).toBe("wss://api.deepgram.com/v1/listen");
    const p = u.searchParams;
    expect(Object.fromEntries([...p].filter(([k]) => k !== "keyterm"))).toEqual({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "2",
      multichannel: "true",
      interim_results: "true",
      punctuate: "true",
      filler_words: "true",
      vad_events: "true",
      utterance_end_ms: "1000",
      endpointing: "300",
    });
    expect(p.getAll("keyterm")).toEqual(["Busan", "used to"]);
    expect(p.has("smart_format")).toBe(false);
    expect(p.has("diarize")).toBe(false);
  });
});

describe("session clock", () => {
  it("offsets each connection and reports the gap after a drop", () => {
    const c = new SessionClock();
    expect(c.advance(100, true)).toBeNull();
    expect(c.rebase(0.05)).toBe(50);
    c.advance(100, true);
    c.drop();
    c.advance(100, false);
    c.advance(100, false);
    expect(c.advance(100, true)).toEqual({ startMs: 200, endMs: 400 });
    expect(c.connectionOffsetMs).toBe(400);
    expect(c.rebase(0.05)).toBe(450);
    expect(pcmDurationMs(6400)).toBe(100);
  });
});

describe("DeepgramTranscriber", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("opens with the bearer subprotocol and a fresh grant", async () => {
    const { sockets, events, t } = await connected();
    expect(sockets[0].protocols).toEqual(["bearer", "jwt-1"]);
    expect(t.state).toBe("open");
    expect(events.map((e) => e.type)).toEqual(["open"]);
  });

  it("replays the fixture stream into words the pipeline turns into the golden pass-one values", async () => {
    const { sockets, words, events, t } = await connected();
    for (const m of stream) {
      const { _atMs, ...msg } = m;
      void _atMs;
      sockets[0].deliver(msg);
    }
    expect(words.some((w) => !w.isFinal)).toBe(true);
    const finals = words.filter((w) => w.isFinal);
    const fixture = JSON.parse(
      readFileSync(join(root, "golden/balanced/words.json"), "utf8"),
    ) as Word[];
    expect(finals).toHaveLength(fixture.length);
    expect(new Set(finals.map((w) => w.channel))).toEqual(new Set([0, 1]));
    expect(
      finals.every((w) => w.speakerLabel === (w.channel === 0 ? "A" : "B") && w.pass === 1),
    ).toBe(true);
    expect(events.filter((e) => e.type === "utterance_end").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "speech_started").length).toBeGreaterThan(0);

    const session = JSON.parse(
      readFileSync(join(root, "golden/balanced/session.json"), "utf8"),
    ) as SessionRecord;
    const energy = JSON.parse(
      readFileSync(join(root, "golden/balanced/energy.json"), "utf8"),
    ) as EnergyTrack;
    const baseline = JSON.parse(
      readFileSync(join(root, "golden/balanced/baseline.json"), "utf8"),
    ) as Baseline;
    const expected = JSON.parse(readFileSync(join(root, "golden/balanced/expected.json"), "utf8"))
      .values as {
      featureId: string;
      participant: string;
      pass: number;
      thresholdMs: number | null;
      value: number | null;
    }[];
    const r = run(finals, energy, session.config, baseline, {
      pass: 1,
      markers: session.markers as { startMs: number; stopMs: number },
      rolling: false,
    });
    for (const e of expected.filter((x) => x.pass === 1)) {
      const got = r.features.find(
        (f) =>
          f.featureId === e.featureId &&
          f.participant === e.participant &&
          f.thresholdMs === e.thresholdMs,
      );
      if (e.value === null) expect(got?.value, e.featureId).toBeNull();
      else expect(got?.value, e.featureId).toBeCloseTo(e.value, 6);
    }
    await t.close();
  });

  it("sends audio while open, KeepAlive every 5 s, and CloseStream on close", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { sockets, t } = await connected();
    t.sendFrames(chunk100ms());
    vi.advanceTimersByTime(5000);
    expect(sockets[0].sent.filter((d) => d instanceof ArrayBuffer)).toHaveLength(1);
    expect(sockets[0].jsonSent).toEqual(["KeepAlive"]);
    await t.close();
    expect(sockets[0].jsonSent).toEqual(["KeepAlive", "CloseStream"]);
    expect(t.state).toBe("closed");
  });

  it("reconnects with backoff and a fresh grant, then rebases and reports the gap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sockets, events, words, t, tokens } = await connected();
    t.sendFrames(chunk100ms()); // session 0-100 ms on connection 1
    t.sendFrames(chunk100ms()); // 100-200 ms
    sockets[0].serverClose(1006);
    expect(t.state).toBe("reconnecting");
    t.sendFrames(chunk100ms()); // 200-300 ms, dropped
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await flush();
    expect(sockets).toHaveLength(2);
    expect(sockets[1].protocols).toEqual(["bearer", "jwt-2"]);
    expect(tokens()).toBe(2);
    sockets[1].open();
    t.sendFrames(chunk100ms()); // 300-400 ms, first chunk on connection 2
    const gap = events.find((e) => e.type === "gap");
    expect(gap?.detail).toEqual({ startMs: 200, endMs: 300 });
    expect(events.map((e) => e.type)).toEqual([
      "open",
      "error",
      "reconnecting",
      "reconnected",
      "gap",
    ]);
    sockets[1].deliver({
      type: "Results",
      channel_index: [1, 2],
      is_final: true,
      speech_final: false,
      start: 0,
      duration: 0.1,
      channel: {
        alternatives: [
          {
            transcript: "yes",
            confidence: 0.9,
            words: [{ word: "yes", start: 0.02, end: 0.08, confidence: 0.9 }],
          },
        ],
      },
    });
    expect(words.at(-1)).toMatchObject({
      word: "yes",
      startMs: 320,
      endMs: 380,
      channel: 1,
      speakerLabel: "B",
    });
    await t.close();
  });

  it("gives up after five failed reconnects and reports the fault", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sockets, events, t } = await connected();
    sockets[0].serverClose(1006);
    for (let i = 0; i < RECONNECT_DELAYS_MS.length; i++) {
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[i]);
      await flush();
      sockets.at(-1)!.serverClose(1011); // fails before opening
      await flush();
    }
    expect(t.state).toBe("failed");
    expect(sockets).toHaveLength(1 + RECONNECT_DELAYS_MS.length);
    expect(
      events
        .filter((e) => e.type === "reconnecting")
        .map((e) => (e.detail as { delay: number }).delay),
    ).toEqual(RECONNECT_DELAYS_MS);
    expect(events.at(-1)).toMatchObject({ type: "error", detail: { fatal: true } });
  });

  it("passes every text message through verbatim with the connection's offset", async () => {
    const { sockets, t } = await connected();
    const raws: { connectionOffsetMs: number | null; data: string }[] = [];
    t.onRaw((m) => raws.push(m));
    t.sendFrames(chunk100ms());
    const exact =
      '{"type":"Results","channel_index":[0,2],"is_final":false,"speech_final":false,"start":0,"duration":0,"channel":{"alternatives":[{"transcript":"","confidence":0,"words":[]}]}}';
    sockets[0].onmessage?.({ data: exact });
    sockets[0].onmessage?.({ data: "{not json" });
    sockets[0].onmessage?.({ data: new ArrayBuffer(2) });
    expect(raws.map((r) => r.data)).toEqual([exact, "{not json"]);
    expect(raws[0].connectionOffsetMs).toBe(0);
  });

  it("ignores binary frames, junk JSON, and results without words", async () => {
    const { sockets, words } = await connected();
    sockets[0].onmessage?.({ data: new ArrayBuffer(4) });
    sockets[0].onmessage?.({ data: "{not json" });
    sockets[0].deliver({
      type: "Results",
      channel_index: [0, 2],
      is_final: false,
      speech_final: false,
      start: 0,
      duration: 0,
      channel: { alternatives: [{ transcript: "", confidence: 0, words: [] }] },
    });
    expect(words).toHaveLength(0);
  });

  it("rejects connect when the first socket never opens", async () => {
    const ctx = setup();
    const p = ctx.t.connect({ channelMap: { "0": "A", "1": "B" } });
    await flush();
    ctx.sockets[0].onerror?.({});
    await expect(p).rejects.toThrow(/failed to open/);
  });
});
