import { readPcm } from "@/lib/storage/local";
import { CAPTURE_RATE } from "./dsp";

export interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  frames: number;
  dataOffset: number;
}

export function wavHeader(
  dataBytes: number,
  channels = 2,
  sampleRate = CAPTURE_RATE,
  bits = 16,
): ArrayBuffer {
  const h = new DataView(new ArrayBuffer(44));
  const ascii = (off: number, s: string) =>
    [...s].forEach((c, i) => h.setUint8(off + i, c.charCodeAt(0)));
  const blockAlign = (channels * bits) / 8;
  ascii(0, "RIFF");
  h.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true);
  h.setUint16(22, channels, true);
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * blockAlign, true);
  h.setUint16(32, blockAlign, true);
  h.setUint16(34, bits, true);
  ascii(36, "data");
  h.setUint32(40, dataBytes, true);
  return h.buffer;
}

/** One 48 kHz 16-bit stereo WAV from interleaved PCM chunks. */
export function buildStereoWav(chunks: ArrayBuffer[], sampleRate = CAPTURE_RATE): Blob {
  const bytes = chunks.reduce((a, c) => a + c.byteLength, 0);
  return new Blob([wavHeader(bytes, 2, sampleRate), ...chunks], { type: "audio/wav" });
}

/** Splits interleaved stereo chunks into two mono WAVs: [channel 0, channel 1]. */
export function splitMonoWavs(chunks: ArrayBuffer[], sampleRate = CAPTURE_RATE): [Blob, Blob] {
  const frames = chunks.reduce((a, c) => a + c.byteLength / 4, 0);
  const mono = [new Int16Array(frames), new Int16Array(frames)];
  let f = 0;
  for (const c of chunks) {
    const s = new Int16Array(c);
    for (let i = 0; i < s.length; i += 2, f++) {
      mono[0][f] = s[i];
      mono[1][f] = s[i + 1];
    }
  }
  return [0, 1].map(
    (ch) =>
      new Blob([wavHeader(frames * 2, 1, sampleRate), mono[ch].buffer as ArrayBuffer], {
        type: "audio/wav",
      }),
  ) as [Blob, Blob];
}

/** Reads a canonical PCM WAV header, finding the data chunk by walking chunks. */
export function parseWav(buf: ArrayBuffer): WavInfo {
  const v = new DataView(buf);
  const tag = (off: number) => String.fromCharCode(...new Uint8Array(buf, off, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "frames" | "dataOffset"> | null = null;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: v.getUint16(off + 8, true),
        channels: v.getUint16(off + 10, true),
        sampleRate: v.getUint32(off + 12, true),
        bitsPerSample: v.getUint16(off + 22, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data chunk before fmt chunk");
      const frames = size / (fmt.channels * (fmt.bitsPerSample / 8));
      return { ...fmt, dataBytes: size, frames, dataOffset: off + 8 };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

/** Builds the session's stereo WAV from the IndexedDB PCM store. */
export async function wavFromStore(sessionId: string): Promise<Blob> {
  return buildStereoWav(await readPcm(sessionId));
}

/** Builds the two mono WAVs on demand. */
export async function monoWavsFromStore(sessionId: string): Promise<[Blob, Blob]> {
  return splitMonoWavs(await readPcm(sessionId));
}
