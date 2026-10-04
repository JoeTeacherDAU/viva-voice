import { meanDbfs } from "./energy";
import { tokenOf } from "./tokens";
import type { EnergyTrack, RemovedSpan, Word } from "./types";

export const MAX_ONSET_OFFSET_MS = 300;

interface Match {
  i: number; // start index on channel 0
  j: number; // start index on channel 1
  len: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Finds words that one microphone picked up from the other speaker and marks
 * them removedAsCrosstalk (PLAN.md section 7). Returns new word objects and
 * the removed spans. docs/OPERATIONAL_DEFINITIONS.md states the rule.
 */
export function rejectCrosstalk<T extends Word>(
  words: T[],
  energy: EnergyTrack | null,
  gatingMarginDb: number,
): { words: T[]; removed: RemovedSpan[] } {
  const out = words.map((w) => ({ ...w, removedAsCrosstalk: false }));
  const ch: T[][] = [0, 1].map((c) =>
    out.filter((w) => w.channel === c).sort((a, b) => a.startMs - b.startMs),
  );
  const [a, b] = ch;
  const ta = a.map((w) => tokenOf(w.word));
  const tb = b.map((w) => tokenOf(w.word));
  const pairs = (i: number, j: number) =>
    i >= 0 &&
    j >= 0 &&
    i < a.length &&
    j < b.length &&
    ta[i] !== "" &&
    ta[i] === tb[j] &&
    Math.abs(a[i].startMs - b[j].startMs) <= MAX_ONSET_OFFSET_MS;

  const matches: Match[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (!pairs(i, j) || pairs(i - 1, j - 1)) continue; // only maximal runs
      let len = 1;
      while (pairs(i + len, j + len)) len++;
      matches.push({ i, j, len });
    }
  }

  const removed: RemovedSpan[] = [];
  const remove = (run: Word[], channel: 0 | 1, reason: RemovedSpan["reason"]) => {
    if (run.some((w) => w.removedAsCrosstalk)) return;
    for (const w of run) w.removedAsCrosstalk = true;
    removed.push({
      channel,
      startMs: run[0].startMs,
      endMs: run[run.length - 1].endMs,
      words: run.map((w) => w.word),
      reason,
    });
  };

  for (const m of matches) {
    const runA = a.slice(m.i, m.i + m.len);
    const runB = b.slice(m.j, m.j + m.len);
    const lo = Math.min(runA[0].startMs, runB[0].startMs);
    const hi = Math.max(runA[runA.length - 1].endMs, runB[runB.length - 1].endMs);
    const dbA = meanDbfs(energy, 0, lo, hi);
    const dbB = meanDbfs(energy, 1, lo, hi);

    if (m.len >= 2) {
      const earlierA = runA[0].startMs < runB[0].startMs;
      const earlierB = runB[0].startMs < runA[0].startMs;
      const confA = mean(runA.map((w) => w.confidence));
      const confB = mean(runB.map((w) => w.confidence));
      if (earlierA && confA > confB) remove(runB, 1, "sequence");
      else if (earlierB && confB > confA) remove(runA, 0, "sequence");
      else if (dbA !== null && dbB !== null && dbA !== dbB) {
        if (dbA > dbB) remove(runB, 1, "sequence");
        else remove(runA, 0, "sequence");
      } else if (earlierA) remove(runB, 1, "sequence");
      else if (earlierB) remove(runA, 0, "sequence");
    } else if (dbA !== null && dbB !== null && Math.abs(dbA - dbB) >= gatingMarginDb) {
      // A single shared token goes only when one channel is clearly louder.
      if (dbA > dbB) remove(runB, 1, "single");
      else remove(runA, 0, "single");
    }
  }
  removed.sort((x, y) => x.startMs - y.startMs);
  return { words: out, removed };
}
