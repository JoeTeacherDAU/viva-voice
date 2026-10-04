import { silentRuns, type Span } from "./acoustic";
import { DEFAULT_SPEECH_FLOOR_DBFS, gateFrames } from "./gating";
import { pausesInTurns, phonationMs } from "./pauses";
import { pruneTurn } from "./prune";
import { tokenOf } from "./tokens";
import { analyseTurns, overlapIntervals, type Candidate, type ChannelMap } from "./turns";

export const DEFAULT_FLOOR_LAPSE_MS = 1500;
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
  /** Indices of words pruned as repetitions. */
  repeatedIndex: Set<number>;
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
  /** Every backchannel candidate with its classifying facts. */
  candidates: Candidate[];
  floorLapseMs: number;
  overlaps: [number, number][];
  gating: GatingResult;
  removed: RemovedSpan[];
  baseline: Baseline | null;
  previousPass: FeatureValue[] | null;
  energy: EnergyTrack | null;
  p: Record<Participant, ParticipantContext>;
  phonation(participant: Participant, thresholdMs: number): number;
  pauses(participant: Participant, thresholdMs: number): Pause[];
  /** Acoustic silent runs inside the participant's own turns. */
  silences(participant: Participant): Span[];
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
  const { turns, backchannels, transitions, candidates } = analyseTurns(
    attributed,
    backchannelTokens,
    channelMap,
    gaps,
    config.floorLapseMs ?? DEFAULT_FLOOR_LAPSE_MS,
  );

  const channelOf = (P: Participant): Channel => (channelMap["0"] === P ? 0 : 1);
  const p = {} as Record<Participant, ParticipantContext>;
  for (const P of ["A", "B"] as Participant[]) {
    const ch = channelOf(P);
    const own = turns.filter((t) => t.channel === ch);
    let repetitions = 0;
    const pruned: IndexedWord[] = [];
    const repeated: IndexedWord[] = [];
    for (const t of own) {
      const r = pruneTurn(t.words, fillerTokens);
      repetitions += r.repetitions;
      pruned.push(...r.kept);
      repeated.push(...r.repeated);
    }
    p[P] = {
      participant: P,
      channel: ch,
      turns: own,
      attributed: attributed.filter((w) => w.channel === ch),
      backchannels: backchannels.filter((w) => w.channel === ch),
      pruned,
      prunedIndex: new Set(pruned.map((w) => w.index)),
      repeatedIndex: new Set(repeated.map((w) => w.index)),
      repetitions,
      transitionsInto: transitions.filter((t) => t.into === P),
    };
  }

  const phonMemo = new Map<string, number>();
  const silenceMemo = new Map<Participant, Span[]>();
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
    candidates,
    floorLapseMs: config.floorLapseMs ?? DEFAULT_FLOOR_LAPSE_MS,
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
    energy: input.energy,
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
    silences(P) {
      if (!silenceMemo.has(P)) {
        silenceMemo.set(
          P,
          silentRuns(
            input.energy,
            p[P].channel,
            p[P].turns,
            config.gatingMarginDb,
            config.speechFloorDbfs ?? DEFAULT_SPEECH_FLOOR_DBFS,
            gaps,
          ),
        );
      }
      return silenceMemo.get(P)!;
    },
  };
}
