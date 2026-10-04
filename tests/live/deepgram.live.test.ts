// Live Deepgram test (build-plan P4.6). Skipped unless DEEPGRAM_API_KEY is set.
//
// It fetches a JWT from Deepgram's grant endpoint, opens the socket with the
// ['bearer', jwt] subprotocol (verification task V6), streams a stereo WAV at
// real time through the adapter, and closes with CloseStream.
//
// The default audio is fixtures/golden/balanced/stereo.wav, which holds sine
// bursts rather than speech (CLAUDE.md forbids human voices in fixtures), so
// Deepgram may return no words for it. With the default audio the test checks
// the connection and checks any words that do arrive. Set VIVA_LIVE_WAV to a
// local 48 kHz stereo speech recording (never committed) to also require
// final words on both channels.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/analysis/types";
import { Decimator, interleaveInt16 } from "@/lib/audio/dsp";
import { parseWav } from "@/lib/audio/wav";
import type { TranscriberEvent } from "@/lib/asr/types";
import { DeepgramTranscriber, type SocketLike } from "@/lib/asr/providers/deepgram";

const KEY = process.env.DEEPGRAM_API_KEY;
const SPEECH_WAV = process.env.VIVA_LIVE_WAV;
const name = KEY
  ? "streams a stereo WAV through the live adapter"
  : "streams a stereo WAV through the live adapter (skipped: DEEPGRAM_API_KEY is not set)";

describe("live Deepgram", () => {
  it.skipIf(!KEY)(
    name,
    async () => {
      const path = SPEECH_WAV ?? join(__dirname, "../../fixtures/golden/balanced/stereo.wav");
      const file = readFileSync(path);
      const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      const info = parseWav(buf);
      expect(info).toMatchObject({ channels: 2, sampleRate: 48000, bitsPerSample: 16 });
      const pcm = new Int16Array(buf, info.dataOffset, info.frames * 2);

      const getToken = async () => {
        const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
          method: "POST",
          headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl_seconds: 60 }),
        });
        expect(res.ok, `grant returned HTTP ${res.status}`).toBe(true);
        return ((await res.json()) as { access_token: string }).access_token;
      };
      const t = new DeepgramTranscriber({
        getToken,
        socketFactory: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      });
      const words: Word[] = [];
      const events: TranscriberEvent[] = [];
      t.onWords((w) => words.push(...w));
      t.onEvent((e) => events.push(e));
      await t.connect({ channelMap: { "0": "A", "1": "B" } });

      // 100 ms chunks: decimate each channel to 16 kHz and interleave.
      const dec = [new Decimator(), new Decimator()];
      const chunk = 4800;
      for (let f = 0; f < info.frames; f += chunk) {
        const n = Math.min(chunk, info.frames - f);
        const l = new Float32Array(n);
        const r = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          l[i] = pcm[2 * (f + i)] / 32768;
          r[i] = pcm[2 * (f + i) + 1] / 32768;
        }
        t.sendFrames(interleaveInt16(dec[0].process(l), dec[1].process(r)).buffer as ArrayBuffer);
        await new Promise((res) => setTimeout(res, 100));
      }
      await t.close(10000);

      expect(events[0]?.type).toBe("open");
      expect(events.some((e) => e.type === "error")).toBe(false);
      const finals = words.filter((w) => w.isFinal);
      for (const ch of [0, 1] as const) {
        const own = finals.filter((w) => w.channel === ch);
        for (let i = 1; i < own.length; i++)
          expect(own[i].startMs).toBeGreaterThanOrEqual(own[i - 1].startMs);
        for (const w of own) expect(w.endMs).toBeGreaterThanOrEqual(w.startMs);
      }
      if (SPEECH_WAV) {
        expect(finals.some((w) => w.channel === 0)).toBe(true);
        expect(finals.some((w) => w.channel === 1)).toBe(true);
      } else {
        console.log(`live Deepgram: ${finals.length} final words from the sine-burst fixture`);
      }
    },
    300_000,
  );
});
