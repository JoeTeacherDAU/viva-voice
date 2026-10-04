import { afterEach, describe, expect, it } from "vitest";
import { createTranscriber, DeepgramTranscriber, MockTranscriber } from ".";

describe("createTranscriber", () => {
  afterEach(() => {
    delete process.env.VIVA_MOCK_ASR;
  });
  it("returns the mock when VIVA_MOCK_ASR=1", () => {
    process.env.VIVA_MOCK_ASR = "1";
    expect(createTranscriber()).toBeInstanceOf(MockTranscriber);
  });
  it("returns the Deepgram adapter otherwise", () => {
    expect(createTranscriber()).toBeInstanceOf(DeepgramTranscriber);
  });
});
