import { isClauseFinal } from "./tokens";
import type { IndexedWord, Pause, Run, Turn } from "./types";

/** Silent pauses at threshold T: within-turn gaps of at least T ms. */
export function pausesInTurns(turns: Turn[], thresholdMs: number): Pause[] {
  const out: Pause[] = [];
  for (const t of turns) {
    for (let i = 1; i < t.words.length; i++) {
      const gap = t.words[i].startMs - t.words[i - 1].endMs;
      if (gap >= thresholdMs) {
        out.push({
          participant: t.participant,
          startMs: t.words[i - 1].endMs,
          endMs: t.words[i].startMs,
          durationMs: gap,
          afterWord: t.words[i - 1],
          boundary: isClauseFinal(t.words[i - 1].punctuatedWord) ? "end" : "mid",
        });
      }
    }
  }
  return out;
}

/** Turn duration minus every pause at threshold T, summed over the turns. */
export function phonationMs(turns: Turn[], thresholdMs: number): number {
  let total = 0;
  for (const t of turns) total += t.endMs - t.startMs;
  for (const p of pausesInTurns(turns, thresholdMs)) total -= p.durationMs;
  return total;
}

/**
 * Splits each turn at pauses of at least T ms. prunedIndex holds the raw
 * indices of words that survive pruning, so each run reports its pruned size.
 */
export function runsInTurns(turns: Turn[], thresholdMs: number, prunedIndex: Set<number>): Run[] {
  const runs: Run[] = [];
  for (const t of turns) {
    let cur: IndexedWord[] = [];
    t.words.forEach((w, i) => {
      if (i > 0 && w.startMs - t.words[i - 1].endMs >= thresholdMs) {
        runs.push(makeRun(t, cur, prunedIndex));
        cur = [];
      }
      cur.push(w);
    });
    runs.push(makeRun(t, cur, prunedIndex));
  }
  return runs;
}

function makeRun(t: Turn, words: IndexedWord[], prunedIndex: Set<number>): Run {
  return {
    participant: t.participant,
    words,
    prunedCount: words.filter((w) => prunedIndex.has(w.index)).length,
  };
}
