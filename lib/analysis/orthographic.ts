// Orthographic syllable estimate: count vowel groups, drop a silent final "e",
// keep at least one. scripts/build-syllable-table.mjs imports this file
// directly, so it must stay free of imports.

export function orthographicSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  let n = groups;
  // A final "e" after a consonant is usually silent ("make"), except in "-le" ("table").
  if (n > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n -= 1;
  return Math.max(1, n);
}
