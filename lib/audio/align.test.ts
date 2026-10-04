import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnergyTrack } from "@/lib/analysis/types";
import { alignTracks, bestLag, envelope } from "./align";
import { decodeWavMono, encodeWav } from "./decode";
import { parseWav } from "./wav";

const fx = join(__dirname, "../../fixtures/golden/balanced");
const file = readFileSync(join(fx, "stereo.wav"));
const stereo = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const energy = JSON.parse(readFileSync(join(fx, "energy.json"), "utf8")) as EnergyTrack;

function channel(ch: 0 | 1): Float32Array {
  const info = parseWav(stereo);
  const pcm = new Int16Array(stereo, info.dataOffset, info.frames * 2);
  return Float32Array.from({ length: info.frames }, (_, i) => pcm[2 * i + ch] / 32768);
}

/** Onboard-style track whose sample 0 sits at offsetMs in the archive timeline. */
function shifted(ch: 0 | 1, offsetMs: number): Float32Array {
  const src = channel(ch);
  const k = Math.round((Math.abs(offsetMs) * 48000) / 1000);
  if (offsetMs < 0) {
    const out = new Float32Array(src.length + k);
    out.set(src, k);
    return out;
  }
  return src.slice(k);
}

describe("decodeWavMono", () => {
  it("reads 16-bit PCM and 32-bit float and round-trips through encodeWav", () => {
    const x = Float32Array.from([0, 0.5, -0.5, 0.25]);
    const f = decodeWavMono(encodeWav([x], 48000, true));
    expect(f.encoding).toBe("float32");
    expect([...f.samples]).toEqual([0, 0.5, -0.5, 0.25]);
    const p = decodeWavMono(encodeWav([x, x], 48000, false));
    expect(p.encoding).toBe("pcm16");
    expect(p.samples[1]).toBeCloseTo(0.5, 3);
  });

  it("reads 24-bit PCM", () => {
    const buf = new ArrayBuffer(44 + 6);
    const v = new DataView(buf);
    const h = new Uint8Array(encodeWav([new Float32Array(1)], 48000));
    new Uint8Array(buf).set(h.subarray(0, 44));
    v.setUint16(32, 3, true);
    v.setUint16(34, 24, true);
    v.setUint32(40, 6, true);
    v.setUint32(4, 42, true);
    // 0x400000 = +0.5, 0xC00000 = -0.5
    [0x00, 0x00, 0x40, 0x00, 0x00, 0xc0].forEach((b, i) => v.setUint8(44 + i, b));
    const d = decodeWavMono(buf);
    expect(d.encoding).toBe("pcm24");
    expect([...d.samples]).toEqual([0.5, -0.5]);
  });
});

describe("onboard alignment", () => {
  it.each([
    [0, -3217],
    [1, 1500],
  ] as const)("recovers channel %i's offset of %i ms within 20 ms", (ch, offsetMs) => {
    const probe = envelope(shifted(ch, offsetMs), 48000);
    const { lag, score } = bestLag(energy.channels[ch], probe);
    const estimate = energy.startMs + lag * energy.frameMs;
    expect(Math.abs(estimate - offsetMs)).toBeLessThanOrEqual(20);
    expect(score).toBeGreaterThan(0.5);
  });

  it("places shifted tracks back on the archive timeline", () => {
    const [a] = alignTracks([{ samples: Float32Array.from([1, 2, 3]), startSample: -1 }], 4);
    expect([...a]).toEqual([2, 3, 0, 0]);
    const [b] = alignTracks([{ samples: Float32Array.from([1, 2]), startSample: 3 }], 4);
    expect([...b]).toEqual([0, 0, 0, 1]);
  });
});
