import type { Gap } from "@/lib/analysis/types";

/**
 * Session clock for the live pass (PLAN.md section 6.1). Zero is the Start
 * marker. capturedMs counts every audio chunk handed to the transcriber,
 * including chunks dropped while the socket is down, so it tracks real time.
 * Each connection records the session time of its first sent chunk; Deepgram
 * timestamps count from that chunk, so session time = offset + Deepgram time.
 */
export class SessionClock {
  private captured = 0;
  private offset: number | null = null;
  private droppedAt: number | null = null;

  get capturedMs(): number {
    return this.captured;
  }

  /** Session-clock offset of the current connection, or null before its first chunk. */
  get connectionOffsetMs(): number | null {
    return this.offset;
  }

  /**
   * Records one chunk. When sent is true and this is the connection's first
   * chunk, fixes the connection offset and returns the gap since the last
   * drop, if any.
   */
  advance(ms: number, sent: boolean): Gap | null {
    let gap: Gap | null = null;
    if (sent && this.offset === null) {
      this.offset = this.captured;
      if (this.droppedAt !== null && this.captured > this.droppedAt) {
        gap = { startMs: this.droppedAt, endMs: this.captured };
      }
      this.droppedAt = null;
    }
    this.captured += ms;
    return gap;
  }

  /** The socket dropped: later audio is lost until a new connection sends. */
  drop(): void {
    if (this.droppedAt === null) this.droppedAt = this.captured;
    this.offset = null;
  }

  /** Converts a Deepgram timestamp (seconds on this connection) to session ms. */
  rebase(deepgramSeconds: number): number {
    return (this.offset ?? 0) + Math.round(deepgramSeconds * 1000);
  }
}

/** Duration of interleaved 16-bit stereo PCM at the given rate. */
export function pcmDurationMs(byteLength: number, sampleRate = 16000, channels = 2): number {
  return (byteLength / (2 * channels) / sampleRate) * 1000;
}
