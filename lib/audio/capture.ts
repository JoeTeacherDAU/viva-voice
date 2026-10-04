import { PcmWriter, requestPersistence } from "@/lib/storage/local";
import type { EnergyTrack } from "@/lib/analysis/types";
import { CAPTURE_RATE, FRAME_MS } from "./dsp";
import type { EnergyMessage } from "./worklets/energy.worklet";
import type { DoneMessage, PcmMessage } from "./worklets/downsample.worklet";

export interface CaptureOptions {
  /** When set, raw 48 kHz PCM goes to IndexedDB under this session id. */
  sessionId?: string;
  /** Stop recording raw PCM after this many frames (tests use exact lengths). */
  maxFrames?: number;
  onEnergy?: (channel: 0 | 1, atMs: number, dbfs: number) => void;
  onPcm16k?: (buf: ArrayBuffer) => void;
  onDone?: (frames: number) => void;
}

/**
 * The capture graph from PLAN.md section 5: a 48 kHz AudioContext, a splitter
 * into one energy worklet per channel, and a downsample worklet that feeds the
 * transcriber and tees raw PCM into IndexedDB with a two-second flush.
 */
export class Capture {
  readonly ctx: AudioContext;
  private writer: PcmWriter | null = null;
  private energy: [number[], number[]] = [[], []];
  private energyStartMs: number | null = null;
  private nodes: AudioNode[] = [];
  framesRecorded = 0;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  static async start(stream: MediaStream, opts: CaptureOptions = {}): Promise<Capture> {
    const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
    await Promise.all([
      ctx.audioWorklet.addModule("/worklets/energy.worklet.js"),
      ctx.audioWorklet.addModule("/worklets/downsample.worklet.js"),
    ]);
    const cap = new Capture(ctx);
    if (opts.sessionId) {
      await requestPersistence();
      cap.writer = new PcmWriter(opts.sessionId);
    }

    const source = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(2);
    source.connect(splitter);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination); // keeps the graph pulling without making sound

    ([0, 1] as const).forEach((ch) => {
      const node = new AudioWorkletNode(ctx, "viva-energy", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      splitter.connect(node, ch);
      node.port.onmessage = (e: MessageEvent<EnergyMessage>) => {
        cap.recordEnergy(ch, e.data.atMs, e.data.dbfs);
        opts.onEnergy?.(ch, e.data.atMs, e.data.dbfs);
      };
      cap.nodes.push(node);
    });

    const down = new AudioWorkletNode(ctx, "viva-downsample", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions: { maxFrames: opts.maxFrames },
    });
    source.connect(down);
    down.connect(sink);
    down.port.onmessage = (e: MessageEvent<PcmMessage | DoneMessage>) => {
      const m = e.data;
      if (m.type === "pcm16k") opts.onPcm16k?.(m.buf);
      else if (m.type === "raw48k") {
        cap.framesRecorded += m.buf.byteLength / 4;
        cap.writer?.push(m.buf);
      } else if (m.type === "done") {
        void cap.writer?.flush().then(() => opts.onDone?.(m.frames));
        if (!cap.writer) opts.onDone?.(m.frames);
      }
    };
    cap.nodes.push(source, splitter, down, sink);
    return cap;
  }

  private recordEnergy(ch: 0 | 1, atMs: number, dbfs: number) {
    this.energyStartMs ??= atMs;
    const k = Math.round((atMs - this.energyStartMs) / FRAME_MS);
    this.energy[ch][k] = Math.round(dbfs * 100) / 100;
  }

  /** Energy frames recorded so far, in the columnar storage shape. */
  energyTrack(): EnergyTrack {
    const len = Math.max(this.energy[0].length, this.energy[1].length);
    const fill = (a: number[]) => Array.from({ length: len }, (_, i) => a[i] ?? -100);
    return {
      frameMs: FRAME_MS,
      startMs: this.energyStartMs ?? 0,
      channels: [fill(this.energy[0]), fill(this.energy[1])],
    };
  }

  /** Context time in ms, the clock the energy frames use. */
  nowMs(): number {
    return this.ctx.currentTime * 1000;
  }

  async stop(): Promise<void> {
    for (const n of this.nodes) n.disconnect();
    await this.writer?.close();
    if (this.ctx.state !== "closed") await this.ctx.close();
  }
}
