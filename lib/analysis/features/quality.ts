import { pauseAgreement } from "../acoustic";
import { defineFeature, mean, perMinute } from "./define";

// The gating ratio describes the session, so both students receive it.
defineFeature("unattributed_frame_ratio", (ctx) => [
  { thresholdMs: null, value: ctx.gating.unattributedRatio },
]);

defineFeature("crosstalk_removed_words", (ctx, P) => [
  {
    thresholdMs: null,
    value: ctx.removed
      .filter((r) => r.channel === ctx.p[P].channel)
      .reduce((a, r) => a + r.words.length, 0),
  },
]);

defineFeature("mean_word_confidence", (ctx, P) => [
  {
    thresholdMs: null,
    value: mean(ctx.p[P].attributed.filter((w) => w.isFinal).map((w) => w.confidence)),
  },
]);

// Stored with pass two; needs the pass-one features passed in as previousPass.
defineFeature("pass_agreement_speech_rate", (ctx, P) => {
  if (ctx.pass !== 2 || !ctx.previousPass) return [{ thresholdMs: null, value: null }];
  const p1 = ctx.previousPass.find(
    (v) =>
      v.featureId === "speech_rate_wpm" &&
      v.participant === P &&
      v.pass === 1 &&
      v.window === "full",
  )?.value;
  const p2 = perMinute(ctx.p[P].pruned.length, ctx.windowMs);
  return [
    {
      thresholdMs: null,
      value: p1 === null || p1 === undefined || p2 === null ? null : Math.abs(p1 - p2),
    },
  ];
});

// Word-gap pauses at the lowest configured threshold, checked against acoustic silence.
defineFeature("asr_acoustic_pause_agreement", (ctx, P) => {
  const t = Math.min(...ctx.config.pauseThresholdsMs);
  return [
    {
      thresholdMs: t,
      value: pauseAgreement(ctx.pauses(P, t), ctx.silences(P), ctx.energy !== null),
    },
  ];
});
