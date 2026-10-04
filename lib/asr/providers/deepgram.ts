import type { Participant, Word } from "@/lib/analysis/types";
import { pcmDurationMs, SessionClock } from "../clock";
import type { RawMessage, Transcriber, TranscriberConfig, TranscriberEvent } from "../types";

export const LISTEN_URL = "wss://api.deepgram.com/v1/listen";
export const KEEPALIVE_MS = 5000;
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 4000];

/** The live-pass query from PLAN.md section 6.1. */
export function buildListenUrl(keyterms: string[] = [], base = LISTEN_URL): string {
  const q = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "2",
    multichannel: "true",
    interim_results: "true",
    punctuate: "true",
    filler_words: "true",
    vad_events: "true",
    utterance_end_ms: "1000",
    endpointing: "300",
  });
  for (const t of keyterms) if (t.trim()) q.append("keyterm", t.trim());
  return `${base}?${q.toString()}`;
}

interface DgWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
}

interface DgResults {
  type: "Results";
  channel_index: [number, number];
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  channel: { alternatives: { transcript: string; confidence: number; words: DgWord[] }[] };
}

type DgMessage =
  | DgResults
  | { type: "UtteranceEnd"; channel: [number, number]; last_word_end: number }
  | { type: "SpeechStarted"; channel: [number, number]; timestamp: number }
  | { type: "Metadata"; request_id?: string }
  | { type: string };

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "failed" | "closed";

