import { tokenOf } from "./tokens";
import { overlapsAny } from "./window";
import type { Channel, Gap, IndexedWord, Participant, Transition, Turn } from "./types";

export type ChannelMap = { "0": Participant; "1": Participant };

const byStart = (a: IndexedWord, b: IndexedWord) => a.startMs - b.startMs || a.channel - b.channel;

/**
 * Builds turns from floor words of both channels. A turn closes only when a
 * partner floor word starts after its last word, or when a transcriber gap
 * (pass one) interrupts it. A same-channel silence of any length stays inside
 * the turn as a pause (RESEARCH_PRINCIPLES.md principle 1; work order 01).
 */
export function buildTurns(floor: IndexedWord[], channelMap: ChannelMap, gaps: Gap[] = []): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const w of [...floor].sort(byStart)) {
    const continues =
      cur !== null && w.channel === cur.channel && !overlapsAny(gaps, cur.endMs, w.startMs);
    if (cur && continues) {
      cur.words.push(w);
      cur.endMs = Math.max(cur.endMs, w.endMs);
    } else {
      if (cur) turns.push(cur);
      cur = {
        channel: w.channel,
        participant: channelMap[String(w.channel) as "0" | "1"],
        words: [w],
        startMs: w.startMs,
        endMs: w.endMs,
      };
    }
  }
  if (cur) turns.push(cur);
  return turns;
}

/**
 * Groups runs of backchannel tokens on one channel with no partner word
 * starting inside the run. Each group is a backchannel candidate.
 */
function candidateGroups(words: IndexedWord[], bc: Set<string>): IndexedWord[][] {
  const groups: IndexedWord[][] = [];
  for (const c of [0, 1] as Channel[]) {
    const own = words.filter((w) => w.channel === c).sort(byStart);
    const partnerStarts = words.filter((w) => w.channel !== c).map((w) => w.startMs);
    let cur: IndexedWord[] = [];
    const flush = () => {
      if (cur.length) groups.push(cur);
      cur = [];
    };
    for (const w of own) {
      if (!bc.has(tokenOf(w.word))) {
        flush();
        continue;
      }
      const prev = cur[cur.length - 1];
      if (prev && partnerStarts.some((s) => s > prev.startMs && s < w.startMs)) flush();
      cur.push(w);
    }
    flush();
  }
  return groups;
}

export interface TurnAnalysis {
  turns: Turn[];
  backchannels: IndexedWord[];
  transitions: Transition[];
}

/**
 * Separates backchannels from floor words, builds turns, and lists the
 * transitions between them. Pass one drops transitions that overlap a gap.
 */
export function analyseTurns(
  attributed: IndexedWord[],
  backchannelTokens: Set<string>,
  channelMap: ChannelMap,
  gaps: Gap[] = [],
  floorLapseMs = 1500,
): TurnAnalysis {
  const groups = candidateGroups(attributed, backchannelTokens);
  const candidateIdx = new Set(groups.flat().map((w) => w.index));
  const firstFloor = attributed.filter((w) => !candidateIdx.has(w.index));
  const firstTurns = buildTurns(firstFloor, channelMap, gaps);

  // A candidate is a backchannel while the partner holds the floor: it sits
  // inside a partner turn and either overlaps the partner's speech or falls in
  // a partner silence shorter than floorLapseMs (turnThresholdMs). A partner
  // silence that long leaves the floor open, so a token there answers: it
  // becomes a one-word floor turn (docs/OPERATIONAL_DEFINITIONS.md).
  const holdsFloor = (g: IndexedWord[]) => {
    const start = g[0].startMs;
    const end = g[g.length - 1].endMs;
    const turn = firstTurns.find(
      (t) => t.channel !== g[0].channel && t.startMs <= start && end <= t.endMs,
    );
    if (!turn) return false;
    const before = turn.words.filter((w) => w.startMs <= start);
    const prev = before[before.length - 1];
    const next = turn.words.find((w) => w.startMs >= end);
    if (!prev || prev.endMs > start || !next) return true;
    return next.startMs - prev.endMs < floorLapseMs;
  };
  const backchannels = groups.filter(holdsFloor).flat();
  const bcIdx = new Set(backchannels.map((w) => w.index));

  const turns =
    backchannels.length === candidateIdx.size
      ? firstTurns
      : buildTurns(
          attributed.filter((w) => !bcIdx.has(w.index)),
          channelMap,
          gaps,
        );

  const transitions: Transition[] = [];
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1];
    const next = turns[i];
    if (prev.channel === next.channel) continue;
    const lo = Math.min(prev.endMs, next.startMs);
    const hi = Math.max(prev.endMs, next.startMs);
    if (overlapsAny(gaps, lo, hi)) continue;
    transitions.push({
      from: prev.participant,
      into: next.participant,
      fromEndMs: prev.endMs,
      toStartMs: next.startMs,
      latencyMs: next.startMs - prev.endMs,
    });
  }
  return { turns, backchannels: backchannels.sort(byStart), transitions };
}

function mergeIntervals(iv: [number, number][]): [number, number][] {
  const s = [...iv].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Intervals where both channels carry attributed words. */
export function overlapIntervals(attributed: IndexedWord[]): [number, number][] {
  const per = [0, 1].map((c) =>
    mergeIntervals(
      attributed
        .filter((w) => w.channel === c)
        .map((w) => [w.startMs, w.endMs] as [number, number]),
    ),
  );
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < per[0].length && j < per[1].length) {
    const lo = Math.max(per[0][i][0], per[1][j][0]);
    const hi = Math.min(per[0][i][1], per[1][j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (per[0][i][1] < per[1][j][1]) i++;
    else j++;
  }
  return mergeIntervals(out);
}
