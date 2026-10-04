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
