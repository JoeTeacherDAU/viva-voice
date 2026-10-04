import { defineFeature, mean, median, PHONATION_DEFAULT_MS } from "./define";

defineFeature("turn_count", (ctx, P) => [{ thresholdMs: null, value: ctx.p[P].turns.length }]);

defineFeature("mean_turn_length_words", (ctx, P) => [
  {
    thresholdMs: null,
    value: mean(
      ctx.p[P].turns.map((t) => t.words.filter((w) => ctx.p[P].prunedIndex.has(w.index)).length),
    ),
  },
]);

defineFeature("talk_time_share", (ctx, P) => {
  const other = P === "A" ? "B" : "A";
  const mine = ctx.phonation(P, PHONATION_DEFAULT_MS);
  const theirs = ctx.phonation(other, PHONATION_DEFAULT_MS);
  return [
    { thresholdMs: PHONATION_DEFAULT_MS, value: mine + theirs > 0 ? mine / (mine + theirs) : null },
  ];
});

defineFeature("response_latency_mean_ms", (ctx, P) => [
  { thresholdMs: null, value: mean(ctx.p[P].transitionsInto.map((t) => t.latencyMs)) },
]);

defineFeature("response_latency_median_ms", (ctx, P) => [
  { thresholdMs: null, value: median(ctx.p[P].transitionsInto.map((t) => t.latencyMs)) },
]);

// Overlap describes the pair, so both students receive the same values.
defineFeature("overlap_count", (ctx) => [{ thresholdMs: null, value: ctx.overlaps.length }]);

defineFeature("overlap_duration_ms", (ctx) => [
  { thresholdMs: null, value: ctx.overlaps.reduce((a, [lo, hi]) => a + (hi - lo), 0) },
]);

defineFeature("backchannel_count", (ctx, P) => [
  { thresholdMs: null, value: ctx.p[P].backchannels.length },
]);

defineFeature("question_count", (ctx, P) => [
  {
    thresholdMs: null,
    value: ctx.p[P].turns.filter((t) => t.words[t.words.length - 1].punctuatedWord.endsWith("?"))
      .length,
  },
]);

// Backchannel candidates that fell in a partner silence at or above floorLapseMs.
defineFeature("open_floor_response_count", (ctx, P) => [
  {
    thresholdMs: null,
    value: ctx.candidates.filter(
      (c) =>
        c.channel === ctx.p[P].channel &&
        c.partnerSilenceMs !== null &&
        c.partnerSilenceMs >= ctx.floorLapseMs,
    ).length,
  },
]);
