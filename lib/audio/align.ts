// Offset estimation for onboard recordings (build-plan P7.1). Pure functions,
// so vitest can check them against the golden fixtures.

import { rmsDbfs } from "./dsp";

export const ENVELOPE_FLOOR_DBFS = -70;

/** 20 ms dBFS envelope of mono samples. */
export function envelope(samples: Float32Array, sampleRate: number, frameMs = 20): number[] {
  const step = Math.round((sampleRate * frameMs) / 1000);
  const out: number[] = [];
  for (let i = 0; i + step <= samples.length; i += step)
    out.push(rmsDbfs(samples.subarray(i, i + step)));
  return out;
}

function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) ((re[i] /= n), (im[i] /= n));
}

const prep = (env: number[]) => {
  const c = env.map((x) => Math.max(ENVELOPE_FLOOR_DBFS, x));
  const m = c.reduce((a, b) => a + b, 0) / (c.length || 1);
  return c.map((x) => x - m);
};

/**
 * Finds the lag L (in frames, fractional) that best aligns probe to reference:
 * probe frame j lines up with reference frame j + L. Uses FFT
 * cross-correlation of floor-clipped, mean-removed dB envelopes, then a
 * parabola through the peak and its neighbours for sub-frame precision.
 */
export function bestLag(reference: number[], probe: number[]): { lag: number; score: number } {
  const r = prep(reference);
  const p = prep(probe);
  let n = 1;
  while (n < r.length + p.length) n <<= 1;
  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  const pr = new Float64Array(n);
  const pi = new Float64Array(n);
  r.forEach((x, i) => (rr[i] = x));
  p.forEach((x, i) => (pr[i] = x));
  fft(rr, ri, false);
  fft(pr, pi, false);
  // R * conj(P) gives correlation c[L] = sum_j r[j + L] p[j].
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    cr[k] = rr[k] * pr[k] + ri[k] * pi[k];
    ci[k] = ri[k] * pr[k] - rr[k] * pi[k];
  }
  fft(cr, ci, true);
  const at = (L: number) => cr[((L % n) + n) % n];
  let best = 0;
  let bestVal = -Infinity;
  for (let L = -(p.length - 1); L <= r.length - 1; L++) {
    if (at(L) > bestVal) {
      bestVal = at(L);
      best = L;
    }
  }
  const y0 = at(best - 1);
  const y2 = at(best + 1);
  const denom = y0 - 2 * bestVal + y2;
  const frac = denom < 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const norm = Math.sqrt(r.reduce((a, x) => a + x * x, 0) * p.reduce((a, x) => a + x * x, 0)) || 1;
  return { lag: best + Math.max(-0.5, Math.min(0.5, frac)), score: bestVal / norm };
}

/**
 * Builds the aligned stereo pair: each onboard mono track shifted so its
 * sample 0 lands at startSample in the archived WAV's timeline, padded with
 * silence or cropped to the archived length. channels[0] and channels[1]
 * follow the session's channel map.
 */
export function alignTracks(
  tracks: { samples: Float32Array; startSample: number }[],
  length: number,
): Float32Array[] {
  return tracks.map(({ samples, startSample }) => {
    const out = new Float32Array(length);
    const s0 = Math.round(startSample);
    for (let i = Math.max(0, s0); i < Math.min(length, s0 + samples.length); i++)
      out[i] = samples[i - s0];
    return out;
  });
}
