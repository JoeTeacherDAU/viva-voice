// A synthetic two-channel input for CI and headless Chrome (build-plan P3.6).
// Student A is a 500 Hz tone on channel 0, student B a 750 Hz tone on
// channel 1, and each bleeds into the other channel 20 dB down.

export type SynthMode = "silent" | "A" | "B" | "both";

export interface SyntheticSource {
  stream: MediaStream;
  channelCount: 1 | 2;
  setMode(mode: SynthMode): void;
  stop(): Promise<void>;
}

const OWN = 0.3;
const BLEED = 0.03;

export function createSyntheticStereo(
  initial: SynthMode = "both",
  channelCount: 1 | 2 = 2,
): SyntheticSource {
  const ctx = new AudioContext({ sampleRate: 48000 });
  const merger = ctx.createChannelMerger(2);
  const dest = ctx.createMediaStreamDestination();
  // A mono build mixes both speakers into one channel, as a mono receiver would.
  dest.channelCount = channelCount;
  dest.channelCountMode = "explicit";
  dest.channelInterpretation = channelCount === 2 ? "discrete" : "speakers";

  // gains[speaker][channel]
  const gains = [0, 1].map((speaker) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = speaker === 0 ? 500 : 750;
    const toCh = [0, 1].map((ch) => {
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(merger, 0, ch);
      return g;
    });
    osc.start();
    return toCh;
  });
  merger.connect(dest);

  const setMode = (mode: SynthMode) => {
    const on = [mode === "A" || mode === "both", mode === "B" || mode === "both"];
    [0, 1].forEach((speaker) =>
      [0, 1].forEach((ch) => {
        const level = on[speaker] ? (speaker === ch ? OWN : BLEED) : 0;
        gains[speaker][ch].gain.setValueAtTime(level, ctx.currentTime);
      }),
    );
  };
  setMode(initial);
  void ctx.resume();

  return {
    stream: dest.stream,
    channelCount,
    setMode,
    stop: async () => {
      dest.stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

export const SYNTHETIC_DEVICE_ID = "synthetic-stereo";
export const SYNTHETIC_MONO_ID = "synthetic-mono";
