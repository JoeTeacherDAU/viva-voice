import type { Participant, Word } from "@/lib/analysis/types";

export type { Word } from "@/lib/analysis/types";

export interface TranscriberConfig {
  /** Which student each capture channel carries, from the setup screen. */
  channelMap: { "0": Participant; "1": Participant };
  keyterms?: string[];
  sampleRate?: number;
}

export type TranscriberEventType =
  | "open"
  | "close"
  | "error"
  | "reconnecting"
  | "reconnected"
  | "gap"
  | "utterance_end"
  | "speech_started";

export interface TranscriberEvent {
  type: TranscriberEventType;
  /** Session-clock milliseconds. */
  atMs: number;
  detail?: unknown;
}

export interface Transcriber {
  connect(cfg: TranscriberConfig): Promise<void>;
  sendFrames(buf: ArrayBuffer): void;
  onWords(cb: (w: Word[]) => void): void;
  onEvent(cb: (e: TranscriberEvent) => void): void;
  close(): Promise<void>;
}
