import type { Channel, Word } from "@/lib/analysis/types";

/**
 * Talk-time estimate for the live bar (PLAN.md section 9). Interim results
 * replace the channel's previous interims; finals accumulate and clear any
 * interims they cover. The estimate sums word durations per channel.
 */
export class TalkTimeEstimator {
  private finals: [Word[], Word[]] = [[], []];
  private interims: [Word[], Word[]] = [[], []];

  add(batch: Word[]): void {
    for (const ch of [0, 1] as Channel[]) {
      const own = batch.filter((w) => w.channel === ch);
      if (!own.length) continue;
      if (own[0].isFinal) {
        this.finals[ch].push(...own);
        const end = Math.max(...own.map((w) => w.endMs));
        this.interims[ch] = this.interims[ch].filter((w) => w.startMs > end);
      } else {
        this.interims[ch] = own;
      }
    }
  }

  phonationMs(ch: Channel): number {
    return [...this.finals[ch], ...this.interims[ch]].reduce(
      (a, w) => a + (w.endMs - w.startMs),
      0,
    );
  }

  /** Student-on-channel-0 share, or null before anyone speaks. */
  share(): number | null {
    const a = this.phonationMs(0);
    const b = this.phonationMs(1);
    return a + b > 0 ? a / (a + b) : null;
  }
}
