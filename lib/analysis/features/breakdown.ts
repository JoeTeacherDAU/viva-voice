import { runsInTurns } from "../pauses";
import { atThresholds, defineFeature, mean, perMinute } from "./define";

defineFeature("silent_pause_rate", (ctx, P) =>
  atThresholds(ctx, (t) => perMinute(ctx.pauses(P, t).length, ctx.phonation(P, t))),
);

defineFeature("silent_pause_mean_ms", (ctx, P) =>
  atThresholds(ctx, (t) => mean(ctx.pauses(P, t).map((p) => p.durationMs))),
);

defineFeature("silent_pause_max_ms", (ctx, P) =>
  atThresholds(ctx, (t) => {
    const ps = ctx.pauses(P, t);
    return ps.length ? Math.max(...ps.map((p) => p.durationMs)) : null;
  }),
);

defineFeature("silent_pause_mid_clause_count", (ctx, P) =>
  atThresholds(ctx, (t) => ctx.pauses(P, t).filter((p) => p.boundary === "mid").length),
);

defineFeature("silent_pause_end_clause_count", (ctx, P) =>
  atThresholds(ctx, (t) => ctx.pauses(P, t).filter((p) => p.boundary === "end").length),
);

defineFeature("mean_length_of_run", (ctx, P) =>
  atThresholds(ctx, (t) =>
    mean(
      runsInTurns(ctx.p[P].turns, t, ctx.p[P].prunedIndex)
        .map((r) => r.prunedCount)
        .filter((n) => n > 0),
    ),
  ),
);

// Raw twin: every word in each run counts, fillers and repetitions included.
defineFeature("mean_length_of_run_raw", (ctx, P) =>
  atThresholds(ctx, (t) =>
    mean(runsInTurns(ctx.p[P].turns, t, ctx.p[P].prunedIndex).map((r) => r.words.length)),
  ),
);

defineFeature("silent_pause_mid_clause_rate", (ctx, P) =>
  atThresholds(ctx, (t) =>
    perMinute(ctx.pauses(P, t).filter((p) => p.boundary === "mid").length, ctx.phonation(P, t)),
  ),
);

defineFeature("silent_pause_end_clause_rate", (ctx, P) =>
  atThresholds(ctx, (t) =>
    perMinute(ctx.pauses(P, t).filter((p) => p.boundary === "end").length, ctx.phonation(P, t)),
  ),
);

defineFeature("silent_pause_mid_clause_mean_ms", (ctx, P) =>
  atThresholds(ctx, (t) =>
    mean(
      ctx
        .pauses(P, t)
        .filter((p) => p.boundary === "mid")
        .map((p) => p.durationMs),
    ),
  ),
);

defineFeature("silent_pause_end_clause_mean_ms", (ctx, P) =>
  atThresholds(ctx, (t) =>
    mean(
      ctx
        .pauses(P, t)
        .filter((p) => p.boundary === "end")
        .map((p) => p.durationMs),
    ),
  ),
);

// Within-turn pauses at or above turnThresholdMs; each is also logged as a long_pause event.
defineFeature("long_pause_count", (ctx, P) => [
  { thresholdMs: null, value: ctx.pauses(P, ctx.config.turnThresholdMs).length },
]);

// Acoustic silences inside own turns, per minute of window time, from energy alone.
defineFeature("acoustic_pause_rate", (ctx, P) =>
  atThresholds(ctx, (t) =>
    ctx.energy
      ? perMinute(ctx.silences(P).filter((s) => s.endMs - s.startMs >= t).length, ctx.windowMs)
      : null,
  ),
);
