// Token normalisation and punctuation tests shared by every module.

export function tokenOf(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9'-]/g, "");
}

const CLAUSE_FINAL = /[.?!,;]$/;
const ANY_PUNCT = /[.?!,;:]/;

export function isClauseFinal(punctuatedWord: string): boolean {
  return CLAUSE_FINAL.test(punctuatedWord);
}

export function hasPunctuation(punctuatedWord: string): boolean {
  return ANY_PUNCT.test(punctuatedWord);
}

export function makeTokenSet(tokens: string[]): Set<string> {
  return new Set(tokens.map(tokenOf));
}
