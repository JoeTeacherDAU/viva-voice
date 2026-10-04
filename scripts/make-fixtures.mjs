#!/usr/bin/env node
// Synthesises the three golden fixtures under fixtures/golden/ (build-plan P1.7).
//
// Each fixture is a hand-authored conversation. The script lays the words out
// on a 20 ms grid, renders two sine-burst "speakers" into a 48 kHz stereo WAV,
// writes analytic energy frames, and computes every tier 1 feature value from
// the authored structure. It never imports lib/analysis. Markers in the text
// carry the answers the pipeline must rediscover from plain words:
//
//   {p400}   a 400 ms silent pause before the next word
//   word+    a word repetition (repeats the word before it)
//   word~    one word of a repeated bigram (mark both words of the second pair)
//   word^    the first word of a false-start fragment
//
// docs/OPERATIONAL_DEFINITIONS.md states every rule used below.
// Run: node scripts/make-fixtures.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures", "golden");
const registry = JSON.parse(readFileSync(join(ROOT, "lib/registry/features.json"), "utf8"));
const TIER1 = registry.features.filter((f) => f.tier === 1);

const SAMPLE_RATE = 48000;
const FRAME_MS = 20;
const WORD_GAP_MS = 40;
const FREQ = { 0: 500, 1: 750 }; // whole cycles in every 20 ms frame
const AMP_OWN = 0.5;
const AMP_BLEED = 0.05; // 20 dB below the wearer

// Hand-assigned syllable counts. Every word the fixtures use appears here.
// Counts follow cmudict where it gives one pronunciation; the proper nouns
// Busan and Daegu follow the orthographic vowel-group rule (two each).
// prettier-ignore
const SYL = {
  a: 1, about: 2, all: 1, best: 1, and: 1, are: 1, at: 1, ate: 1, band: 1, be: 1, beach: 1,
  been: 1, big: 1, books: 1, busan: 2, but: 1, by: 1, cafe: 2, called: 1, can: 1,
  cat: 1, coffee: 2, cold: 1, comics: 2, daegu: 2, day: 1, did: 1, do: 1, eat: 1,
  english: 2, exam: 2, far: 1, fish: 1, fly: 1, food: 1, for: 1, friday: 2, friends: 1,
  from: 1, fun: 1, go: 1, good: 1, great: 1, guitar: 2, has: 1, hate: 1, have: 1,
  hear: 1, here: 1, hobbies: 2, hobby: 2, home: 1, hometown: 2, hot: 1, i: 1, idea: 3,
  if: 1, in: 1, is: 1, it: 1, kid: 1, kids: 1, kind: 1, korean: 3, last: 1, later: 2,
  like: 1, long: 1, lot: 1, love: 1, loves: 1, maybe: 2, me: 1, met: 1, monday: 2,
  more: 1, morning: 2, mostly: 2, music: 2, my: 1, near: 1, need: 1, never: 2, new: 1,
  next: 1, nice: 1, nights: 1, nine: 1, nineties: 2, not: 1, now: 1, of: 1, oh: 1,
  on: 1, one: 1, opens: 2, or: 1, piano: 3, place: 1, play: 1, practice: 2, quiet: 2,
  read: 1, reading: 2, relax: 2, see: 1, she: 1, should: 1, sister: 2, small: 1, so: 1,
  song: 1, songs: 1, sounds: 1, spicy: 2, spring: 1, station: 2, stayed: 1, still: 1,
  story: 2, studied: 2, study: 2, summer: 2, sunday: 2, talk: 1, talked: 1, tell: 1,
  test: 1, thank: 1, that: 1, the: 1, them: 1, then: 1, there: 1, think: 1, thursday: 2,
  time: 1, to: 1, today: 2, too: 1, train: 1, try: 1, two: 1, up: 1, used: 1, very: 2,
  visit: 2, was: 1, water: 2, way: 1, we: 1, week: 1, weekend: 2, welcome: 2, well: 1,
  went: 1, were: 1, what: 1, when: 1, which: 1, who: 1, will: 1, windows: 2, with: 1,
  would: 1, yes: 1, you: 1, your: 1, mhmm: 1, yeah: 1, okay: 2, uh: 1, um: 1, want: 1,
  "that's": 1, really: 2, right: 1, much: 1, noodles: 2, stop: 1,
};

