// Synthetic session files for the import tests (work order 02). Tone bursts
// and a low pseudo-random floor only; never a human voice. Each participant
// has a tone frequency, so a test can check which participant a channel
// carries.

import type { ImportEncoding } from "./wavfile";

export const FIXTURE_RATE = 48000;

/** Tone per participant id in the fixture manifest. */
export const FIXTURE_TONES: Record<string, number> = {
  S01: 440,
  S02: 660,
  S03: 550,
  S04: 770,
  S05: 880,
  S06: 990,
};

/** Pair 2 lists S04 on the left and S03 on the right: the swap the tests follow. */
export const FIXTURE_MANIFEST = "order,left_id,right_id\n1,S01,S02\n2,S04,S03\n3,S05,S06\n";

export interface FixtureSpec {
  encoding?: ImportEncoding;
  channels?: number;
  leadMs?: number;
  gapMs?: number;
  /** Pair lengths in frames; odd counts keep the boundaries off round numbers. */
  pairFrames?: number[];
  /** Left and right participant per pair, in recording order. */
  pairs?: [string, string][];
}

export interface Fixture {
  bytes: Uint8Array;
  /** Expected segments, as frame ranges [start, end). */
  segments: { start: number; end: number }[];
  dataOffset: number;
  blockAlign: number;
}

/** Deterministic noise in [-1, 1]. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/**
 * Builds a session WAV: leadMs of digital zero, then each pair separated by
 * gapMs of digital zero. Inside a pair each channel carries a noise floor
 * that never reaches exact zero, tone bursts at that participant's
 * frequency, and one 200 ms stretch of exact zero on both channels, which is
 * shorter than the 500 ms rule and must stay inside the segment.
 */
export function makeSessionFixture(spec: FixtureSpec = {}): Fixture {
  const encoding = spec.encoding ?? "pcm24";
  const channels = spec.channels ?? 2;
  const lead = Math.round(((spec.leadMs ?? 3000) * FIXTURE_RATE) / 1000);
  const gap = Math.round(((spec.gapMs ?? 2000) * FIXTURE_RATE) / 1000);
  const pairFrames = spec.pairFrames ?? [120_007, 148_811, 105_613];
  const pairs = spec.pairs ?? [
    ["S01", "S02"],
    ["S04", "S03"],
    ["S05", "S06"],
  ];
  const bps = encoding === "pcm16" ? 2 : encoding === "pcm24" ? 3 : 4;
  const blockAlign = bps * channels;
  const segments: { start: number; end: number }[] = [];
  let cursor = lead;
  pairFrames.forEach((n, i) => {
    if (i > 0) cursor += gap;
    segments.push({ start: cursor, end: cursor + n });
    cursor += n;
  });
  const frames = cursor;
  const dataBytes = frames * blockAlign;
  const fmtLen = 16;
  const dataOffset = 12 + 8 + fmtLen + 8;
  const bytes = new Uint8Array(dataOffset + dataBytes);
  const v = new DataView(bytes.buffer);
  const ascii = (o: number, s: string) =>
    [...s].forEach((c, i) => (bytes[o + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, fmtLen, true);
  v.setUint16(20, encoding === "float32" ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, FIXTURE_RATE, true);
  v.setUint32(28, FIXTURE_RATE * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bps * 8, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);

  const write = (frame: number, ch: number, x: number) => {
    const o = dataOffset + frame * blockAlign + ch * bps;
    if (encoding === "float32") v.setFloat32(o, x, true);
    else if (encoding === "pcm16") {
      let q = Math.round(x * 32767);
      if (q === 0) q = 1;
      v.setInt16(o, q, true);
    } else {
      let q = Math.round(x * 8388607);
      if (q === 0) q = 1;
      v.setUint8(o, q & 0xff);
      v.setUint8(o + 1, (q >> 8) & 0xff);
      v.setUint8(o + 2, (q >> 16) & 0xff);
    }
  };

  const rand = lcg(20261019);
  segments.forEach((seg, p) => {
    const n = seg.end - seg.start;
    const hush = { start: Math.floor(n / 2), end: Math.floor(n / 2) + FIXTURE_RATE / 5 };
    for (let k = 0; k < n; k++) {
      if (k >= hush.start && k < hush.end) continue; // bytes stay zero on every channel
      const t = k / FIXTURE_RATE;
      // Bursts alternate: left speaks in even half-seconds, right in odd ones.
      const half = Math.floor(t * 2) % 2;
      for (let ch = 0; ch < channels; ch++) {
        const who = pairs[p][Math.min(ch, 1)];
        const hz = FIXTURE_TONES[who] ?? 500;
        const on = half === ch % 2;
        // A quarter-cycle phase keeps the first and last samples off zero.
        const tone = on ? 0.3 * Math.sin(2 * Math.PI * hz * t + Math.PI / 4) : 0;
        let x = tone + 0.001 * rand();
        if (Math.abs(x) < 1e-4) x = x < 0 ? -1e-4 : 1e-4;
        write(seg.start + k, ch, x);
      }
    }
  });
  return { bytes, segments, dataOffset, blockAlign };
}

/** Goertzel power of one frequency in a mono float signal. */
export function tonePower(samples: Float32Array, hz: number, rate = FIXTURE_RATE): number {
  const w = (2 * Math.PI * hz) / rate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s0 = x + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
