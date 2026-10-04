import type { Word } from "@/lib/analysis/types";
import balanced from "@/fixtures/golden/balanced/words.json";
import { MockTranscriber, type MockOptions } from "./providers/mock";
import type { Transcriber } from "./types";

export type { Transcriber, TranscriberConfig, TranscriberEvent } from "./types";
export { MockTranscriber } from "./providers/mock";

export function mockEnabled(): boolean {
  return process.env.VIVA_MOCK_ASR === "1";
}

/**
 * Returns the transcriber for this build. VIVA_MOCK_ASR=1 selects the mock,
 * which replays the balanced golden fixture. The Deepgram adapter arrives in P4.
 */
export function createTranscriber(opts: MockOptions & { words?: Word[] } = {}): Transcriber {
  if (mockEnabled()) {
    return new MockTranscriber(opts.words ?? (balanced as Word[]), { originMs: 1000, ...opts });
  }
  throw new Error("The Deepgram transcriber arrives in phase P4. Set VIVA_MOCK_ASR=1 for now.");
}
