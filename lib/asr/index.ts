import type { Word } from "@/lib/analysis/types";
import balanced from "@/fixtures/golden/balanced/words.json";
import { DeepgramTranscriber, fetchGrantToken, type DeepgramOptions } from "./providers/deepgram";
import { MockTranscriber, type MockOptions } from "./providers/mock";
import type { Transcriber } from "./types";

export type { Transcriber, TranscriberConfig, TranscriberEvent } from "./types";
export { MockTranscriber } from "./providers/mock";
export { DeepgramTranscriber } from "./providers/deepgram";

export function mockEnabled(): boolean {
  return process.env.VIVA_MOCK_ASR === "1";
}

/**
 * Returns the transcriber for this build. VIVA_MOCK_ASR=1 selects the mock,
 * which replays the balanced golden fixture; otherwise the live Deepgram
 * adapter, which fetches a fresh grant from /api/asr/grant per connection.
 */
export function createTranscriber(
  opts: MockOptions & { words?: Word[]; deepgram?: Partial<DeepgramOptions> } = {},
): Transcriber {
  if (mockEnabled()) {
    return new MockTranscriber(opts.words ?? (balanced as Word[]), { originMs: 1000, ...opts });
  }
  return new DeepgramTranscriber({ getToken: fetchGrantToken, ...opts.deepgram });
}
