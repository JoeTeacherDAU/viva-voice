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
  gatingMarginDb: 6,
  speechFloorDbfs: -60,
  compositeWeights: { silent_pause_rate: 0.5, speech_rate_wpm: 0.25, mean_length_of_run: 0.25 },
  weightsVersion: "1.0",
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