const tok = (s) => s.toLowerCase().replace(/[^a-z0-9'-]/g, "");
const CLAUSE_FINAL = /[.?!,;]$/;
const dur = (word) => {
  const t = tok(word);
  if (t === "uh" || t === "um") return 260;
  if (SYL[t] === undefined) throw new Error(`No syllable count for "${t}"`);
  return 100 + 80 * SYL[t];
};

const BASE_CONFIG = {
  gainDb: 0,
  pauseThresholdsMs: [200, 350],
  turnThresholdMs: 1500,
  floorLapseMs: 1500,
  gatingMarginDb: 6,
  speechFloorDbfs: -60,
  compositeWeights: { silent_pause_rate: 0.5, speech_rate_wpm: 0.25, mean_length_of_run: 0.25 },
  weightsVersion: "1.1",
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
  targetPatterns: ["used to", "would like to"],
  keyterms: [],
};

// ---------------------------------------------------------------- fixtures

const FIXTURES = [
  {
    name: "balanced",
    durationMs: 60000,
    baseline: {
      n: 12,
      weightsVersion: "1.1",
      components: {
        speech_rate_wpm: { mean: 70, sd: 15 },
        silent_pause_rate: { mean: 8, sd: 4 },
        mean_length_of_run: { mean: 5, sd: 1.5 },
      },
    },
    turns: [
      { ch: 0, text: "So, {p260} what did you do last weekend?" },
      {
        ch: 1,
        after: 420,
        text: "I went to Busan with my sister. {p400} We used to go there in the summer when we were kids. {p300} The beach was nice, but the water was um very cold.",
      },
      {
        ch: 0,
        after: 380,
        text: "Oh, nice. I would like to go to Busan too. {p500} Did you eat the the+ fish there?",
      },
      {
        ch: 1,
        after: 460,
        text: "Yes, we ate a lot of fish. {p380} My sister used to {p240} hate fish, but now she loves it. {p700} What did you do?",
      },
      {
        ch: 0,
        after: 300,
        text: "I stayed home and studied for my exam. {p440} I think I~ think~ it went well. {p220} Then on Sunday I met my friends at a cafe.",
      },
      { ch: 1, after: 520, text: "That sounds fun. {p300} Which cafe did you go to?" },
      {
        ch: 0,
        after: -120,
        text: "The new one near the station. {p600} It has big windows and good coffee. {p340} We talked all day.",
      },
      {
        ch: 1,
        after: 400,
        text: "All day? {p280} That is a long time. I would like to try that cafe {p420} next week, maybe with my sister.",
      },
      {
        ch: 0,
        after: 360,
        text: "You should go. {p300} It is quiet in the um morning, so you can study there too.",
      },
      {
        ch: 1,
        after: 600,
        text: "Good idea. {p320} I have a test on Friday, so I need a quiet place to study.",
      },
      {
        ch: 0,
        after: 420,
        text: "We^ uh I can go with you if you want. {p360} The cafe opens at nine.",
      },
      { ch: 1, after: 380, text: "That would be great. {p260} Thank you." },
      { ch: 0, after: 300, text: "See you on Friday then." },
    ],
    backchannels: [
      { ch: 1, turn: 2, pause: 0, word: "mhmm" },
      { ch: 1, turn: 6, pause: 0, word: "yeah" },
    ],
    crosstalk: [
      { hearing: 1, turn: 4, phrase: "my friends", offsetMs: 40, confidence: 0.42 },
      // Case 5: B's backchannel "yeah" also reaches A's microphone 40 ms later.
      { hearing: 0, bc: 1, offsetMs: 40, confidence: 0.35 },
    ],
    gaps: [],
  },
  {
    name: "asymmetric",
    durationMs: 48000,
    baseline: {
      n: 12,
      weightsVersion: "1.1",
      components: {
        speech_rate_wpm: { mean: 70, sd: 15 },
        silent_pause_rate: { mean: 8, sd: 4 },
        mean_length_of_run: { mean: 5, sd: 1.5 },
      },
    },
    turns: [
      {
        ch: 0,
        text: "Today we talk about hobbies. {p300} I play the guitar in a small band with my friends. {p420} We practice on Monday and Thursday nights, and we play songs from the nineties. {p260} I used to play the piano, but the guitar is more fun for me. {p520} What about you, do you have a hobby?",
      },
      { ch: 1, after: 900, text: "Um, I like reading." },
      {
        ch: 0,
        after: 300,
        text: "Reading is {p480} great. {p480} What kind of books do you read?",
      },
      { ch: 1, after: 1100, text: "Mostly comics." },
      {
        ch: 0,
        after: 280,
        text: "Oh, I love comics too. {p460} The best one is a story about a cat who can fly. {p300} I read it when I was a kid, and I still read it now. {p640} Do you read them in Korean or in English?",
      },
      { ch: 1, after: 1000, text: "In Korean." },
      {
        ch: 0,
        after: 320,
        // Cases 2 and 3: backchannel tokens inside a floor turn are ordinary words.
        text: "Yeah, I think that's right. {p300} That is a really good way to relax. {p400} I think we should talk about music now.",
      },
      { ch: 1, after: 1200, text: "Okay." },
      {
        ch: 0,
        after: 300,
        text: "I would like to hear your best song. {p500} Can you tell me one?",
      },
      { ch: 1, after: 1300, text: "Maybe later." },
    ],
    backchannels: [{ ch: 1, turn: 4, pause: 2, word: "mhmm" }],
    crosstalk: [{ hearing: 0, turn: 3, phrase: "Mostly comics.", offsetMs: 60, confidence: 0.38 }],
    gaps: [],
  },
  {
    name: "gappy",
    durationMs: 46000,
    config: { targetPatterns: ["you should"] },
    baseline: {
      n: 8,
      weightsVersion: "1.1",
      components: {
        speech_rate_wpm: { mean: 70, sd: 15 },
        silent_pause_rate: { mean: 8, sd: 4 },
        mean_length_of_run: { mean: 5, sd: 1.5 },
      },
    },
    turns: [
      { ch: 0, text: "Tell me about {p520} your hometown." },
      {
        ch: 1,
        after: 640,
        text: "My hometown is called {p200} uh {p460} Daegu. {p900} It is {p1000} very hot in the summer. {p360} um {p280} And the food is spicy.",
      },
      {
        ch: 0,
        after: 1800,
        text: "I see. {p1400} I have never been to Daegu. {p760} Is it far from here?",
      },
      { ch: 1, after: 3000, text: "Not so far. {p540} You can go {p300} by train." },
      { ch: 1, after: 1700, text: "um {p400} You should visit in the spring." },
      { ch: 0, after: 900, text: "Maybe I will. {p2500} Thank you for {p600} the idea." },
      {
        ch: 1,
        after: 700,
        // Case 6: "uh" followed by 600 ms of silence, "um" followed by 1,200 ms.
        text: "You are welcome. I like the food there uh {p600} very much. um {p1200} The noodles are good.",
      },
      { ch: 0, after: 600, text: "uh {p300} I think {p320} the time is up." },
      // A lone "okay" in a 2,000 ms partner silence (860 + 260 + 880), then the partner resumes.
      { ch: 1, after: 860, text: "Okay." },
      { ch: 0, after: 880, text: "We can stop here." },
    ],
    // The backchannel sits in a 600 ms pause; a partner silence of 1,500 ms or
    // more (like the 2,500 ms one) leaves the floor open and a token there answers.
    backchannels: [{ ch: 1, turn: 5, pause: 1, word: "mhmm" }],
    crosstalk: [],
    // A socket gap inside the 3000 ms silence between turn 2 and turn 3.
    gaps: [{ afterTurn: 2, startOffsetMs: 500, endOffsetMs: 2500 }],
  },
];

// ---------------------------------------------------------------- layout

function parse(text) {
  return text.split(/\s+/).map((raw) => {
    const p = raw.match(/^\{p(\d+)\}$/);
    if (p) return { kind: "pause", ms: Number(p[1]) };
    const m = raw.match(/^(.*?)([+~^]?)$/);
    return {
      kind: "word",
      text: m[1],
      rep: m[2] === "+" ? "word" : m[2] === "~" ? "bigram" : null,
      falseStart: m[2] === "^",
    };
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const isFiller = (t) => BASE_CONFIG.fillerTokens.includes(t);

// Lays out each authored segment, then merges consecutive same-channel
// segments into one turn: a turn closes only when the partner speaks, so the
// silence between such segments becomes a within-turn pause (work order 01).
function layout(fx, startMs) {
  const segments = layoutSegments(fx, startMs);
  const turns = [];
  for (const seg of segments) {
    const cur = turns[turns.length - 1];
    if (cur && cur.channel === seg.channel) {
      const gap = seg.startMs - cur.endMs;
      cur.pauses.push({
        ms: gap,
        startMs: cur.endMs,
        endMs: seg.startMs,
        afterIndex: cur.words.length - 1,
      });
      const offset = cur.words.length;
      cur.pauses.push(...seg.pauses.map((p) => ({ ...p, afterIndex: p.afterIndex + offset })));
      cur.words.push(...seg.words);
      cur.endMs = seg.endMs;
    } else {
      turns.push({ ...seg, words: [...seg.words], pauses: [...seg.pauses] });
    }
  }
  return { turns, segments };
}

function layoutSegments(fx, startMs) {
  const turns = [];
  let prevEnd = null;
  fx.turns.forEach((spec, ti) => {
    const items = parse(spec.text);
    let cursor = ti === 0 ? startMs + 600 : prevEnd + spec.after;
    const words = [];
    const pauses = [];
    let pendingPause = null;
    for (const it of items) {
      if (it.kind === "pause") {
        assert(it.ms % FRAME_MS === 0, `pause ${it.ms} is off the 20 ms grid`);
        pendingPause = it.ms;
        continue;
      }
      if (words.length) {
        const gap = pendingPause ?? WORD_GAP_MS;
        if (pendingPause !== null) {
          pauses.push({
            ms: gap,
            startMs: cursor,
            endMs: cursor + gap,
            afterIndex: words.length - 1,
          });
        }
        cursor += gap;
      }
      pendingPause = null;
      const d = dur(it.text);
      words.push({
        ...it,
        token: tok(it.text),
        startMs: cursor,
        endMs: cursor + d,
        channel: spec.ch,
      });
      cursor += d;
    }
    const turn = {
      index: ti,
      channel: spec.ch,
      after: ti === 0 ? null : spec.after,
      words,
      pauses,
    };
    turn.startMs = words[0].startMs;
    turn.endMs = words[words.length - 1].endMs;
    turns.push(turn);
    prevEnd = turn.endMs;
  });
  return turns;
}

// ---------------------------------------------------------------- oracle

function prunedTokens(turn) {
  // Remove fillers and marked repetitions. A backchannel-token word inside a
  // turn is an ordinary word and stays (work order 01, section 2); authored
  // backchannels never sit in turns. The markers come from the authored text.
  return turn.words.filter((w) => !isFiller(w.token) && !w.rep).map((w) => w.token);
}

function repetitionCount(turn) {
  const word = turn.words.filter((w) => w.rep === "word").length;
  const bigram = turn.words.filter((w) => w.rep === "bigram").length / 2;
  return word + bigram;
}

function mattr(tokens, win = 50) {
  if (tokens.length < win) return null;
  let sum = 0;
  const n = tokens.length - win + 1;
  for (let i = 0; i < n; i++) sum += new Set(tokens.slice(i, i + win)).size / win;
  return sum / n;
}

function mtldOneWay(tokens, threshold = 0.72) {
  let factors = 0;
  let types = new Set();
  let count = 0;
  let ttr = 1;
  for (const t of tokens) {
    count++;
    types.add(t);
    ttr = types.size / count;
    if (ttr <= threshold) {
      factors++;
      types = new Set();
      count = 0;
      ttr = 1;
    }
  }
  if (count > 0) factors += (1 - ttr) / (1 - threshold);
  return factors === 0 ? null : tokens.length / factors;
}

function mtld(tokens) {
  if (tokens.length === 0) return null;
  const f = mtldOneWay(tokens);
  const b = mtldOneWay([...tokens].reverse());
  return f === null || b === null ? null : (f + b) / 2;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const perMin = (count, ms) => (ms > 0 ? count / (ms / 60000) : null);
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

function targetHits(words, patterns) {
  // Token-array matching, independent of the pipeline's regex route.
  const hits = [];
  for (const p of patterns) {
    const pt = p.split(/\s+/).map(tok);
    for (let i = 0; i + pt.length <= words.length; i++) {
      if (pt.every((t, k) => words[i + k].token === t)) {
        hits.push({ pattern: p, startMs: words[i].startMs, endMs: words[i + pt.length - 1].endMs });
      }
    }
  }
  return hits.sort((a, b) => a.startMs - b.startMs);
}

function compute(fx, turns, bcs, crossCopies, config, markers, gaps) {
  const windowMs = markers.stopMs - markers.startMs;
  const values = [];
  const push = (featureId, participant, pass, thresholdMs, value, extra = {}) => {
    const def = TIER1.find((f) => f.id === featureId);
    assert(def, `unknown tier 1 id ${featureId}`);
    values.push({
      featureId,
      participant,
      pass,
      window: "full",
      thresholdMs,
      value,
      unit: def.unit,
      ...extra,
    });
  };
  const label = (ch) => (ch === 0 ? "A" : "B");
  const allWordsOn = (ch) =>
    [
      ...turns.filter((t) => t.channel === ch).flatMap((t) => t.words),
      ...bcs.filter((b) => b.channel === ch),
    ].sort((a, b) => a.startMs - b.startMs);

  // Transitions come straight from the authored "after" values.
  const transitions = [];
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].channel !== turns[i - 1].channel) {
      transitions.push({
        into: turns[i].channel,
        latency: turns[i].after,
        fromEnd: turns[i - 1].endMs,
        toStart: turns[i].startMs,
      });
    }
  }
  const overlapTransitions = transitions.filter((t) => t.latency < 0);
  const overlapCount = overlapTransitions.length;
  const overlapMs = overlapTransitions.reduce((a, t) => a - t.latency, 0);

  // Energy arithmetic: speech frames are the union of every attributed word
  // interval; unattributed frames are exactly the overlap intervals.
  const totalWordMs = [...turns.flatMap((t) => t.words), ...bcs].reduce(
    (a, w) => a + (w.endMs - w.startMs),
    0,
  );
  const speechFrames = (totalWordMs - overlapMs) / FRAME_MS;
  const unattributedFrames = overlapMs / FRAME_MS;
  const unattributedRatio = unattributedFrames / speechFrames;

  const perPass = {};
  for (const pass of [1, 2]) {
    perPass[pass] = {};
    for (const ch of [0, 1]) {
      const own = turns.filter((t) => t.channel === ch);
      const pruned = own.flatMap(prunedTokens);
      const raw = allWordsOn(ch);
      const phon = (T) =>
        own.reduce((a, t) => a + (t.endMs - t.startMs), 0) -
        own
          .flatMap((t) => t.pauses)
          .filter((p) => p.ms >= T)
          .reduce((a, p) => a + p.ms, 0);
      perPass[pass][ch] = { pruned, phon, own, raw };
    }
  }

  for (const pass of [1, 2]) {
    const gapMs = pass === 1 ? gaps.reduce((a, g) => a + (g.endMs - g.startMs), 0) : 0;
    const effWindow = windowMs - gapMs;
    for (const ch of [0, 1]) {
      const P = label(ch);
      const { pruned, phon, own, raw } = perPass[pass][ch];
      const partner = perPass[pass][1 - ch];
      const allPauses = own.flatMap((t) => t.pauses.map((p) => ({ ...p, turn: t })));

      const sr = perMin(pruned.length, effWindow);
      push("speech_rate_wpm", P, pass, null, sr);
      push("speech_rate_raw_wpm", P, pass, null, perMin(raw.length, effWindow));

      const syl = pruned.reduce((a, t) => a + SYL[t], 0);
      push(
        "articulation_rate_sps_est",
        P,
        pass,
        350,
        pass === 2 && phon(350) > 0 ? syl / (phon(350) / 1000) : null,
      );

      for (const T of config.pauseThresholdsMs) {
        const ps = allPauses.filter((p) => p.ms >= T);
        push("articulation_rate_wpm", P, pass, T, perMin(pruned.length, phon(T)));
        push("phonation_time_ratio", P, pass, T, effWindow > 0 ? phon(T) / effWindow : null);
        push("silent_pause_rate", P, pass, T, perMin(ps.length, phon(T)));
        push("silent_pause_mean_ms", P, pass, T, mean(ps.map((p) => p.ms)));
        push(
          "silent_pause_max_ms",
          P,
          pass,
          T,
          ps.length ? Math.max(...ps.map((p) => p.ms)) : null,
        );
        const endClause = ps.filter((p) => CLAUSE_FINAL.test(p.turn.words[p.afterIndex].text));
        push("silent_pause_end_clause_count", P, pass, T, endClause.length);
        push("silent_pause_mid_clause_count", P, pass, T, ps.length - endClause.length);
        // Runs: split each turn's words at pauses >= T.
        const runs = [];
        for (const t of own) {
          let cur = [];
          t.words.forEach((w, i) => {
            cur.push(w);
            const p = t.pauses.find((q) => q.afterIndex === i);
            if (p && p.ms >= T) {
              runs.push(cur);
              cur = [];
            }
          });
          runs.push(cur);
        }
        const runLens = runs.map((r) => prunedTokens({ words: r }).length).filter((n) => n > 0);
        push("mean_length_of_run", P, pass, T, mean(runLens));
        // Raw twins and pauses by location (work order 01, sections 2 and 3).
        push("articulation_rate_raw_wpm", P, pass, T, perMin(raw.length, phon(T)));
        push("mean_length_of_run_raw", P, pass, T, mean(runs.map((r) => r.length)));
        const mids = ps.filter((p) => !CLAUSE_FINAL.test(p.turn.words[p.afterIndex].text));
        const ends = ps.filter((p) => CLAUSE_FINAL.test(p.turn.words[p.afterIndex].text));
        push("silent_pause_mid_clause_rate", P, pass, T, perMin(mids.length, phon(T)));
        push("silent_pause_end_clause_rate", P, pass, T, perMin(ends.length, phon(T)));
        push("silent_pause_mid_clause_mean_ms", P, pass, T, mean(mids.map((p) => p.ms)));
        push("silent_pause_end_clause_mean_ms", P, pass, T, mean(ends.map((p) => p.ms)));
        // The synthetic audio is silent exactly in the authored gaps, so the
        // acoustic pauses inside a turn are the authored pauses.
        push("acoustic_pause_rate", P, pass, T, perMin(ps.length, effWindow));
      }

      const fillers = raw.filter((w) => isFiller(w.token)).length;
      push("filled_pause_count", P, pass, null, fillers);
      push("filled_pause_rate", P, pass, 350, perMin(fillers, phon(350)));
      push(
        "repetition_count",
        P,
        pass,
        null,
        own.reduce((a, t) => a + repetitionCount(t), 0),
      );
      push(
        "false_start_count",
        P,
        pass,
        null,
        pass === 2 ? own.flatMap((t) => t.words).filter((w) => w.falseStart).length : null,
      );

      push("turn_count", P, pass, null, own.length);
      push("mean_turn_length_words", P, pass, null, mean(own.map((t) => prunedTokens(t).length)));
      const mine = phon(350);
      const theirs = partner.phon(350);
      push("talk_time_share", P, pass, 350, mine + theirs > 0 ? mine / (mine + theirs) : null);

      const lat = transitions
        .filter((t) => t.into === ch)
        .filter(
          (t) =>
            pass === 2 ||
            !gaps.some((g) =>
              overlaps(
                g.startMs,
                g.endMs,
                Math.min(t.fromEnd, t.toStart),
                Math.max(t.fromEnd, t.toStart),
              ),
            ),
        )
        .map((t) => t.latency);
      push("response_latency_mean_ms", P, pass, null, mean(lat));
      push("response_latency_median_ms", P, pass, null, median(lat));
      push("overlap_count", P, pass, null, overlapCount);
      push("overlap_duration_ms", P, pass, null, overlapMs);
      push("backchannel_count", P, pass, null, bcs.filter((b) => b.channel === ch).length);
      push(
        "question_count",
        P,
        pass,
        null,
        own.filter((t) => t.words[t.words.length - 1].text.endsWith("?")).length,
      );

      push("mattr", P, pass, null, mattr(pruned));
      push("mtld", P, pass, null, mtld(pruned));
      const hits = targetHits(raw, config.targetPatterns);
      push("target_structure_hits", P, pass, null, hits.length, { spans: hits });

      push("unattributed_frame_ratio", P, pass, null, unattributedRatio);
      push(
        "crosstalk_removed_words",
        P,
        pass,
        null,
        crossCopies.filter((c) => c.channel === ch).length,
      );
      push("mean_word_confidence", P, pass, null, mean(raw.map((w) => w.confidence)));

      push(
        "long_pause_count",
        P,
        pass,
        null,
        allPauses.filter((p) => p.ms >= config.turnThresholdMs).length,
      );
      push("uh_count", P, pass, null, raw.filter((w) => w.token === "uh").length);
      push("um_count", P, pass, null, raw.filter((w) => w.token === "um").length);
      // Fillers by location, and the silence that follows each one in its turn.
      const fillerEvents = [];
      for (const t of own) {
        t.words.forEach((w, i) => {
          if (!isFiller(w.token)) return;
          const before = t.words.slice(0, i).filter((x) => !isFiller(x.token));
          const prev = before[before.length - 1];
          const next = t.words[i + 1];
          fillerEvents.push({
            end: !prev || CLAUSE_FINAL.test(prev.text),
            after: next ? next.startMs - w.endMs : null,
          });
        });
      }
      push(
        "filled_pause_mid_clause_count",
        P,
        pass,
        null,
        fillerEvents.filter((f) => !f.end).length,
      );
      push(
        "filled_pause_end_clause_count",
        P,
        pass,
        null,
        fillerEvents.filter((f) => f.end).length,
      );
      push(
        "silence_after_filler_mean_ms",
        P,
        pass,
        null,
        mean(fillerEvents.map((f) => f.after).filter((x) => x !== null)),
      );
      push("mattr_raw", P, pass, null, mattr(raw.map((w) => w.token)));
      // Backchannel candidates: runs of backchannel tokens on one channel with no
      // partner word starting inside. Count the runs that form a whole turn and
      // sit in a partner silence of floorLapseMs or more, using floor words that
      // leave every candidate out.
      const everyWord = [...turns.flatMap((t) => t.words), ...bcs].sort(
        (a, b) => a.startMs - b.startMs,
      );
      const isBc = (w) => config.backchannelTokens.includes(w.token);
      const candidates = [];
      for (const c of [0, 1]) {
        let run = [];
        for (const w of everyWord) {
          if (w.channel !== c) {
            if (run.length && w.startMs > run[run.length - 1].startMs) {
              candidates.push(run);
              run = [];
            }
            continue;
          }
          if (isBc(w)) run.push(w);
          else if (run.length) {
            candidates.push(run);
            run = [];
          }
        }
        if (run.length) candidates.push(run);
      }
      const inCandidate = new Set(candidates.flat());
      const floorWords = everyWord.filter((w) => !inCandidate.has(w));
      let openFloor = 0;
      for (const run of candidates.filter((r) => r[0].channel === ch)) {
        // Only a run that forms the student's whole authored turn counts.
        const turn = turns.find((t) => t.words.includes(run[0]));
        if (!turn || turn.words.length !== run.length) continue;
        const start = run[0].startMs;
        const end = run[run.length - 1].endMs;
        const partner = floorWords.filter((w) => w.channel !== ch);
        if (partner.some((w) => w.startMs < end && start < w.endMs)) continue;
        const prev = partner.filter((w) => w.startMs <= start).pop();
        const next = partner.find((w) => w.startMs >= end);
        if (prev && next && next.startMs - prev.endMs >= config.floorLapseMs) openFloor++;
      }
      push("open_floor_response_count", P, pass, null, openFloor);
      const lowest = Math.min(...config.pauseThresholdsMs);
      push(
        "asr_acoustic_pause_agreement",
        P,
        pass,
        lowest,
        allPauses.some((p) => p.ms >= lowest) ? 1 : null,
      );
    }
  }

  // Composite and pass agreement need the per-pass values above.
  const find = (id, P, pass, T = null) =>
    values.find(
      (v) => v.featureId === id && v.participant === P && v.pass === pass && v.thresholdMs === T,
    ).value;
  for (const pass of [1, 2]) {
    for (const P of ["A", "B"]) {
      const b = fx.baseline;
      let ci = null;
      if (
        b.n >= config.baselineMinSessions &&
        (b.weightsVersion ?? "1.0") === config.weightsVersion
      ) {
        const sr = find("speech_rate_wpm", P, pass);
        // Weights version 1.1: the pause component is the mid-clause rate.
        const pr = find("silent_pause_mid_clause_rate", P, pass, 350);
        const mlr = find("mean_length_of_run", P, pass, 350);
        if (sr !== null && pr !== null && mlr !== null) {
          const z = (x, c) => (x - b.components[c].mean) / b.components[c].sd;
          const w = config.compositeWeights;
          ci =
            w.silent_pause_rate * -z(pr, "silent_pause_rate") +
            w.speech_rate_wpm * z(sr, "speech_rate_wpm") +
            w.mean_length_of_run * z(mlr, "mean_length_of_run");
        }
      }
      push("composite_fluency_index", P, pass, null, ci);
      push(
        "pass_agreement_speech_rate",
        P,
        pass,
        null,
        pass === 2 ? Math.abs(find("speech_rate_wpm", P, 1) - find("speech_rate_wpm", P, 2)) : null,
      );
    }
  }
  return { values, transitions, unattributedFrames, speechFrames };
}

// ---------------------------------------------------------------- checks

// These checks guard the authoring. They never feed an expected value.
function validate(fx, turns, bcs, crossCopies, markers) {
  const all = [...turns.flatMap((t) => t.words), ...bcs, ...crossCopies];
  for (const w of all) {
    assert(
      w.startMs % FRAME_MS === 0 && w.endMs % FRAME_MS === 0,
      `${fx.name}: "${w.text}" off grid`,
    );
    assert(
      w.startMs >= markers.startMs && w.endMs <= markers.stopMs,
      `${fx.name}: "${w.text}" at ${w.endMs} outside window ending ${markers.stopMs}`,
    );
  }
  for (const ch of [0, 1]) {
    const own = all.filter((w) => w.channel === ch).sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < own.length; i++) {
      assert(
        own[i].startMs >= own[i - 1].endMs,
        `${fx.name}: words collide on channel ${ch} at ${own[i].startMs}`,
      );
    }
  }
  // Pauses of any length stay inside a turn, and a backchannel-token word in a
  // turn is an ordinary word, so neither needs an authoring guard (work order 01).
  for (let i = 1; i < turns.length; i++) {
    const a = turns[i - 1];
    const b = turns[i];
    assert(a.channel !== b.channel, `${fx.name}: layout left two same-channel turns adjacent`);
    if (b.after < 0) {
      assert(
        b.startMs > a.words[a.words.length - 1].startMs,
        `${fx.name}: overlap at turn ${i} reorders words`,
      );
      assert(
        -b.after < b.words[0].endMs - b.words[0].startMs,
        `${fx.name}: overlap at turn ${i} spans more than one word`,
      );
    }
  }
  // Cross-channel intersections must come only from the authored overlaps.
  const attributed = [...turns.flatMap((t) => t.words), ...bcs];
  let inter = 0;
  for (const a of attributed.filter((w) => w.channel === 0)) {
    for (const b of attributed.filter((w) => w.channel === 1)) {
      const lo = Math.max(a.startMs, b.startMs);
      const hi = Math.min(a.endMs, b.endMs);
      if (hi > lo) inter += hi - lo;
    }
  }
  const authored = turns.filter((t, i) => i > 0 && t.after < 0).reduce((s, t) => s - t.after, 0);
  assert(
    inter === authored,
    `${fx.name}: ${inter} ms of cross-channel overlap but ${authored} ms authored`,
  );
  // Repetition and false-start markers must match what a plain reader sees.
  for (const t of turns) {
    const nf = t.words.filter((w) => !isFiller(w.token));
    nf.forEach((w, i) => {
      const wordRep = i > 0 && nf[i - 1].token === w.token;
      assert(
        wordRep === (w.rep === "word"),
        `${fx.name}: repetition marker mismatch at "${w.text}"`,
      );
    });
    for (let i = 3; i < nf.length; i++) {
      const bigram =
        nf[i - 1].token === nf[i - 3].token &&
        nf[i].token === nf[i - 2].token &&
        nf[i].token !== nf[i - 1].token;
      if (bigram)
        assert(
          nf[i].rep === "bigram" && nf[i - 1].rep === "bigram",
          `${fx.name}: unmarked bigram repetition at "${nf[i].text}"`,
        );
    }
  }
}

// ---------------------------------------------------------------- output

function writeWav(path, totalMs, attributed) {
  const n = (totalMs / 1000) * SAMPLE_RATE;
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (const w of attributed) {
    const s0 = (w.startMs / 1000) * SAMPLE_RATE;
    const s1 = (w.endMs / 1000) * SAMPLE_RATE;
    const f = FREQ[w.channel];
    for (let s = s0; s < s1; s++) {
      const v = Math.sin((2 * Math.PI * f * s) / SAMPLE_RATE);
      ch[w.channel][s] += AMP_OWN * v;
      ch[1 - w.channel][s] += AMP_BLEED * v;
    }
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, ch[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), 44 + i * 4 + c * 2);
    }
  }
  writeFileSync(path, buf);
}

