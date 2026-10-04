import { get as registryGet } from "@/lib/registry";
import { buildContext, type AnalysisContext } from "./context";
import { rejectCrosstalk } from "./crosstalk";
import { toTrack } from "./energy";
import { featureFunctions } from "./features";
import type { ChannelMap } from "./turns";
import { gapsFrom, trimWords } from "./window";
import type {
  Baseline,
  Config,
  EnergyFrame,
  EnergyTrack,
  FeatureValue,
  Gap,
  GatingResult,
  IndexedWord,
  Markers,
  Participant,
  PassNumber,
  RemovedSpan,
  SessionEvent,
  Transition,
  Turn,
  WindowLabel,
  Word,
} from "./types";

export const PIPELINE_VERSION = "1.0.0";

export const ROLLING_WINDOW_MS = 10000;
export const ROLLING_FEATURES = [
  "speech_rate_wpm",
  "silent_pause_rate",
  "mean_length_of_run",
  "talk_time_share",
] as const;

export interface RunOptions {
  pass: PassNumber;
  markers: Markers;
  events?: SessionEvent[];
  channelMap?: ChannelMap;
  /** Pass-one features, so pass two can report pass agreement. */
  previousPass?: FeatureValue[] | null;
  /** Rolling 10-second windows; on by default. */
  rolling?: boolean;
}

export interface RunResult {
  pipelineVersion: string;
  features: FeatureValue[];
  turns: Turn[];
  transitions: Transition[];
  removedSpans: RemovedSpan[];
  /** The word list after windowing and cross-talk rejection, with flags set. */
  words: Word[];
  quality: GatingResult & { gaps: Gap[]; removedWords: number };
}

const DEFAULT_MAP: ChannelMap = { "0": "A", "1": "B" };

/**
 * Runs the tier 1 pipeline over one pass of one session. The browser calls it
 * on pass one and the pass-two function calls it on pass two.
 */
export function run(
  words: Word[],
  frames: EnergyTrack | EnergyFrame[] | null,
  config: Config,
  baseline: Baseline | null,
  opts: RunOptions,
): RunResult {
  const channelMap = opts.channelMap ?? DEFAULT_MAP;
  const markers = opts.markers;
  const gaps = opts.pass === 1 ? gapsFrom(opts.events, markers) : [];
  const energy = toTrack(frames);

  // Pass one measures final words only; interims drive the display elsewhere.
  const eligible = words.filter((w) => opts.pass === 2 || w.isFinal);
  const windowed = trimWords(eligible, markers, gaps);
  const { words: flagged, removed } = rejectCrosstalk(windowed, energy, config.gatingMarginDb);
  const attributed: IndexedWord[] = flagged
    .filter((w) => !w.removedAsCrosstalk)
    .sort((a, b) => a.startMs - b.startMs || a.channel - b.channel)
    .map((w, index) => ({
      ...w,
      speakerLabel: channelMap[String(w.channel) as "0" | "1"],
      index,
    }));

  const base = {
    pass: opts.pass,
    config,
    channelMap,
    energy,
    removed,
    baseline,
    previousPass: opts.previousPass ?? null,
  };
  const ctx = buildContext({ ...base, attributed, markers, gaps });
  const features = evaluate(ctx, "full");

  if (opts.rolling !== false) {
    const span = markers.stopMs - markers.startMs;
    for (let off = 0; off + ROLLING_WINDOW_MS <= span; off += ROLLING_WINDOW_MS) {
      const sub = {
        startMs: markers.startMs + off,
        stopMs: markers.startMs + off + ROLLING_WINDOW_MS,
      };
      const subGaps = gaps
        .map((g) => ({
          startMs: Math.max(g.startMs, sub.startMs),
          endMs: Math.min(g.endMs, sub.stopMs),
        }))
        .filter((g) => g.endMs > g.startMs);
      const subWords = attributed
        .filter((w) => w.startMs >= sub.startMs && w.endMs <= sub.stopMs)
        .map((w, index) => ({ ...w, index }));
      const subCtx = buildContext({ ...base, attributed: subWords, markers: sub, gaps: subGaps });
      features.push(...evaluate(subCtx, `roll10:${off}`, ROLLING_FEATURES));
    }
  }

  return {
    pipelineVersion: PIPELINE_VERSION,
    features,
    turns: ctx.turns,
    transitions: ctx.transitions,
    removedSpans: removed,
    words: flagged.map((w) => ({ ...w, speakerLabel: channelMap[String(w.channel) as "0" | "1"] })),
    quality: {
      ...ctx.gating,
      gaps,
      removedWords: removed.reduce((a, r) => a + r.words.length, 0),
    },
  };
}

function evaluate(
  ctx: AnalysisContext,
  window: WindowLabel,
  only?: readonly string[],
): FeatureValue[] {
  const out: FeatureValue[] = [];
  for (const [id, fn] of featureFunctions()) {
    if (only && !only.includes(id)) continue;
    const unit = registryGet(id).unit;
    for (const P of ["A", "B"] as Participant[]) {
      for (const v of fn(ctx, P)) {
        out.push({
          featureId: id,
          participant: P,
          pass: ctx.pass,
          window,
          thresholdMs: v.thresholdMs,
          value: v.value,
          unit,
          ...(v.detail !== undefined ? { detail: v.detail } : {}),
        });
      }
    }
  }
  return out;
}
