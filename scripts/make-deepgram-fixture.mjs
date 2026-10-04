#!/usr/bin/env node
// Writes fixtures/deepgram/balanced-stream.json: the multichannel message
// stream Deepgram's live API would send for the balanced golden fixture
// (build-plan P4.5). Each channel's words group into segments at gaps over
// 300 ms (the endpointing setting). Each segment yields a SpeechStarted, one
// interim Results with the first half of its words, one final Results with
// all of them, and an UtteranceEnd. "_atMs" says when a test should deliver
// each message; the adapter ignores it. Timestamps assume the connection
// started at time zero of the fixture WAV.
// Run: node scripts/make-deepgram-fixture.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const words = JSON.parse(readFileSync(join(ROOT, "fixtures/golden/balanced/words.json"), "utf8"));
const s = (ms) => Math.round(ms) / 1000;
const dgWord = (w) => ({
  word: w.word,
  start: s(w.startMs),
  end: s(w.endMs),
  confidence: w.confidence,
  punctuated_word: w.punctuatedWord,
});
const results = (ch, seg, isFinal, speechFinal) => ({
  type: "Results",
  channel_index: [ch, 2],
  duration: s(seg[seg.length - 1].endMs - seg[0].startMs),
  start: s(seg[0].startMs),
  is_final: isFinal,
  speech_final: speechFinal,
  channel: {
    alternatives: [
      {
        transcript: seg.map((w) => w.punctuatedWord).join(" "),
        confidence: seg.reduce((a, w) => a + w.confidence, 0) / seg.length,
        words: seg.map(dgWord),
      },
    ],
  },
});

const messages = [{ _atMs: 0, type: "Metadata", request_id: "fixture-balanced", channels: 2 }];
for (const ch of [0, 1]) {
  const own = words.filter((w) => w.channel === ch).sort((a, b) => a.startMs - b.startMs);
  const segs = [];
  for (const w of own) {
    const cur = segs[segs.length - 1];
    if (cur && w.startMs - cur[cur.length - 1].endMs <= 300) cur.push(w);
    else segs.push([w]);
  }
  for (const seg of segs) {
    const end = seg[seg.length - 1].endMs;
    messages.push({
      _atMs: seg[0].startMs,
      type: "SpeechStarted",
      channel: [ch, 2],
      timestamp: s(seg[0].startMs),
    });
    const half = seg.slice(0, Math.max(1, Math.ceil(seg.length / 2)));
    messages.push({ _atMs: half[half.length - 1].endMs, ...results(ch, half, false, false) });
    messages.push({ _atMs: end + 300, ...results(ch, seg, true, true) });
    messages.push({
      _atMs: end + 1000,
      type: "UtteranceEnd",
      channel: [ch, 2],
      last_word_end: s(end),
    });
  }
}
messages.sort((a, b) => a._atMs - b._atMs);
writeFileSync(
  join(ROOT, "fixtures/deepgram/balanced-stream.json"),
  JSON.stringify(messages, null, 1) + "\n",
);
console.log(`balanced-stream.json: ${messages.length} messages`);
