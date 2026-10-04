import { tokenOf } from "../tokens";
import type { IndexedWord } from "../types";
import { defineFeature } from "./define";

export const MATTR_WINDOW = 50;
export const MTLD_THRESHOLD = 0.72;

export function mattr(tokens: string[], win = MATTR_WINDOW): number | null {
  if (tokens.length < win) return null;
  // Slide the window one token at a time, keeping type counts incrementally.
  const counts = new Map<string, number>();
  for (let i = 0; i < win; i++) counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
  let sum = counts.size / win;
  for (let i = win; i < tokens.length; i++) {
    const out = tokens[i - win];
    const c = counts.get(out)! - 1;
    if (c === 0) counts.delete(out);
    else counts.set(out, c);
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    sum += counts.size / win;
  }
  return sum / (tokens.length - win + 1);
}

function mtldOneWay(tokens: string[], threshold: number): number | null {
  let factors = 0;
  let types = new Set<string>();
  let count = 0;
  let ttr = 1;
  for (const t of tokens) {
    count++;
    types.add(t);
    ttr = types.size / count;
    if (ttr <= threshold) {
      factors++;
      types = new Set();
      count = 0;
      ttr = 1;
    }
  }
  if (count > 0) factors += (1 - ttr) / (1 - threshold);
  return factors === 0 ? null : tokens.length / factors;
}

/** MTLD (McCarthy & Jarvis 2010): mean of the forward and backward passes. */
export function mtld(tokens: string[], threshold = MTLD_THRESHOLD): number | null {
  if (tokens.length === 0) return null;
  const f = mtldOneWay(tokens, threshold);
  const b = mtldOneWay([...tokens].reverse(), threshold);
  return f === null || b === null ? null : (f + b) / 2;
}

export interface TargetHit {
  pattern: string;
  startMs: number;
  endMs: number;
}

/**
 * Matches each pattern, anchored at word boundaries and case-insensitive, over
 * the words' tokens joined by single spaces, and maps each match back to the
 * first and last word it covers.
 */
export function targetHits(words: IndexedWord[], patterns: string[]): TargetHit[] {
  const sorted = [...words].sort((a, b) => a.startMs - b.startMs);
  const tokens = sorted.map((w) => tokenOf(w.word));
  const starts: number[] = [];
  let text = "";
  tokens.forEach((t, i) => {
    if (i > 0) text += " ";
    starts.push(text.length);
    text += t;
  });
  const wordAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const hits: TargetHit[] = [];
  for (const p of patterns) {
    if (!p.trim()) continue;
    const re = new RegExp(`\\b(?:${p})\\b`, "gi");
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue;
      const first = wordAt(m.index!);
      const last = wordAt(m.index! + m[0].length - 1);
      hits.push({ pattern: p, startMs: sorted[first].startMs, endMs: sorted[last].endMs });
    }
  }
  return hits.sort((a, b) => a.startMs - b.startMs);
}

defineFeature("mattr", (ctx, P) => [
  { thresholdMs: null, value: mattr(ctx.p[P].pruned.map((w) => tokenOf(w.word))) },
]);

// Raw twin: every attributed token in time order, fillers, repetitions, and backchannels included.
defineFeature("mattr_raw", (ctx, P) => [
  { thresholdMs: null, value: mattr(ctx.p[P].attributed.map((w) => tokenOf(w.word))) },
]);

defineFeature("mtld", (ctx, P) => [
  { thresholdMs: null, value: mtld(ctx.p[P].pruned.map((w) => tokenOf(w.word))) },
]);

defineFeature("target_structure_hits", (ctx, P) => {
  const spans = targetHits(
    ctx.p[P].attributed.filter((w) => w.isFinal),
    ctx.config.targetPatterns,
  );
  return [{ thresholdMs: null, value: spans.length, detail: { spans } }];
});
