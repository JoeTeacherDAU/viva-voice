import { afterEach, describe, expect, it } from "vitest";
import { createTranscriber, DeepgramTranscriber, MockTranscriber } from ".";

describe("createTranscriber", () => {
  const saved = process.env.VIVA_MOCK_ASR;
  afterEach(() => {
    if (saved === undefined) delete process.env.VIVA_MOCK_ASR;
    else process.env.VIVA_MOCK_ASR = saved;
  });
  it("returns the mock when VIVA_MOCK_ASR=1", () => {
    process.env.VIVA_MOCK_ASR = "1";
    expect(createTranscriber()).toBeInstanceOf(MockTranscriber);
  });
  it("returns the Deepgram adapter otherwise", () => {
    delete process.env.VIVA_MOCK_ASR;
    expect(createTranscriber()).toBeInstanceOf(DeepgramTranscriber);
  });
});
