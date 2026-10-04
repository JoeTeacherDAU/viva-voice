import type { Participant, Word } from "@/lib/analysis/types";

export const BATCH_URL = "https://api.deepgram.com/v1/listen";
export const BATCH_MODEL = "nova-3";

/** The pass-two query from PLAN.md section 6.2. */
export function batchQuery(): string {
  return new URLSearchParams({
    model: BATCH_MODEL,
    multichannel: "true",
    punctuate: "true",
    filler_words: "true",
    utterances: "true",
    paragraphs: "true",
  }).toString();
}

export type ChannelMap = { "0": Participant; "1": Participant };

export interface BatchResult {
  /** Words in WAV time (ms from the first sample), pass 2, all final. */
  words: Word[];
  raw: unknown;
  model: string;
}

export interface BatchTranscriber {
  transcribe(audioUrl: string, channelMap: ChannelMap): Promise<BatchResult>;
}

interface DgBatch {
  metadata?: { model_info?: Record<string, { name?: string; version?: string }> };
  results?: {
    channels?: {
      alternatives?: {
        words?: {
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          confidence: number;
        }[];
      }[];
    }[];
  };
}

export function parseBatchResponse(json: DgBatch, channelMap: ChannelMap): Word[] {
  const out: Word[] = [];
  (json.results?.channels ?? []).forEach((c, i) => {
    const ch = (i === 0 ? 0 : 1) as 0 | 1;
    for (const w of c.alternatives?.[0]?.words ?? []) {
      out.push({
        word: w.word,
        punctuatedWord: w.punctuated_word ?? w.word,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        confidence: w.confidence,
        channel: ch,
        isFinal: true,
        pass: 2,
        removedAsCrosstalk: false,
        speakerLabel: channelMap[String(ch) as "0" | "1"],
      });
    }
  });
  return out.sort((a, b) => a.startMs - b.startMs || a.channel - b.channel);
}

/** Deepgram pre-recorded transcription of a presigned WAV URL. */
export class DeepgramBatch implements BatchTranscriber {
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audioUrl: string, channelMap: ChannelMap): Promise<BatchResult> {
    const res = await this.fetchImpl(`${BATCH_URL}?${batchQuery()}`, {
      method: "POST",
      headers: { Authorization: `Token ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: audioUrl }),
    });
    if (!res.ok) throw new Error(`Deepgram pre-recorded request returned HTTP ${res.status}`);
    const raw = (await res.json()) as DgBatch;
    const info = Object.values(raw.metadata?.model_info ?? {})[0];
    const model = info ? `${info.name ?? BATCH_MODEL} ${info.version ?? ""}`.trim() : BATCH_MODEL;
    return { words: parseBatchResponse(raw, channelMap), raw, model };
  }
}

/** CI stand-in: returns a supplied word list as the pass-two transcript. */
export class MockBatch implements BatchTranscriber {
  constructor(private readonly words: () => Promise<Word[]>) {}

  async transcribe(_url: string, channelMap: ChannelMap): Promise<BatchResult> {
    const words = (await this.words()).map((w) => ({
      ...w,
      pass: 2 as const,
      isFinal: true,
      removedAsCrosstalk: false,
      speakerLabel: channelMap[String(w.channel) as "0" | "1"],
    }));
    return { words, raw: { mock: true }, model: "mock" };
  }
}
