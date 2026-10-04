// Minimal AudioWorkletGlobalScope declarations; lib.dom does not include them.
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

declare function registerProcessor(
  name: string,
  ctor: new (options?: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;
