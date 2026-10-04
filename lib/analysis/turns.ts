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

/** One backchannel candidate and the facts that classify it. */
export interface Candidate {
  words: IndexedWord[];
  channel: Channel;
  /** The candidate overlaps a partner floor word. */
  overlapsPartner: boolean;
  /**
   * Partner silence around the candidate: the partner's next floor word start
   * minus the partner's previous floor word end. Null when the candidate
   * overlaps partner speech or the partner has no floor word on one side.
   */
  partnerSilenceMs: number | null;
  /** The partner's next floor word comes before this student's next floor word. */
  partnerResumesNext: boolean;
  /**
   * "backchannel" while the partner holds the floor; otherwise
   * "standalone_turn" when the run is the student's entire turn, or
   * "turn_part" when it opens or sits inside a longer turn by the same student.
   */
  floorClass: FloorClass;
}

export type FloorClass = "backchannel" | "standalone_turn" | "turn_part";

export interface TurnAnalysis {
  turns: Turn[];
  backchannels: IndexedWord[];
  transitions: Transition[];
  candidates: Candidate[];
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
  // a partner silence shorter than floorLapseMs. A partner silence that long
  // leaves the floor open, so a token there answers: it becomes a one-word
  // floor turn (docs/OPERATIONAL_DEFINITIONS.md). Floor words here are the
  // first-pass floor words, which leave every candidate out.
  const candidates: Candidate[] = groups.map((g) => {
    const ch = g[0].channel;
    const start = g[0].startMs;
    const end = g[g.length - 1].endMs;
    const partner = firstFloor.filter((w) => w.channel !== ch);
    const own = firstFloor.filter((w) => w.channel === ch);
    const overlapsPartner = partner.some((w) => w.startMs < end && start < w.endMs);
    const before = partner.filter((w) => w.startMs <= start);
    const prevP = before[before.length - 1];
    const nextP = partner.find((w) => w.startMs >= end);
    const ownNext = own.find((w) => w.startMs >= end);
    const partnerSilenceMs =
      overlapsPartner || !prevP || !nextP ? null : nextP.startMs - prevP.endMs;
    const inPartnerTurn = firstTurns.some(
      (t) => t.channel !== ch && t.startMs <= start && end <= t.endMs,
    );
    const holdsFloor =
      overlapsPartner || (partnerSilenceMs !== null && partnerSilenceMs < floorLapseMs);
    return {
      words: g,
      channel: ch,
      overlapsPartner,
      partnerSilenceMs,
      partnerResumesNext: !!nextP && (!ownNext || nextP.startMs < ownNext.startMs),
      // Settled below once the final turns exist.
      floorClass: (inPartnerTurn && holdsFloor ? "backchannel" : "turn_part") as FloorClass,
    };
  });
  const backchannels = candidates
    .filter((c) => c.floorClass === "backchannel")
    .flatMap((c) => c.words);
  const bcIdx = new Set(backchannels.map((w) => w.index));

  const turns =
    backchannels.length === candidateIdx.size
      ? firstTurns
      : buildTurns(
          attributed.filter((w) => !bcIdx.has(w.index)),
          channelMap,
          gaps,
        );

  // A non-backchannel run is a standalone turn when its words are the whole turn.
  for (const c of candidates) {
    if (c.floorClass === "backchannel") continue;
    const turn = turns.find((t) => t.words.some((w) => w.index === c.words[0].index));
    c.floorClass = turn && turn.words.length === c.words.length ? "standalone_turn" : "turn_part";
  }

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
  return { turns, backchannels: backchannels.sort(byStart), transitions, candidates };
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
