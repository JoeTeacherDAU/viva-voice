import { gateFrames } from "./gating";
import { pausesInTurns, phonationMs } from "./pauses";
import { pruneTurn } from "./prune";
import { tokenOf } from "./tokens";
import { analyseTurns, overlapIntervals, type ChannelMap } from "./turns";
import { effectiveWindowMs } from "./window";
import type {
  Baseline,
  Channel,
  Config,
  EnergyTrack,
  FeatureValue,
  Gap,
  GatingResult,
  IndexedWord,
  Markers,
  Participant,
  PassNumber,
  Pause,
  RemovedSpan,
  Transition,
  Turn,
} from "./types";

export interface ParticipantContext {
  participant: Participant;
  channel: Channel;
  turns: Turn[];
  /** Every attributed word on this channel: turn words and backchannels. */
  attributed: IndexedWord[];
  backchannels: IndexedWord[];
  pruned: IndexedWord[];
  prunedIndex: Set<number>;
  repetitions: number;
  transitionsInto: Transition[];
}

export interface AnalysisContext {
  pass: PassNumber;
  config: Config;
  markers: Markers;
  gaps: Gap[];
  windowMs: number;
  fillerTokens: Set<string>;
  backchannelTokens: Set<string>;
  turns: Turn[];
  transitions: Transition[];
  overlaps: [number, number][];
  gating: GatingResult;
  removed: RemovedSpan[];
  baseline: Baseline | null;
  previousPass: FeatureValue[] | null;
  p: Record<Participant, ParticipantContext>;
  phonation(participant: Participant, thresholdMs: number): number;
  pauses(participant: Participant, thresholdMs: number): Pause[];
}

export interface ContextInput {
  pass: PassNumber;
  attributed: IndexedWord[];
  config: Config;
  markers: Markers;
  gaps: Gap[];
  channelMap: ChannelMap;
  energy: EnergyTrack | null;
  removed: RemovedSpan[];
  baseline: Baseline | null;
  previousPass: FeatureValue[] | null;
}

/** Builds turns, pruning, and gating once, for every feature to read. */
export function buildContext(input: ContextInput): AnalysisContext {
  const { config, channelMap, attributed, gaps, markers } = input;
  const fillerTokens = new Set(config.fillerTokens.map(tokenOf));
  const backchannelTokens = new Set(config.backchannelTokens.map(tokenOf));
  const { turns, backchannels, transitions } = analyseTurns(
    attributed,
    backchannelTokens,
    config.turnThresholdMs,
    channelMap,
    gaps,
  );

  const channelOf = (P: Participant): Channel => (channelMap["0"] === P ? 0 : 1);
  const p = {} as Record<Participant, ParticipantContext>;
  for (const P of ["A", "B"] as Participant[]) {
    const ch = channelOf(P);
    const own = turns.filter((t) => t.channel === ch);
    let repetitions = 0;
    const pruned: IndexedWord[] = [];
    for (const t of own) {
      const r = pruneTurn(t.words, fillerTokens, backchannelTokens);
      repetitions += r.repetitions;
      pruned.push(...r.kept);
    }
    p[P] = {
      participant: P,
      channel: ch,
      turns: own,
      attributed: attributed.filter((w) => w.channel === ch),
      backchannels: backchannels.filter((w) => w.channel === ch),
      pruned,
      prunedIndex: new Set(pruned.map((w) => w.index)),
      repetitions,
      transitionsInto: transitions.filter((t) => t.into === P),
    };
  }

  const phonMemo = new Map<string, number>();
  const pauseMemo = new Map<string, Pause[]>();
  return {
    pass: input.pass,
    config,
    markers,
    gaps,
    windowMs: effectiveWindowMs(markers, gaps),
    fillerTokens,
    backchannelTokens,
    turns,
    transitions,
    overlaps: overlapIntervals(attributed),
    gating: gateFrames(
      input.energy,
      markers,
      config.gatingMarginDb,
      config.speechFloorDbfs ?? undefined,
      gaps,
    ),
    removed: input.removed,
    baseline: input.baseline,
    previousPass: input.previousPass,
    p,
    phonation(P, T) {
      const key = `${P}|${T}`;
      if (!phonMemo.has(key)) phonMemo.set(key, phonationMs(p[P].turns, T));
      return phonMemo.get(key)!;
    },
    pauses(P, T) {
      const key = `${P}|${T}`;
      if (!pauseMemo.has(key)) pauseMemo.set(key, pausesInTurns(p[P].turns, T));
      return pauseMemo.get(key)!;
    },
  };
}
