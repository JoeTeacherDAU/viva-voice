import { countSyllables } from "../syllables";
import { atThresholds, defineFeature, perMinute, PHONATION_DEFAULT_MS } from "./define";

defineFeature("speech_rate_wpm", (ctx, P) => [
  { thresholdMs: null, value: perMinute(ctx.p[P].pruned.length, ctx.windowMs) },
]);

defineFeature("speech_rate_raw_wpm", (ctx, P) => [
  { thresholdMs: null, value: perMinute(ctx.p[P].attributed.length, ctx.windowMs) },
]);

defineFeature("articulation_rate_wpm", (ctx, P) =>
  atThresholds(ctx, (t) => perMinute(ctx.p[P].pruned.length, ctx.phonation(P, t))),
);

// Pass two only: interim words make a syllable estimate unstable.
defineFeature("articulation_rate_sps_est", (ctx, P) => {
  const phon = ctx.phonation(P, PHONATION_DEFAULT_MS);
  if (ctx.pass !== 2 || phon <= 0) return [{ thresholdMs: PHONATION_DEFAULT_MS, value: null }];
  const syl = ctx.p[P].pruned.reduce((a, w) => a + countSyllables(w.word), 0);
  return [{ thresholdMs: PHONATION_DEFAULT_MS, value: syl / (phon / 1000) }];
});

defineFeature("phonation_time_ratio", (ctx, P) =>
  atThresholds(ctx, (t) => (ctx.windowMs > 0 ? ctx.phonation(P, t) / ctx.windowMs : null)),
);

// Raw twin (RESEARCH_PRINCIPLES.md principle 2): every attributed word counts.
defineFeature("articulation_rate_raw_wpm", (ctx, P) =>
  atThresholds(ctx, (t) => perMinute(ctx.p[P].attributed.length, ctx.phonation(P, t))),
);