/** The parts of the WebSocket API the adapter uses, so tests can pass a fake. */
export interface SocketLike {
  readyState: number;
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export interface DeepgramOptions {
  /** Returns a fresh JWT from /api/asr/grant. Called once per connection. */
  getToken: () => Promise<string>;
  socketFactory?: SocketFactory;
  url?: string;
}

const OPEN = 1;

/** Fetches a token from the grant route, for browser use. */
export async function fetchGrantToken(): Promise<string> {
  const res = await fetch("/api/asr/grant", { method: "POST" });
  if (!res.ok) throw new Error(`grant route returned HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * Live Deepgram transcriber over one multichannel WebSocket (PLAN.md 6.1).
 *
 * isFinal semantics: Deepgram marks a result is_final when the words in it
 * will not change; speech_final marks the end of an utterance (endpointing).
 * A word is final for Viva Voice when its result is is_final, whatever
 * speech_final says, because an is_final result never gets revised. The
 * adapter reports speech_final results as utterance_end events.
 */
export class DeepgramTranscriber implements Transcriber {
  private socket: SocketLike | null = null;
  private cfg: TranscriberConfig | null = null;
  private wordCbs: ((w: Word[]) => void)[] = [];
  private eventCbs: ((e: TranscriberEvent) => void)[] = [];
  private rawCbs: ((m: RawMessage) => void)[] = [];
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closing = false;
  private _state: ConnectionState = "idle";
  readonly clock = new SessionClock();
  private readonly factory: SocketFactory;

  constructor(private readonly opts: DeepgramOptions) {
    this.factory =
      opts.socketFactory ??
      ((url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike);
  }

  get state(): ConnectionState {
    return this._state;
  }

  async connect(cfg: TranscriberConfig): Promise<void> {
    this.cfg = cfg;
    this.closing = false;
    this.setState("connecting");
    await this.open();
  }

  sendFrames(buf: ArrayBuffer): void {
    const ms = pcmDurationMs(buf.byteLength);
    const sendable =
      this.socket !== null && this.socket.readyState === OPEN && this._state === "open";
    const gap = this.clock.advance(ms, sendable);
    if (gap) this.emitEvent({ type: "gap", atMs: gap.startMs, detail: gap });
    if (sendable) this.socket!.send(buf);
  }

  onWords(cb: (w: Word[]) => void): void {
    this.wordCbs.push(cb);
  }

  onEvent(cb: (e: TranscriberEvent) => void): void {
    this.eventCbs.push(cb);
  }

  onRaw(cb: (m: RawMessage) => void): void {
    this.rawCbs.push(cb);
  }

  /** Sends CloseStream so Deepgram flushes final results, then waits for the close. */
  async close(timeoutMs = 3000): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopKeepAlive();
    const s = this.socket;
    if (s && s.readyState === OPEN) {
      await new Promise<void>((resolve) => {
        const done = setTimeout(() => {
          s.close(1000, "client close timeout");
          resolve();
        }, timeoutMs);
        const prev = s.onclose;
        s.onclose = (ev) => {
          clearTimeout(done);
          prev?.(ev);
          resolve();
        };
        s.send(JSON.stringify({ type: "CloseStream" }));
      });
    }
    this.socket = null;
    this.setState("closed");
    this.emitEvent({ type: "close", atMs: this.clock.capturedMs });
  }

  private async open(): Promise<void> {
    const token = await this.opts.getToken();
    const url = buildListenUrl(this.cfg?.keyterms ?? [], this.opts.url);
    await new Promise<void>((resolve, reject) => {
      const s = this.factory(url, ["bearer", token]);
      s.binaryType = "arraybuffer";
      this.socket = s;
      let opened = false;
      s.onopen = () => {
        opened = true;
        this.attempts = 0;
        const wasReconnect = this._state === "reconnecting";
        this.setState("open");
        this.startKeepAlive();
        this.emitEvent({
          type: wasReconnect ? "reconnected" : "open",
          atMs: this.clock.capturedMs,
        });
        resolve();
      };
      s.onmessage = (ev) => this.handleMessage(ev.data);
      s.onerror = () => {
        if (!opened) reject(new Error("Deepgram socket failed to open"));
      };
      s.onclose = (ev) => {
        if (!opened) {
          reject(new Error(`Deepgram socket closed before opening (code ${ev.code})`));
          return;
        }
        this.handleDrop(ev.code);
      };
    });
  }

  private handleDrop(code: number) {
    this.stopKeepAlive();
    this.socket = null;
    if (this.closing) return;
    this.clock.drop();
    this.emitEvent({ type: "error", atMs: this.clock.capturedMs, detail: { code } });
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.attempts >= RECONNECT_DELAYS_MS.length) {
      this.setState("failed");
      this.emitEvent({ type: "error", atMs: this.clock.capturedMs, detail: { fatal: true } });
      return;
    }
    const delay = RECONNECT_DELAYS_MS[this.attempts++];
    this.setState("reconnecting");
    this.emitEvent({
      type: "reconnecting",
      atMs: this.clock.capturedMs,
      detail: { attempt: this.attempts, delay },
    });
    this.reconnectTimer = setTimeout(() => {
      if (this.closing) return;
      this.open().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    // Keep every message verbatim before parsing (RESEARCH_PRINCIPLES.md principle 1).
    const raw: RawMessage = {
      connectionOffsetMs: this.clock.connectionOffsetMs,
      receivedAtMs: this.clock.capturedMs,
      data,
    };
    for (const cb of this.rawCbs) cb(raw);
    let msg: DgMessage;
    try {
      msg = JSON.parse(data) as DgMessage;
    } catch {
      return;
    }
    if (msg.type === "Results") {
      const r = msg as DgResults;
      const alt = r.channel?.alternatives?.[0];
      const ch = (r.channel_index?.[0] ?? 0) as 0 | 1;
      if (alt?.words?.length) {
        const label: Participant =
          this.cfg?.channelMap[String(ch) as "0" | "1"] ?? (ch === 0 ? "A" : "B");
        const words: Word[] = alt.words.map((w) => ({
          word: w.word,
          punctuatedWord: w.punctuated_word ?? w.word,
          startMs: this.clock.rebase(w.start),
          endMs: this.clock.rebase(w.end),
          confidence: w.confidence,
          channel: ch,
          isFinal: r.is_final,
          pass: 1,
          removedAsCrosstalk: false,
          speakerLabel: label,
        }));
        this.emitWords(words);
      }
      if (r.is_final && r.speech_final) {
        this.emitEvent({
          type: "utterance_end",
          atMs: this.clock.rebase(r.start + r.duration),
          detail: { channel: ch },
        });
      }
    } else if (msg.type === "UtteranceEnd") {
      const m = msg as { channel: [number, number]; last_word_end: number };
      this.emitEvent({
        type: "utterance_end",
        atMs: this.clock.rebase(m.last_word_end),
        detail: { channel: m.channel?.[0] },
      });
    } else if (msg.type === "SpeechStarted") {
      const m = msg as { channel: [number, number]; timestamp: number };
      this.emitEvent({
        type: "speech_started",
        atMs: this.clock.rebase(m.timestamp),
        detail: { channel: m.channel?.[0] },
      });
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type: "KeepAlive" }));
    }, KEEPALIVE_MS);
  }

  private stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  private setState(s: ConnectionState) {
    this._state = s;
  }

  private emitWords(w: Word[]) {
    for (const cb of this.wordCbs) cb(w);
  }

  private emitEvent(e: TranscriberEvent) {
    for (const cb of this.eventCbs) cb(e);
  }
}
