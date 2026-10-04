import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SessionRecord, type Word } from "@/lib/analysis/types";
import { validateSession, validateWords } from "./validation";

const session: SessionRecord = {
  id: "s1",
  examId: "exam1",
  state: "setup",
  participantIds: { A: "P001", B: "P002" },
  channelMap: { "0": "A", "1": "B" },
  config: DEFAULT_CONFIG,
  markers: { startMs: null, stopMs: null },
  events: [],
  instructorLiveScore: null,
  passes: {},
  pipelineVersion: "1.0.0",
  deepgramModel: "nova-3",
  firmware: { tx: "unknown", rx: "unknown" },
  createdAt: "2026-10-04T12:00:00.000Z",
};

const word: Word = {
  word: "hello",
  punctuatedWord: "Hello,",
  startMs: 1000,
  endMs: 1300,
  confidence: 0.92,
  channel: 0,
  isFinal: true,
  pass: 1,
  removedAsCrosstalk: false,
  speakerLabel: "A",
};

describe("session schema", () => {
  it("accepts a minimal valid record and the default config", () => {
    expect(validateSession(session)).toEqual({ ok: true, errors: [] });
  });
  it("accepts a live score of 1 to 5 and rejects 0 and 6 (ruling R4)", () => {
    expect(validateSession({ ...session, instructorLiveScore: { value: 5, atMs: 10 } }).ok).toBe(
      true,
    );
    expect(validateSession({ ...session, instructorLiveScore: { value: 0, atMs: 10 } }).ok).toBe(
      false,
    );
    expect(validateSession({ ...session, instructorLiveScore: { value: 6, atMs: 10 } }).ok).toBe(
      false,
    );
  });
  it("rejects a missing config field and an unknown top-level field", () => {
    const { turnThresholdMs: _omit, ...partial } = DEFAULT_CONFIG;
    void _omit;
    expect(validateSession({ ...session, config: partial }).ok).toBe(false);
    expect(validateSession({ ...session, grade: "A" }).ok).toBe(false);
  });
});

describe("words schema", () => {
  it("accepts a valid word list", () => {
    expect(validateWords([word, { ...word, channel: 1, speakerLabel: "B" }]).ok).toBe(true);
  });
  it("rejects a bad channel, a bad pass, and a missing field", () => {
    expect(validateWords([{ ...word, channel: 2 }]).ok).toBe(false);
    expect(validateWords([{ ...word, pass: 3 }]).ok).toBe(false);
    const { confidence: _c, ...noConf } = word;
    void _c;
    expect(validateWords([noConf]).ok).toBe(false);
  });
});
