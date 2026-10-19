// WAV header reading and lossless slicing for session file import (work order 02).
// Reads only the bytes it needs through Blob.slice, so a 700 MB file never
// sits in memory. No browser-only or Node-only API: Blob exists in both.

export type ImportEncoding = "pcm16" | "pcm24" | "float32";

export interface SessionWavInfo {
  encoding: ImportEncoding;
  /** The format code in the fmt chunk (1 PCM, 3 float, 0xFFFE extensible). */
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Bytes per frame: one sample for each channel. */
  blockAlign: number;
  /** Byte offset of the first sample in the file. */
  dataOffset: number;
  /** Bytes of sample data, a whole number of frames. */
  dataBytes: number;
  frames: number;
  /** The fmt chunk as it appears in the file, header included, for slice headers. */
  fmtChunk: Uint8Array;
  /** Set when the data chunk's declared size disagreed with the file length. */
  note?: string;
}

/** A plain message about the file, for the import page to show as is. */
export class WavFormatProblem extends Error {}

const KSDATAFORMAT_PCM = 1;
const KSDATAFORMAT_FLOAT = 3;

async function readAt(blob: Blob, offset: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

const tag = (b: Uint8Array, off = 0) =>
  String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);

function describe(formatTag: number, bits: number, channels: number, rate: number): string {
  const kind =
    formatTag === KSDATAFORMAT_FLOAT
      ? "float"
      : formatTag === KSDATAFORMAT_PCM
        ? "PCM"
        : `format ${formatTag}`;
  return `${channels} channel${channels === 1 ? "" : "s"}, ${rate} Hz, ${bits}-bit ${kind}`;
}

/**
 * Parses the header of a session WAV. Accepts 2 channels of 16-bit PCM,
 * 24-bit PCM, or 32-bit float, plain or WAVE_FORMAT_EXTENSIBLE. Throws a
 * WavFormatProblem that names what the file contains otherwise.
 */
export async function readSessionWavInfo(file: Blob): Promise<SessionWavInfo> {
  const head = await readAt(file, 0, 12);
  if (head.length < 12 || tag(head) !== "RIFF" || tag(head, 8) !== "WAVE") {
    throw new WavFormatProblem("This file is not a WAV file (no RIFF/WAVE header).");
  }
  let off = 12;
  let fmt: { chunk: Uint8Array; view: DataView } | null = null;
  while (off + 8 <= file.size) {
    const h = await readAt(file, off, 8);
    const id = tag(h);
    const size = new DataView(h.buffer).getUint32(4, true);
    if (id === "fmt ") {
      const chunk = await readAt(file, off, 8 + size);
      fmt = { chunk, view: new DataView(chunk.buffer, 8) };
    } else if (id === "data") {
      if (!fmt)
        throw new WavFormatProblem("This WAV file has its sample data before its format block.");
      return finish(fmt, off + 8, size, file.size);
    }
    off += 8 + size + (size % 2);
  }
  throw new WavFormatProblem("This WAV file has no sample data (no data chunk).");
}

function finish(
  fmt: { chunk: Uint8Array; view: DataView },
  dataOffset: number,
  declared: number,
  fileSize: number,
): SessionWavInfo {
  const v = fmt.view;
  const formatTag = v.getUint16(0, true);
  const channels = v.getUint16(2, true);
  const sampleRate = v.getUint32(4, true);
  const blockAlign = v.getUint16(12, true);
  const bitsPerSample = v.getUint16(14, true);
  // WAVE_FORMAT_EXTENSIBLE keeps the real format code in the first two bytes of its GUID.
  const real = formatTag === 0xfffe && v.byteLength >= 26 ? v.getUint16(24, true) : formatTag;
  const what = describe(real, bitsPerSample, channels, sampleRate);
  if (channels !== 2) {
    throw new WavFormatProblem(
      `This file contains ${what}. The import needs 2 channels, one student on each. Export the Audacity project as stereo.`,
    );
  }
  let encoding: ImportEncoding;
  if (real === KSDATAFORMAT_PCM && bitsPerSample === 16) encoding = "pcm16";
  else if (real === KSDATAFORMAT_PCM && bitsPerSample === 24) encoding = "pcm24";
  else if (real === KSDATAFORMAT_FLOAT && bitsPerSample === 32) encoding = "float32";
  else {
    throw new WavFormatProblem(
      `This file contains ${what}. The import accepts 16-bit PCM, 24-bit PCM, or 32-bit float.`,
    );
  }
  if (blockAlign !== channels * (bitsPerSample / 8)) {
    throw new WavFormatProblem(`This file declares ${blockAlign} bytes per frame for ${what}.`);
  }
  const available = fileSize - dataOffset;
  let bytes = declared;
  let note: string | undefined;
  if (declared === 0 || declared > available) {
    bytes = available;
    note = `The data chunk declares ${declared} bytes and the file holds ${available} after the header; the import reads ${available - (available % blockAlign)}.`;
  }
  bytes -= bytes % blockAlign;
  return {
    encoding,
    formatTag,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    dataOffset,
    dataBytes: bytes,
    frames: bytes / blockAlign,
    fmtChunk: fmt.chunk,
    note,
  };
}

/**
 * A header for a slice of the session file: RIFF, the original fmt chunk byte
 * for byte, and a data chunk of dataBytes. The slice's samples are the
 * original bytes, so nothing is resampled, re-encoded, or changed in depth.
 */
export function sliceHeader(info: SessionWavInfo, dataBytes: number): Uint8Array {
  const fmtLen = info.fmtChunk.length + (info.fmtChunk.length % 2);
  const out = new Uint8Array(12 + fmtLen + 8);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 4 + fmtLen + 8 + dataBytes + (dataBytes % 2), true);
  ascii(8, "WAVE");
  out.set(info.fmtChunk, 12);
  ascii(12 + fmtLen, "data");
  v.setUint32(12 + fmtLen + 4, dataBytes, true);
  return out;
}

/** Byte range [start, end) in the session file for frames [startFrame, endFrame). */
export function frameBytes(info: SessionWavInfo, startFrame: number, endFrame: number) {
  return {
    start: info.dataOffset + startFrame * info.blockAlign,
    end: info.dataOffset + endFrame * info.blockAlign,
  };
}

/** One pair's WAV: the slice header plus the original sample bytes, without copying them. */
export function sliceBlob(
  file: Blob,
  info: SessionWavInfo,
  startFrame: number,
  endFrame: number,
): Blob {
  const { start, end } = frameBytes(info, startFrame, endFrame);
  const parts: BlobPart[] = [sliceHeader(info, end - start) as BlobPart, file.slice(start, end)];
  // RIFF chunks pad to an even length; 24-bit stereo frames are 6 bytes, so this never fires there.
  if ((end - start) % 2) parts.push(new Uint8Array(1) as BlobPart);
  return new Blob(parts, { type: "audio/wav" });
}

/** Decodes one sample to a float in [-1, 1). */
export function sampleReader(encoding: ImportEncoding): (v: DataView, off: number) => number {
  switch (encoding) {
    case "pcm16":
      return (v, o) => v.getInt16(o, true) / 32768;
    case "pcm24":
      return (v, o) =>
        (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608;
    case "float32":
      return (v, o) => v.getFloat32(o, true);
  }
}
