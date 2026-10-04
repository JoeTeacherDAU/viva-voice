import { EnergyFramer } from "../dsp";

export interface EnergyMessage {
  type: "energy";
  /** AudioContext time of the frame start, in ms. */
  atMs: number;
  dbfs: number;
}

// One instance per channel, fed by a ChannelSplitterNode output.
class EnergyProcessor extends AudioWorkletProcessor {
  private framer = new EnergyFramer(sampleRate);
  private startFrame = -1;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (this.startFrame < 0) this.startFrame = currentFrame;
    this.framer.push(ch, (frame, dbfs) => {
      const atMs = ((this.startFrame + frame * this.framer.frameSamples) / sampleRate) * 1000;
      this.port.postMessage({ type: "energy", atMs, dbfs } satisfies EnergyMessage);
    });
    return true;
  }
}

registerProcessor("viva-energy", EnergyProcessor);
