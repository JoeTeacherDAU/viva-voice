import { tokenOf } from "./tokens";
import type { IndexedWord } from "./types";

export interface PruneResult {
  /** Words that survive pruning, in order, each still carrying its raw index. */
  kept: IndexedWord[];
  repetitions: number;
  fillers: number;
}

/**
 * Prunes one turn's words: drops fillers, the repeated word of each word
 * repetition, both words of the second pair of each bigram repetition, and
 * every backchannel token. Each kept word keeps its index into the raw list.
 */
export function pruneTurn(
  words: IndexedWord[],
  fillerTokens: Set<string>,
  backchannelTokens: Set<string>,
): PruneResult {
  const nonFiller = words.filter((w) => !fillerTokens.has(tokenOf(w.word)));
  const fillers = words.length - nonFiller.length;
  const t = nonFiller.map((w) => tokenOf(w.word));
  const drop = new Set<number>();
  let repetitions = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] === t[i - 1]) {
      repetitions++;
      drop.add(i);
    } else if (i >= 3 && t[i - 1] === t[i - 3] && t[i] === t[i - 2]) {
      repetitions++;
      drop.add(i - 1);
      drop.add(i);
      i++; // the next position would re-count the same pair shifted by one
    }
  }
  const kept = nonFiller.filter((w, i) => !drop.has(i) && !backchannelTokens.has(t[i]));
  return { kept, repetitions, fillers };
}
