import type { Participant, Word } from "@/lib/analysis/types";
import type { RawMessage, Transcriber, TranscriberConfig, TranscriberEvent } from "../types";

export interface MockOptions {
  /** Playback speed. 2 replays twice as fast as real time. */
  speed?: number;
  /** Fixture time that maps to the moment connect() resolves. */
  originMs?: number;
  /** Delay after a segment's last word ends before its finals arrive. */
  finalLagMs?: number;
  /** A gap longer than this between words on one channel closes a segment. */
  endpointingMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Replays a fixture word list on timers. Each segment (a run of words on one
 * channel with gaps under endpointingMs) first arrives word by word as
 * interims, then once as finals, which mirrors how Deepgram streams.
 * The factory in lib/asr/index.ts picks this provider when VIVA_MOCK_ASR=1.
 */
export class MockTranscriber implements Transcriber {
  private wordCbs: ((w: Word[]) => void)[] = [];
  private eventCbs: ((e: TranscriberEvent) => void)[] = [];
  private rawCbs: ((m: RawMessage) => void)[] = [];
  private timers: Timer[] = [];
  private bytesSent = 0;
  private readonly opts: Required<MockOptions>;

  constructor(
    private readonly words: Word[],
    opts: MockOptions = {},
  ) {
    this.opts = {
      speed: opts.speed ?? 1,
      originMs: opts.originMs ?? 0,
      finalLagMs: opts.finalLagMs ?? 300,
      endpointingMs: opts.endpointingMs ?? 300,
    };
  }

  get framesBytes(): number {
    return this.bytesSent;
  }

  async connect(cfg: TranscriberConfig): Promise<void> {
    const label = (ch: 0 | 1): Participant => cfg.channelMap[String(ch) as "0" | "1"];
    const segments = this.segment(
      // Emit on the session clock, like Deepgram: originMs maps to zero.
      this.words.map((w) => ({
        ...w,
        startMs: w.startMs - this.opts.originMs,
        endMs: w.endMs - this.opts.originMs,
        speakerLabel: label(w.channel),
        pass: 1 as const,
      })),
    );
    this.emitEvent({ type: "open", atMs: 0 });
    for (const seg of segments) {
      seg.forEach((_, i) => {
        const interim = seg.slice(0, i + 1).map((w) => ({ ...w, isFinal: false }));
        this.at(seg[i].endMs, () => this.emitWords(interim));
      });
      const last = seg[seg.length - 1];
      const finals = seg.map((w) => ({ ...w, isFinal: true }));
      this.at(last.endMs + this.opts.finalLagMs, () => this.emitWords(finals));
    }
  }

  sendFrames(buf: ArrayBuffer): void {
    this.bytesSent += buf.byteLength;
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

  async close(): Promise<void> {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.emitEvent({ type: "close", atMs: 0 });
  }

  private at(sessionMs: number, fn: () => void) {
    const delay = Math.max(0, sessionMs / this.opts.speed);
    this.timers.push(setTimeout(fn, delay));
  }

  private segment(words: Word[]): Word[][] {
    const out: Word[][] = [];
    for (const ch of [0, 1] as const) {
      const own = words.filter((w) => w.channel === ch).sort((a, b) => a.startMs - b.startMs);
      let cur: Word[] = [];
      for (const w of own) {
        const prev = cur[cur.length - 1];
        if (prev && w.startMs - prev.endMs > this.opts.endpointingMs) {
          out.push(cur);
          cur = [];
        }
        cur.push(w);
      }
      if (cur.length) out.push(cur);
    }
    return out;
  }

  private emitWords(w: Word[]) {
    // A Deepgram-shaped Results message first, so the raw archive path runs in mock sessions too.
    const data = JSON.stringify({
      type: "Results",
      channel_index: [w[0].channel, 2],
      is_final: w[0].isFinal,
      speech_final: w[0].isFinal,
      start: w[0].startMs / 1000,
      duration: (w[w.length - 1].endMs - w[0].startMs) / 1000,
      channel: {
        alternatives: [
          {
            transcript: w.map((x) => x.punctuatedWord).join(" "),
            words: w.map((x) => ({
              word: x.word,
              punctuated_word: x.punctuatedWord,
              start: x.startMs / 1000,
              end: x.endMs / 1000,
              confidence: x.confidence,
            })),
          },
        ],
      },
    });
    const receivedAtMs = Math.max(...w.map((x) => x.endMs));
    for (const cb of this.rawCbs) cb({ connectionOffsetMs: 0, receivedAtMs, data });
    for (const cb of this.wordCbs) cb(w);
  }

  private emitEvent(e: TranscriberEvent) {
    for (const cb of this.eventCbs) cb(e);
  }
}
