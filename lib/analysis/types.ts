// Types shared by the pipeline, the transcribers, and storage.
// These mirror schemas/words.schema.json and schemas/session.schema.json.
// This module imports nothing from the browser, Node, or Next.

export type Participant = "A" | "B";
export type Channel = 0 | 1;
export type PassNumber = 1 | 2;

export interface Word {
  word: string;
  punctuatedWord: string;
  startMs: number;
  endMs: number;
  confidence: number;
  channel: Channel;
  isFinal: boolean;
  pass: PassNumber;
  removedAsCrosstalk: boolean;
  speakerLabel: Participant;
  /**
   * Labels the pipeline adds (work order 01, section 2). No step deletes a
   * word; counts filter on these labels.
   */
  inWindow?: boolean;
  isFiller?: boolean;
  isRepetition?: boolean;
  isBackchannel?: boolean;
  inGap?: boolean;
  /** Set on backchannel candidate words only (docs/OPERATIONAL_DEFINITIONS.md). */
  overlapsPartner?: boolean;
  partnerSilenceMs?: number | null;
  partnerResumesNext?: boolean;
  floorClass?: "backchannel" | "standalone_turn" | "turn_part";
}

export interface CompositeWeights {
  silent_pause_rate: number;
  speech_rate_wpm: number;
  mean_length_of_run: number;
}

export interface Config {
  gainDb: number;
  pauseThresholdsMs: number[];
  turnThresholdMs: number;
  /**
   * A partner silence at or above this leaves the floor open, so a
   * backchannel-token run there counts as a one-word turn. Separate from
   * turnThresholdMs, which only defines a long pause. Default 1500.
   */
  floorLapseMs?: number;
  gatingMarginDb: number;
  speechFloorDbfs?: number;
  compositeWeights: CompositeWeights;
  weightsVersion: string;
  baselineMinSessions: number;
  fillerTokens: string[];
  backchannelTokens: string[];
  targetPatterns: string[];
  keyterms: string[];
  durationMs: number;
}

export interface SessionEvent {
  type: string;
  atMs: number;
  detail?: unknown;
}

export interface PassRef {
  transcript: string;
  measurements: string;
  completedAt?: string;
  source?: "usb" | "onboard";
}

export type SessionState = "setup" | "live" | "closing" | "done";

export interface SessionRecord {
  id: string;
  examId: string;
  state?: SessionState;
  participantIds: { A: string; B: string };
  channelMap?: { "0": Participant; "1": Participant };
  config: Config;
  markers: { startMs: number | null; stopMs: number | null };
  events: SessionEvent[];
  instructorLiveScore: { value: number; atMs: number } | null;
  passes: { "1"?: PassRef; "2"?: PassRef };
  pipelineVersion: string;
  deepgramModel: string;
  firmware: { tx: string; rx: string };
  createdAt: string;
}

/** Defaults from features.json params and PLAN.md. */
export const DEFAULT_CONFIG: Config = {
  gainDb: 0,
  pauseThresholdsMs: [200, 350],
  turnThresholdMs: 1500,
  floorLapseMs: 1500,
  gatingMarginDb: 6,
  speechFloorDbfs: -60,
  compositeWeights: { silent_pause_rate: 0.5, speech_rate_wpm: 0.25, mean_length_of_run: 0.25 },
  weightsVersion: "1.1",
  baselineMinSessions: 10,
  fillerTokens: ["uh", "um"],
  backchannelTokens: [
    "mhmm",
    "mm-mm",
    "uh-huh",
    "uh-uh",
    "nuh-uh",
    "yeah",
    "right",
    "okay",
    "really",
  ],
  targetPatterns: [],
  keyterms: [],
  durationMs: 300000,
};

// ---------------------------------------------------------------- pipeline

/** One 20 ms energy frame on one channel. */
export interface EnergyFrame {
  atMs: number;
  channel: Channel;
  dbfs: number;
}

/** Columnar energy as stored in energy/{sessionId}.json and the fixtures. */
export interface EnergyTrack {
  frameMs: number;
  startMs: number;
  channels: [number[], number[]];
}

export interface Markers {
  startMs: number;
  stopMs: number;
}

export interface Gap {
  startMs: number;
  endMs: number;
}

/** A word plus its index in the pipeline's attributed list. */
export interface IndexedWord extends Word {
  index: number;
}

export interface Turn {
  channel: Channel;
  participant: Participant;
  words: IndexedWord[];
  startMs: number;
  endMs: number;
}

export interface Transition {
  from: Participant;
  into: Participant;
  fromEndMs: number;
  toStartMs: number;
  latencyMs: number;
}

export interface Pause {
  participant: Participant;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** The word before the pause. */
  afterWord: IndexedWord;
  boundary: "mid" | "end";
}

export interface Run {
  participant: Participant;
  words: IndexedWord[];
  prunedCount: number;
}

export interface RemovedSpan {
  channel: Channel;
  startMs: number;
  endMs: number;
  words: string[];
  reason: "sequence" | "single";
}

export type WindowLabel = "full" | `roll10:${number}`;

export interface FeatureValue {
  featureId: string;
  participant: Participant;
  pass: PassNumber;
  window: WindowLabel;
  thresholdMs: number | null;
  value: number | null;
  unit: string;
  detail?: unknown;
}

export interface BaselineComponent {
  mean: number;
  sd: number;
  /** Student observations behind mean and sd. */
  count?: number;
}

export interface Baseline {
  /** Sessions in the baseline; baselineMinSessions compares against this. */
  n: number;
  /** Session ids already counted, so a rerun of pass two does not count twice. */
  sessions?: string[];
  /**
   * Composite weights version the components were measured under. Version 1.1
   * stores the mid-clause pause rate in the silent_pause_rate slot; a baseline
   * without this field dates from 1.0, when that slot held the total pause rate.
   */
  weightsVersion?: string;
  components: {
    speech_rate_wpm: BaselineComponent;
    silent_pause_rate: BaselineComponent;
    mean_length_of_run: BaselineComponent;
  };
}

export interface GatingResult {
  speechFrames: number;
  attributedFrames: [number, number];
  unattributedFrames: number;
  unattributedRatio: number | null;
}
