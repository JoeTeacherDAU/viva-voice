import { tokenOf } from "./tokens";
import type { IndexedWord } from "./types";

export interface PruneResult {
  /** Words that survive pruning, in order, each still carrying its index. */
  kept: IndexedWord[];
  /** Words pruned as repetitions: the repeated word, or both words of the second pair. */
  repeated: IndexedWord[];
  repetitions: number;
  fillers: number;
}

/**
 * Prunes one turn's words: drops fillers, the repeated word of each word
 * repetition, and both words of the second pair of each bigram repetition.
 * Backchannel-token words inside a turn are ordinary words and stay; a
 * classified backchannel never reaches a turn (docs/OPERATIONAL_DEFINITIONS.md).
 * Nothing is deleted from the transcript: the caller labels the words.
 */
export function pruneTurn(words: IndexedWord[], fillerTokens: Set<string>): PruneResult {
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
  return {
    kept: nonFiller.filter((_, i) => !drop.has(i)),
    repeated: nonFiller.filter((_, i) => drop.has(i)),
    repetitions,
    fillers,
  };
}
