import table from "./syllables.json";
import { orthographicSyllables } from "./orthographic";

let lookup: Map<string, number> | null = null;

function load(): Map<string, number> {
  const m = new Map<string, number>();
  for (const [n, words] of Object.entries(table.exceptions as Record<string, string>)) {
    for (const w of words.split(" ")) m.set(w, Number(n));
  }
  return m;
}

/**
 * Dictionary syllable count from the CMU-derived table, else the orthographic
 * vowel-group estimate. scripts/build-syllable-table.mjs builds the table.
 */
export function countSyllables(word: string): number {
  lookup ??= load();
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  return lookup.get(w) ?? orthographicSyllables(w);
}
