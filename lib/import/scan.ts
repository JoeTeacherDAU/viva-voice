// One pass over a session file (work order 02): exact-zero runs on both
// channels, 20 ms energy frames for both channels, and the SHA-256 of every
// byte. Reads the file through Blob.slice in chunks.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { EnergyTrack } from "@/lib/analysis/types";
import { sampleReader, type SessionWavInfo } from "./wavfile";

/** docs/OPERATIONAL_DEFINITIONS.md, session file import. */
export const MIN_ZERO_RUN_MS = 500;
export const ENERGY_FRAME_MS = 20;
export const DBFS_FLOOR = -100;
/** 8 MB reads; a multiple of 6, 4, and 8, so a read never splits a frame. */
export const CHUNK_BYTES = 8 * 1024 * 1024 - ((8 * 1024 * 1024) % 24);

/** Frames [start, end) where every sample on both channels equals zero. */
export interface ZeroRun {
  start: number;
  end: number;
}

export interface ScanResult {
  zeroRuns: ZeroRun[];
  energy: EnergyTrack;
  frames: number;
  sha256: string;
}

export function minZeroRunFrames(sampleRate: number): number {
  return Math.ceil((sampleRate * MIN_ZERO_RUN_MS) / 1000);
}

/**
 * Streams sample bytes (data chunk only) and keeps the zero-run and energy
 * state across pushes. Frame 0 is the first frame pushed.
 */
export class SampleScanner {
  private readonly read: (v: DataView, off: number) => number;
  private readonly bytesPerSample: number;
  private readonly frameSamples: number;
  private readonly minRun: number;
  private frame = 0;
  private runStart = -1;
  private sum: [number, number] = [0, 0];
  private fill = 0;
  private carry = new Uint8Array(0);
  readonly zeroRuns: ZeroRun[] = [];
  readonly channels: [number[], number[]] = [[], []];

  constructor(private readonly info: SessionWavInfo) {
    this.read = sampleReader(info.encoding);
    this.bytesPerSample = info.bitsPerSample / 8;
    this.frameSamples = Math.round((info.sampleRate * ENERGY_FRAME_MS) / 1000);
    this.minRun = minZeroRunFrames(info.sampleRate);
  }

  push(bytes: Uint8Array): void {
    let buf = bytes;
    if (this.carry.length) {
      buf = new Uint8Array(this.carry.length + bytes.length);
      buf.set(this.carry);
      buf.set(bytes, this.carry.length);
    }
    const block = this.info.blockAlign;
    const whole = buf.length - (buf.length % block);
    this.carry = buf.slice(whole);
    const v = new DataView(buf.buffer, buf.byteOffset, whole);
    const step = this.bytesPerSample;
    const n = this.frameSamples;
    for (let o = 0; o < whole; o += block) {
      const l = this.read(v, o);
      const r = this.read(v, o + step);
      if (l === 0 && r === 0) {
        if (this.runStart < 0) this.runStart = this.frame;
      } else if (this.runStart >= 0) {
        this.closeRun(this.frame);
      }
      this.sum[0] += l * l;
      this.sum[1] += r * r;
      if (++this.fill === n) {
        this.channels[0].push(toDbfs(this.sum[0], n));
        this.channels[1].push(toDbfs(this.sum[1], n));
        this.sum = [0, 0];
        this.fill = 0;
      }
      this.frame++;
    }
  }

  private closeRun(end: number) {
    if (end - this.runStart >= this.minRun) this.zeroRuns.push({ start: this.runStart, end });
    this.runStart = -1;
  }

  /** Closes a zero run that reaches the end. A partial last energy frame is dropped, as on the live path. */
  finish(): { zeroRuns: ZeroRun[]; energy: EnergyTrack; frames: number } {
    if (this.runStart >= 0) this.closeRun(this.frame);
    return {
      zeroRuns: this.zeroRuns,
      energy: { frameMs: ENERGY_FRAME_MS, startMs: 0, channels: this.channels },
      frames: this.frame,
    };
  }
}

function toDbfs(sumSq: number, n: number): number {
  const rms = Math.sqrt(sumSq / n);
  const db = rms > 0 ? Math.max(DBFS_FLOOR, 20 * Math.log10(rms)) : DBFS_FLOOR;
  return Math.round(db * 100) / 100;
}

/**
 * Reads [start, end) of a Blob in chunks, handing each chunk to onChunk, and
 * reports bytes done. Yields between chunks so a page stays responsive.
 */
export async function readInChunks(
  blob: Blob,
  start: number,
  end: number,
  onChunk: (bytes: Uint8Array, offset: number) => void,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<void> {
  for (let o = start; o < end; o += CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(o, Math.min(end, o + CHUNK_BYTES)).arrayBuffer());
    onChunk(bytes, o);
    onProgress(Math.min(end, o + CHUNK_BYTES) - start, end - start);
  }
  onProgress(end - start, end - start);
}

/** Scans the whole session file: hash of every byte, zero runs and energy over the sample data. */
export async function scanSessionFile(
  file: Blob,
  info: SessionWavInfo,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const hash = sha256.create();
  const scanner = new SampleScanner(info);
  const dataEnd = info.dataOffset + info.dataBytes;
  await readInChunks(
    file,
    0,
    file.size,
    (bytes, offset) => {
      hash.update(bytes);
      // The scanner sees only the sample data and carries split frames across chunks.
      const a = Math.max(info.dataOffset, offset) - offset;
      const b = Math.min(dataEnd, offset + bytes.length) - offset;
      if (b > a) scanner.push(bytes.subarray(a, b));
    },
    onProgress,
  );
  return { ...scanner.finish(), sha256: bytesToHex(hash.digest()) };
}

/** SHA-256 and 20 ms energy for one pair slice, aligned to the slice's first frame. */
export async function scanSlice(
  file: Blob,
  info: SessionWavInfo,
  startFrame: number,
  endFrame: number,
  header: Uint8Array,
): Promise<{ sha256: string; energy: EnergyTrack }> {
  const hash = sha256.create();
  hash.update(header);
  const scanner = new SampleScanner(info);
  const start = info.dataOffset + startFrame * info.blockAlign;
  const end = info.dataOffset + endFrame * info.blockAlign;
  await readInChunks(file, start, end, (bytes) => {
    hash.update(bytes);
    scanner.push(bytes);
  });
  if ((end - start) % 2) hash.update(new Uint8Array(1));
  return { sha256: bytesToHex(hash.digest()), energy: scanner.finish().energy };
}

/** SHA-256 of a whole Blob, read in chunks. */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  const hash = sha256.create();
  await readInChunks(blob, 0, blob.size, (bytes) => hash.update(bytes));
  return bytesToHex(hash.digest());
}
