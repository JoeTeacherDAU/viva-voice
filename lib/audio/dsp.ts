// Signal processing shared by the AudioWorklets and the unit tests.
// No browser APIs here, so vitest can exercise every function directly.

export const CAPTURE_RATE = 48000;
export const ASR_RATE = 16000;
export const FRAME_MS = 20;
export const DBFS_FLOOR = -100;

export function rmsDbfs(samples: ArrayLike<number>, floor = DBFS_FLOOR): number {
  if (samples.length === 0) return floor;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(floor, 20 * Math.log10(rms)) : floor;
}

/** Collects samples into fixed 20 ms frames and reports each frame's dBFS. */
export class EnergyFramer {
  private buf: Float32Array;
  private fill = 0;
  private frames = 0;
  readonly frameSamples: number;

  constructor(sampleRate = CAPTURE_RATE, frameMs = FRAME_MS) {
    this.frameSamples = Math.round((sampleRate * frameMs) / 1000);
    this.buf = new Float32Array(this.frameSamples);
  }

  /** Calls emit(frameIndex, dbfs) for every frame the new samples complete. */
  push(samples: ArrayLike<number>, emit: (frame: number, dbfs: number) => void): void {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.fill++] = samples[i];
      if (this.fill === this.frameSamples) {
        emit(this.frames++, rmsDbfs(this.buf));
        this.fill = 0;
      }
    }
  }
}

/** Blackman-windowed sinc low-pass taps, normalised to unity gain at DC. */
export function lowpassTaps(numTaps: number, cutoffHz: number, sampleRate: number): Float32Array {
  const taps = new Float32Array(numTaps);
  const fc = cutoffHz / sampleRate;
  const mid = (numTaps - 1) / 2;
  let sum = 0;
  for (let n = 0; n < numTaps; n++) {
    const x = n - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const win =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / (numTaps - 1)) +
      0.08 * Math.cos((4 * Math.PI * n) / (numTaps - 1));
    taps[n] = sinc * win;
    sum += taps[n];
  }
  for (let n = 0; n < numTaps; n++) taps[n] /= sum;
  return taps;
}

/**
 * Integer-factor decimator with a windowed-sinc anti-alias filter. Keeps
 * filter history between calls so 128-sample render quanta join seamlessly.
 */
export class Decimator {
  private readonly taps: Float32Array;
  private readonly history: Float32Array;
  private pos = 0;
  private phase = 0;

  constructor(
    readonly factor = CAPTURE_RATE / ASR_RATE,
    numTaps = 63,
    inputRate = CAPTURE_RATE,
  ) {
    // Cut at 90 % of the output Nyquist frequency.
    this.taps = lowpassTaps(numTaps, (inputRate / factor / 2) * 0.9, inputRate);
    this.history = new Float32Array(numTaps);
  }

  process(input: ArrayLike<number>): Float32Array {
    const out: number[] = [];
    const n = this.taps.length;
    for (let i = 0; i < input.length; i++) {
      this.history[this.pos] = input[i];
      this.pos = (this.pos + 1) % n;
      if (++this.phase === this.factor) {
        this.phase = 0;
        let acc = 0;
        // history[pos] is the oldest sample.
        for (let k = 0; k < n; k++) acc += this.taps[k] * this.history[(this.pos + k) % n];
        out.push(acc);
      }
    }
    return Float32Array.from(out);
  }
}

export function floatToInt16(x: number): number {
  const v = Math.max(-1, Math.min(1, x));
  return v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
}

/** Interleaves two equal-length float channels into 16-bit PCM. */
export function interleaveInt16(left: ArrayLike<number>, right: ArrayLike<number>): Int16Array {
  const out = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    out[2 * i] = floatToInt16(left[i]);
    out[2 * i + 1] = floatToInt16(right[i]);
  }
  return out;
}
