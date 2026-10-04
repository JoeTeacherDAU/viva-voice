import { parseWav } from "./wav";

export interface MonoAudio {
  sampleRate: number;
  samples: Float32Array;
  /** "pcm16", "pcm24", "pcm32", or "float32", for the import screen to report. */
  encoding: string;
}

/**
 * Decodes a WAV to mono float samples. Handles 16-, 24-, and 32-bit PCM and
 * 32-bit float (the transmitters' onboard format). A multichannel file
 * contributes its first channel.
 */
export function decodeWavMono(buf: ArrayBuffer): MonoAudio {
  const info = parseWav(buf);
  const v = new DataView(buf, info.dataOffset, info.dataBytes);
  const bytes = info.bitsPerSample / 8;
  const stride = bytes * info.channels;
  const n = Math.floor(info.dataBytes / stride);
  const out = new Float32Array(n);
  // WAVE_FORMAT_EXTENSIBLE (0xFFFE) keeps the real format in a GUID; treat 32-bit as float there.
  const float = info.format === 3 || (info.format === 0xfffe && info.bitsPerSample === 32);
  let encoding: string;
  if (float && bytes === 4) {
    encoding = "float32";
    for (let i = 0; i < n; i++) out[i] = v.getFloat32(i * stride, true);
  } else if (bytes === 2) {
    encoding = "pcm16";
    for (let i = 0; i < n; i++) out[i] = v.getInt16(i * stride, true) / 32768;
  } else if (bytes === 3) {
    encoding = "pcm24";
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
      out[i] = x / 8388608;
    }
  } else if (bytes === 4) {
    encoding = "pcm32";
    for (let i = 0; i < n; i++) out[i] = v.getInt32(i * stride, true) / 2147483648;
  } else {
    throw new Error(`Unsupported WAV: ${info.bitsPerSample}-bit, format ${info.format}`);
  }
  return { sampleRate: info.sampleRate, samples: out, encoding };
}

/** Encodes float samples as a mono or stereo WAV (16-bit PCM or 32-bit float). */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  float = false,
): ArrayBuffer {
  const n = channels[0].length;
  const c = channels.length;
  const bytes = float ? 4 : 2;
  const buf = new ArrayBuffer(44 + n * c * bytes);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) =>
    [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * c * bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, c, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * c * bytes, true);
  v.setUint16(32, c * bytes, true);
  v.setUint16(34, bytes * 8, true);
  ascii(36, "data");
  v.setUint32(40, n * c * bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < c; k++) {
      const x = channels[k][i];
      if (float) v.setFloat32(o, x, true);
      else v.setInt16(o, Math.round(Math.max(-1, Math.min(1, x)) * (x < 0 ? 32768 : 32767)), true);
      o += bytes;
    }
  }
  return buf;
}
