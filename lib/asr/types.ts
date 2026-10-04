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

/** One message from the recognizer, exactly as received (work order 01, 4.2). */
export interface RawMessage {
  /** Session-clock ms at which the receiving connection's audio began. */
  connectionOffsetMs: number | null;
  /** Session-clock ms of audio sent when the message arrived. */
  receivedAtMs: number;
  /** The message text, unparsed. */
  data: string;
}

export interface Transcriber {
  connect(cfg: TranscriberConfig): Promise<void>;
  sendFrames(buf: ArrayBuffer): void;
  onWords(cb: (w: Word[]) => void): void;
  onEvent(cb: (e: TranscriberEvent) => void): void;
  /** Every recognizer message, verbatim, for the archive. */
  onRaw?(cb: (m: RawMessage) => void): void;
  close(): Promise<void>;
}
