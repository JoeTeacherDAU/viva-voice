import { compositeIndex } from "../composite";
import { runsInTurns } from "../pauses";
import { defineFeature, mean, perMinute } from "./define";

const COMPOSITE_THRESHOLD_MS = 350;

defineFeature("composite_fluency_index", (ctx, P) => {
  const T = COMPOSITE_THRESHOLD_MS;
  const value = compositeIndex(
    {
      speech_rate_wpm: perMinute(ctx.p[P].pruned.length, ctx.windowMs),
      // Weights version 1.1: mid-clause pauses only (RESEARCH_PRINCIPLES.md principle 3).
      silent_pause_rate: perMinute(
        ctx.pauses(P, T).filter((p) => p.boundary === "mid").length,
        ctx.phonation(P, T),
      ),
      mean_length_of_run: mean(
        runsInTurns(ctx.p[P].turns, T, ctx.p[P].prunedIndex)
          .map((r) => r.prunedCount)
          .filter((n) => n > 0),
      ),
    },
    ctx.baseline,
    ctx.config.compositeWeights,
    ctx.config.baselineMinSessions,
    ctx.config.weightsVersion,
  );
  return [
    {
      thresholdMs: null,
      value,
      detail: { weightsVersion: ctx.config.weightsVersion, baselineN: ctx.baseline?.n ?? 0 },
    },
  ];
});
