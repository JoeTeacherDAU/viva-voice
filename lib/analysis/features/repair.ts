import type { AnalysisContext } from "../context";
import { hasPunctuation, isClauseFinal, tokenOf } from "../tokens";
import type { IndexedWord, Turn } from "../types";
import { defineFeature, mean, perMinute, PHONATION_DEFAULT_MS } from "./define";

const MAX_FRAGMENT_WORDS = 3;

defineFeature("filled_pause_count", (ctx, P) => [{ thresholdMs: null, value: fillers(ctx, P) }]);

defineFeature("filled_pause_rate", (ctx, P) => [
  {
    thresholdMs: PHONATION_DEFAULT_MS,
    value: perMinute(fillers(ctx, P), ctx.phonation(P, PHONATION_DEFAULT_MS)),
  },
]);

defineFeature("repetition_count", (ctx, P) => [{ thresholdMs: null, value: ctx.p[P].repetitions }]);

defineFeature("false_start_count", (ctx, P) => [
  {
    thresholdMs: null,
    value:
      ctx.pass === 2
        ? ctx.p[P].turns.reduce((a, t) => a + falseStartsInTurn(t, ctx.fillerTokens), 0)
        : null,
  },
]);

const tokenCount = (ctx: AnalysisContext, P: "A" | "B", tok: string) =>
  ctx.p[P].attributed.filter((w) => tokenOf(w.word) === tok).length;

defineFeature("uh_count", (ctx, P) => [{ thresholdMs: null, value: tokenCount(ctx, P, "uh") }]);
defineFeature("um_count", (ctx, P) => [{ thresholdMs: null, value: tokenCount(ctx, P, "um") }]);

/**
 * Each filler in a turn, with where it sits: "end" when no non-filler word
 * precedes it in the turn or the previous non-filler word carries
 * clause-final punctuation, "mid" otherwise; and the silence that follows it
 * up to the next word in the same turn (null when it ends the turn).
 */
export function fillerEvents(
  ctx: AnalysisContext,
  P: "A" | "B",
): { boundary: "mid" | "end"; silenceAfterMs: number | null }[] {
  const out: { boundary: "mid" | "end"; silenceAfterMs: number | null }[] = [];
  for (const t of ctx.p[P].turns) {
    let prev: IndexedWord | null = null;
    t.words.forEach((w, i) => {
      if (!ctx.fillerTokens.has(tokenOf(w.word))) {
        prev = w;
        return;
      }
      const boundary =
        prev === null || isClauseFinal((prev as IndexedWord).punctuatedWord) ? "end" : "mid";
      const next = t.words[i + 1];
      out.push({ boundary, silenceAfterMs: next ? next.startMs - w.endMs : null });
    });
  }
  return out;
}

defineFeature("filled_pause_mid_clause_count", (ctx, P) => [
  { thresholdMs: null, value: fillerEvents(ctx, P).filter((f) => f.boundary === "mid").length },
]);

defineFeature("filled_pause_end_clause_count", (ctx, P) => [
  { thresholdMs: null, value: fillerEvents(ctx, P).filter((f) => f.boundary === "end").length },
]);

defineFeature("silence_after_filler_mean_ms", (ctx, P) => [
  {
    thresholdMs: null,
    value: mean(
      fillerEvents(ctx, P)
        .map((f) => f.silenceAfterMs)
        .filter((x): x is number => x !== null),
    ),
  },
]);

function fillers(ctx: AnalysisContext, P: "A" | "B"): number {
  return ctx.p[P].attributed.filter((w) => ctx.fillerTokens.has(tokenOf(w.word))).length;
}

/**
 * Counts fragments of one to three unpunctuated words at a clause start,
 * followed by fillers, then a restart that shares no token with the fragment.
 * docs/OPERATIONAL_DEFINITIONS.md gives the rule; it is a heuristic.
 */
export function falseStartsInTurn(turn: Turn, fillerTokens: Set<string>): number {
  const w = turn.words;
  const isFiller = (x: IndexedWord | undefined) => !!x && fillerTokens.has(tokenOf(x.word));
  let count = 0;
  let seenNonFiller = false;
  let prevNonFiller: IndexedWord | null = null;
  for (let i = 0; i < w.length; i++) {
    if (isFiller(w[i])) continue;
    const clauseStart =
      !seenNonFiller || (prevNonFiller && isClauseFinal(prevNonFiller.punctuatedWord));
    seenNonFiller = true;
    prevNonFiller = w[i];
    if (!clauseStart) continue;

    let k = 0;
    for (let n = 1; n <= MAX_FRAGMENT_WORDS && i + n < w.length; n++) {
      const frag = w.slice(i, i + n);
      if (frag.some((x) => isFiller(x) || hasPunctuation(x.punctuatedWord))) break;
      if (isFiller(w[i + n])) {
        k = n;
        break;
      }
    }
    if (!k) continue;

    let r = i + k;
    while (r < w.length && isFiller(w[r])) r++;
    const restart = w
      .slice(r)
      .filter((x) => !isFiller(x))
      .slice(0, k);
    if (!restart.length) continue;
    const fragTokens = new Set(w.slice(i, i + k).map((x) => tokenOf(x.word)));
    if (restart.some((x) => fragTokens.has(tokenOf(x.word)))) continue;
    count++;
    // Resume at the restart; the fragment's last word precedes it.
    prevNonFiller = w[i + k - 1];
    i = r - 1;
  }
  return count;
}