function energy(totalMs, attributed) {
  // Analytic dBFS per frame: a sine of amplitude a has RMS a / sqrt(2), and
  // the two speakers' tones are orthogonal over a frame, so powers add.
  const frames = totalMs / FRAME_MS;
  const active = [new Uint8Array(frames), new Uint8Array(frames)];
  for (const w of attributed) {
    for (let k = w.startMs / FRAME_MS; k < w.endMs / FRAME_MS; k++) active[w.channel][k] = 1;
  }
  const db = (p) => (p > 0 ? Math.round(10 * Math.log10(p) * 100) / 100 : -100);
  const out = { frameMs: FRAME_MS, startMs: 0, channels: [[], []] };
  for (let k = 0; k < frames; k++) {
    const a = active[0][k];
    const b = active[1][k];
    out.channels[0].push(db((a * AMP_OWN ** 2 + b * AMP_BLEED ** 2) / 2));
    out.channels[1].push(db((a * AMP_BLEED ** 2 + b * AMP_OWN ** 2) / 2));
  }
  return out;
}

function confidenceFor(ch, i) {
  return ch === 0 ? 0.84 + 0.02 * (i % 6) : 0.8 + 0.03 * (i % 5);
}

function build(fx) {
  const startMs = 1000;
  const markers = { startMs, stopMs: startMs + fx.durationMs };
  const config = { ...BASE_CONFIG, ...(fx.config ?? {}), durationMs: fx.durationMs };
  const { turns, segments } = layout(fx, startMs);

  const bcs = fx.backchannels.map((b) => {
    const p = segments[b.turn].pauses[b.pause];
    const d = dur(b.word);
    const s = p.startMs + Math.round((p.ms - d) / 2 / FRAME_MS) * FRAME_MS;
    assert(
      s - p.startMs >= 60 && p.endMs - (s + d) >= 60,
      `${fx.name}: backchannel does not fit its pause`,
    );
    assert(
      p.ms < BASE_CONFIG.floorLapseMs,
      `${fx.name}: a backchannel in a ${p.ms} ms pause would answer rather than backchannel`,
    );
    return {
      kind: "word",
      text: b.word,
      token: tok(b.word),
      startMs: s,
      endMs: s + d,
      channel: b.ch,
      rep: null,
      falseStart: false,
    };
  });

  const crossCopies = fx.crosstalk.flatMap((c) => {
    if (c.bc !== undefined) {
      // A single backchannel word that the other microphone also picked up.
      const w = bcs[c.bc];
      return [
        {
          ...w,
          channel: c.hearing,
          startMs: w.startMs + c.offsetMs,
          endMs: w.endMs + c.offsetMs,
          confidence: c.confidence,
          crosstalk: true,
        },
      ];
    }
    const t = segments[c.turn];
    const phrase = c.phrase.split(/\s+/);
    const at = t.words.findIndex((_, i) => phrase.every((p, k) => t.words[i + k]?.text === p));
    assert(at >= 0, `${fx.name}: cross-talk phrase "${c.phrase}" not found`);
    return phrase.map((_, k) => {
      const w = t.words[at + k];
      return {
        ...w,
        channel: c.hearing,
        startMs: w.startMs + c.offsetMs,
        endMs: w.endMs + c.offsetMs,
        confidence: c.confidence,
        crosstalk: true,
      };
    });
  });

  const gaps = fx.gaps.map((g) => ({
    startMs: segments[g.afterTurn].endMs + g.startOffsetMs,
    endMs: segments[g.afterTurn].endMs + g.endOffsetMs,
    nextStart: segments[g.afterTurn + 1].startMs,
  }));
  for (const g of gaps) assert(g.endMs < g.nextStart, `${fx.name}: gap overlaps speech`);
  for (const g of gaps) delete g.nextStart;

  validate(fx, turns, bcs, crossCopies, markers);

  // Confidence by channel order of attributed words.
  const attributed = [...turns.flatMap((t) => t.words), ...bcs].sort(
    (a, b) => a.startMs - b.startMs,
  );
  const counters = [0, 0];
  for (const w of attributed)
    w.confidence = Math.round(confidenceFor(w.channel, counters[w.channel]++) * 100) / 100;

  const result = compute(fx, turns, bcs, crossCopies, config, markers, gaps);

  const label = (ch) => (ch === 0 ? "A" : "B");
  const words = [...attributed, ...crossCopies]
    .sort((a, b) => a.startMs - b.startMs || a.channel - b.channel)
    .map((w) => ({
      word: w.token,
      punctuatedWord: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      confidence: w.confidence,
      channel: w.channel,
      isFinal: true,
      pass: 2,
      removedAsCrosstalk: false,
      speakerLabel: label(w.channel),
    }));

  const session = {
    id: `fixture-${fx.name}`,
    examId: "fixture-exam",
    state: "closing",
    participantIds: { A: "FIX-A", B: "FIX-B" },
    channelMap: { 0: "A", 1: "B" },
    config,
    markers,
    events: gaps.map((g) => ({
      type: "gap",
      atMs: g.startMs,
      detail: { startMs: g.startMs, endMs: g.endMs },
    })),
    instructorLiveScore: null,
    passes: {},
    pipelineVersion: "1.0.0",
    deepgramModel: "fixture",
    firmware: { tx: "synthetic", rx: "synthetic" },
    createdAt: "2026-10-04T00:00:00.000Z",
  };

  const dir = join(OUT, fx.name);
  mkdirSync(dir, { recursive: true });
  const totalMs = markers.stopMs + 1000;
  writeWav(join(dir, "stereo.wav"), totalMs, attributed);
  writeFileSync(join(dir, "energy.json"), JSON.stringify(energy(totalMs, attributed)) + "\n");
  writeFileSync(join(dir, "words.json"), JSON.stringify(words, null, 1) + "\n");
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2) + "\n");
  writeFileSync(join(dir, "baseline.json"), JSON.stringify(fx.baseline, null, 2) + "\n");
  const expected = {
    fixture: fx.name,
    generatedBy: "scripts/make-fixtures.mjs",
    registryVersion: registry.registryVersion,
    tolerance: { rateRelative: 0.005, countAbsolute: 0, msAbsolute: 1 },
    structure: {
      turns: turns.map((t) => ({
        channel: t.channel,
        startMs: t.startMs,
        endMs: t.endMs,
        prunedWords: prunedTokens(t).length,
        pauses: t.pauses.map((p) => p.ms),
      })),
      transitions: result.transitions,
      backchannels: bcs.map((b) => ({ channel: b.channel, startMs: b.startMs, endMs: b.endMs })),
      crosstalkRemoved: crossCopies.map((c) => ({
        channel: c.channel,
        startMs: c.startMs,
        word: c.token,
      })),
      gaps,
      speechFrames: result.speechFrames,
      unattributedFrames: result.unattributedFrames,
    },
    values: result.values,
  };
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 1) + "\n");

  const lastEnd = Math.max(...attributed.map((w) => w.endMs));
  const pr = (ch) => turns.filter((t) => t.channel === ch).flatMap(prunedTokens).length;
  console.log(
    `${fx.name}: ${words.length} words, last word ends ${lastEnd} ms of window end ${markers.stopMs}; pruned A=${pr(0)} B=${pr(1)}; ${result.values.length} expected values`,
  );
}

for (const fx of FIXTURES) build(fx);
