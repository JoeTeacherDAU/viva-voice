import { get as registryGet } from "@/lib/registry";
import { buildContext, type AnalysisContext } from "./context";
import { rejectCrosstalk } from "./crosstalk";
import { toTrack } from "./energy";
import { featureFunctions } from "./features";
import type { ChannelMap } from "./turns";
import { tokenOf } from "./tokens";
import { gapsFrom, overlapsAny } from "./window";
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

export const PIPELINE_VERSION = "1.1.0";

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

/** A within-turn pause at or above turnThresholdMs (work order 01, section 1). */
export interface LongPause {
  participant: Participant;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface RunResult {
  pipelineVersion: string;
  features: FeatureValue[];
  turns: Turn[];
  transitions: Transition[];
  removedSpans: RemovedSpan[];
  /** Every input word, with its labels set. */
  words: Word[];
  longPauses: LongPause[];
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

  // Every input word comes back out with labels; no step deletes one
  // (RESEARCH_PRINCIPLES.md principles 1 and 2). src points back into `out`.
  const fillerSet = new Set(config.fillerTokens.map(tokenOf));
  const out: Word[] = words.map((w) => ({
    ...w,
    speakerLabel: channelMap[String(w.channel) as "0" | "1"],
    removedAsCrosstalk: false,
    inWindow: w.startMs >= markers.startMs && w.endMs <= markers.stopMs,
    inGap: overlapsAny(gaps, w.startMs, w.endMs),
    isFiller: fillerSet.has(tokenOf(w.word)),
    isRepetition: false,
    isBackchannel: false,
  }));
  // Pass one measures final words only; interims drive the display elsewhere.
  const eligible = out
    .map((w, src) => ({ ...w, src }))
    .filter((w) => (opts.pass === 2 || w.isFinal) && w.inWindow && !w.inGap);
  const { words: flagged, removed } = rejectCrosstalk(eligible, energy, config.gatingMarginDb);
  for (const w of flagged) out[w.src].removedAsCrosstalk = w.removedAsCrosstalk;
  const attributedSrc: number[] = [];
  const attributed: IndexedWord[] = flagged
    .filter((w) => !w.removedAsCrosstalk)
    .sort((a, b) => a.startMs - b.startMs || a.channel - b.channel)
    .map((w, index) => {
      attributedSrc[index] = w.src;
      const { src: _src, ...rest } = w;
      void _src;
      return { ...rest, index };
    });

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
  for (const P of ["A", "B"] as Participant[]) {
    for (const w of ctx.p[P].backchannels) out[attributedSrc[w.index]].isBackchannel = true;
    for (const i of ctx.p[P].repeatedIndex) out[attributedSrc[i]].isRepetition = true;
  }
  for (const c of ctx.candidates) {
    for (const w of c.words) {
      Object.assign(out[attributedSrc[w.index]], {
        overlapsPartner: c.overlapsPartner,
        partnerSilenceMs: c.partnerSilenceMs,
        partnerResumesNext: c.partnerResumesNext,
        floorClass: c.floorClass,
      });
    }
  }
  const longPauses: LongPause[] = (["A", "B"] as Participant[]).flatMap((P) =>
    ctx.pauses(P, config.turnThresholdMs).map((p) => ({
      participant: P,
      startMs: p.startMs,
      endMs: p.endMs,
      durationMs: p.durationMs,
    })),
  );

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
    words: out.sort((a, b) => a.startMs - b.startMs || a.channel - b.channel),
    longPauses,
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
