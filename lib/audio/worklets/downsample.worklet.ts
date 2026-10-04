import { Decimator, interleaveInt16 } from "../dsp";

export interface PcmMessage {
  type: "pcm16k" | "raw48k";
  /** Interleaved 16-bit stereo PCM. */
  buf: ArrayBuffer;
  /** Index of the first sample frame in this chunk, at the chunk's rate. */
  startFrame: number;
}

export interface DoneMessage {
  type: "done";
  frames: number;
}

/** Sent once: AudioContext time (ms) of the first raw sample frame. */
export interface StartMessage {
  type: "start";
  atMs: number;
}

interface Options {
  /** Stop the raw tee after this many 48 kHz frames. */
  maxFrames?: number;
}

const CHUNK_MS = 100;

/**
 * Takes the stereo input, posts 100 ms chunks of 16 kHz interleaved PCM for
 * the Deepgram socket, and 100 ms chunks of raw 48 kHz interleaved PCM for the
 * IndexedDB buffer and the WAV.
 */
class DownsampleProcessor extends AudioWorkletProcessor {
  private dec = [new Decimator(), new Decimator()];
  private raw: [number[], number[]] = [[], []];
  private low: [number[], number[]] = [[], []];
  private rawSent = 0;
  private lowSent = 0;
  private readonly rawChunk = (sampleRate * CHUNK_MS) / 1000;
  private readonly lowChunk = this.rawChunk / 3;
  private readonly maxFrames: number;
  private done = false;
  private started = false;

  constructor(options?: { processorOptions?: unknown }) {
    super(options);
    this.maxFrames = (options?.processorOptions as Options | undefined)?.maxFrames ?? Infinity;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0 || this.done) return !this.done;
    const left = input[0];
    const right = input[1] ?? input[0];
    if (!this.started) {
      this.started = true;
      this.port.postMessage({
        type: "start",
        atMs: (currentFrame / sampleRate) * 1000,
      } satisfies StartMessage);
    }

    for (let i = 0; i < left.length; i++) {
      this.raw[0].push(left[i]);
      this.raw[1].push(right[i]);
    }
    const dl = this.dec[0].process(left);
    const dr = this.dec[1].process(right);
    for (let i = 0; i < dl.length; i++) {
      this.low[0].push(dl[i]);
      this.low[1].push(dr[i]);
    }

    while (this.raw[0].length >= this.rawChunk) this.flushRaw(this.rawChunk);
    while (this.low[0].length >= this.lowChunk) {
      const l = this.low[0].splice(0, this.lowChunk);
      const r = this.low[1].splice(0, this.lowChunk);
      const buf = interleaveInt16(l, r).buffer as ArrayBuffer;
      this.port.postMessage(
        { type: "pcm16k", buf, startFrame: this.lowSent } satisfies PcmMessage,
        [buf],
      );
      this.lowSent += l.length;
    }
    return !this.done;
  }

  private flushRaw(n: number) {
    const take = Math.min(n, this.maxFrames - this.rawSent);
    const l = this.raw[0].splice(0, n).slice(0, take);
    const r = this.raw[1].splice(0, n).slice(0, take);
    if (take > 0) {
      const buf = interleaveInt16(l, r).buffer as ArrayBuffer;
      this.port.postMessage(
        { type: "raw48k", buf, startFrame: this.rawSent } satisfies PcmMessage,
        [buf],
      );
      this.rawSent += take;
    }
    if (this.rawSent >= this.maxFrames) {
      this.done = true;
      this.port.postMessage({ type: "done", frames: this.rawSent } satisfies DoneMessage);
    }
  }
}

registerProcessor("viva-downsample", DownsampleProcessor);
