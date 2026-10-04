import type { IndexedWord, Word } from "./types";

/** Builds a word for unit tests. Channel 0 is student A. */
export function w(
  word: string,
  startMs: number,
  endMs: number,
  channel: 0 | 1 = 0,
  extra: Partial<Word> = {},
): Word {
  return {
    word: word.toLowerCase().replace(/[^a-z0-9'-]/g, ""),
    punctuatedWord: word,
    startMs,
    endMs,
    confidence: 0.9,
    channel,
    isFinal: true,
    pass: 2,
    removedAsCrosstalk: false,
    speakerLabel: channel === 0 ? "A" : "B",
    ...extra,
  };
}

export function indexed(words: Word[]): IndexedWord[] {
  return [...words].sort((a, b) => a.startMs - b.startMs).map((x, index) => ({ ...x, index }));
}

/** Lays out space-separated words on one channel, 200 ms each with 40 ms gaps. */
export function say(text: string, startMs: number, channel: 0 | 1 = 0, durMs = 200, gapMs = 40) {
  let t = startMs;
  return text.split(" ").map((s) => {
    const out = w(s, t, t + durMs, channel);
    t += durMs + gapMs;
    return out;
  });
}
