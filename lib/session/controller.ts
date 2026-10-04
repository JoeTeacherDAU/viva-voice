import { targetHits, type TargetHit } from "@/lib/analysis/features/lexical";
import { run as runPipeline, type RunResult } from "@/lib/analysis/pipeline";
import type {
  Baseline,
  FeatureValue,
  IndexedWord,
  Participant,
  SessionRecord,
  SessionState,
  Word,
} from "@/lib/analysis/types";
import type { Transcriber, TranscriberEvent } from "@/lib/asr/types";
import type { FaultLevel } from "@/lib/ui/FaultStrip";
import { reduce } from "./state";
import { TalkTimeEstimator } from "./talktime";

export const RECOMPUTE_MS = 10000;
export const TICK_MS = 250;
/** A channel this quiet for WATCHDOG_MS reads as a dead transmitter. */
export const NOISE_FLOOR_DBFS = -90;
export const WATCHDOG_MS = 10000;

export interface IndexDisplay {
  composite: number | null;
  speechRate: number | null;
  pauseRate: number | null;
  meanLengthOfRun: number | null;
}

export interface LiveView {
  state: SessionState;
  elapsedMs: number;
  remainingMs: number;
  /** Student A's share of talk time, or null before anyone speaks. */
  talkShareA: number | null;
  /** Hidden until the instructor taps a score (PLAN.md section 9). */
  revealed: boolean;
  score: number | null;
  index: Record<Participant, IndexDisplay | null>;
  targets: Record<Participant, number>;
  fault: FaultLevel;
  faultReason: string | null;
  recomputes: number;
}

export interface LiveDeps {
  transcriber: Transcriber;
  /** Capture-time milliseconds: the clock of the WAV and the energy frames. */
  now: () => number;
  run?: typeof runPipeline;
  baseline?: Baseline | null;
  persist?: (rec: SessionRecord) => Promise<void> | void;
}

export interface StopResult {
  record: SessionRecord;
  words: Word[];
  result: RunResult;
}

const value = (fs: FeatureValue[], id: string, P: Participant, T: number | null = null) =>
  fs.find(
    (f) => f.featureId === id && f.participant === P && f.window === "full" && f.thresholdMs === T,
  )?.value ?? null;

/**
 * Drives one live session: forwards audio to the transcriber while live,
 * keeps final words in capture time, recomputes pass one every 10 seconds
 * and once at Stop, counts target structures on final words, estimates talk
 * time from interims, and raises faults.
 */
export class LiveSession {
  private rec: SessionRecord;
  private listeners = new Set<(v: LiveView) => void>();
  private finals: Word[] = [];
  private talk = new TalkTimeEstimator();
  private hits: Record<Participant, TargetHit[]> = { A: [], B: [] };
  private index: Record<Participant, IndexDisplay | null> = { A: null, B: null };
  private recomputeTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private socketFault: FaultLevel = "clear";
  private socketReason: string | null = null;
  private deviceReason: string | null = null;
  private lastHeard: [number, number] = [0, 0];
  private watchdogReason: string | null = null;
  private recomputes = 0;
  private readonly run: typeof runPipeline;

  constructor(
    record: SessionRecord,
    private readonly deps: LiveDeps,
  ) {
    this.rec = record;
    this.run = deps.run ?? runPipeline;
    deps.transcriber.onWords((w) => this.handleWords(w));
    deps.transcriber.onEvent((e) => this.handleEvent(e));
  }

  get record(): SessionRecord {
    return this.rec;
  }

  subscribe(fn: (v: LiveView) => void): () => void {
    this.listeners.add(fn);
    fn(this.view());
    return () => this.listeners.delete(fn);
  }

  async start(): Promise<void> {
    if ((this.rec.state ?? "setup") !== "setup") return;
    const map = this.rec.channelMap ?? { "0": "A", "1": "B" };
    await this.deps.transcriber.connect({ channelMap: map, keyterms: this.rec.config.keyterms });
    const at = this.deps.now();
    this.lastHeard = [at, at];
    this.update(reduce(this.rec, { type: "start", atMs: at }));
    this.recomputeTimer = setInterval(() => this.recompute(), RECOMPUTE_MS);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  /** 16 kHz stereo PCM from the capture graph; sent only while live. */
  sendAudio(buf: ArrayBuffer): void {
    if (this.rec.state === "live") this.deps.transcriber.sendFrames(buf);
  }

  onEnergy(ch: 0 | 1, atMs: number, dbfs: number): void {
    if (dbfs > NOISE_FLOOR_DBFS) this.lastHeard[ch] = Math.max(this.lastHeard[ch], atMs);
  }

  /** The page reports a dropped device track here. */
  setDeviceFault(reason: string | null): void {
    this.deviceReason = reason;
    if (reason)
      this.update(
        reduce(this.rec, {
          type: "event",
          event: { type: "fault", atMs: this.deps.now(), detail: { reason } },
        }),
      );
    else this.emit();
  }

  score(v: number): void {
    this.update(reduce(this.rec, { type: "score", value: v, atMs: this.deps.now() }));
  }

  /** Final words so far, in capture time. */
  words(): Word[] {
    return [...this.finals];
  }

  /** Runs pass one over the final words up to stopMs (default: now). */
  recompute(stopMs?: number): RunResult | null {
    const startMs = this.rec.markers.startMs;
    if (startMs === null) return null;
    const result = this.run(this.finals, null, this.rec.config, this.deps.baseline ?? null, {
      pass: 1,
      markers: { startMs, stopMs: stopMs ?? this.deps.now() },
      events: this.rec.events,
      channelMap: this.rec.channelMap,
      rolling: false,
    });
    for (const P of ["A", "B"] as Participant[]) {
      this.index[P] = {
        composite: value(result.features, "composite_fluency_index", P),
        speechRate: value(result.features, "speech_rate_wpm", P),
        pauseRate: value(result.features, "silent_pause_rate", P, 350),
        meanLengthOfRun: value(result.features, "mean_length_of_run", P, 350),
      };
    }
    this.recomputes++;
    this.emit();
    return result;
  }

  async stop(): Promise<StopResult | null> {
    if (this.rec.state !== "live") return null;
    const stopMs = this.deps.now();
    this.update(reduce(this.rec, { type: "stop", atMs: stopMs }));
    this.clearTimers();
    await this.deps.transcriber.close();
    const result = this.recompute(stopMs)!;
    let rec = this.rec;
    for (const P of ["A", "B"] as Participant[]) {
      for (const h of this.hits[P]) {
        rec = reduce(rec, {
          type: "event",
          event: { type: "target_hit", atMs: h.startMs, detail: { participant: P, ...h } },
        });
      }
    }
    this.update(rec);
    return { record: this.rec, words: this.words(), result };
  }

  dispose(): void {
    this.clearTimers();
    this.listeners.clear();
  }

  private clearTimers() {
    if (this.recomputeTimer) clearInterval(this.recomputeTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.recomputeTimer = this.tickTimer = null;
  }

  private tick() {
    if (this.rec.state !== "live") return;
    const now = this.deps.now();
    const quiet = ([0, 1] as const).filter((ch) => now - this.lastHeard[ch] >= WATCHDOG_MS);
    const reason = quiet.length
      ? `Channel ${quiet.map((c) => c + 1).join(" and ")} silent for 10 s`
      : null;
    if (reason !== this.watchdogReason) {
      this.watchdogReason = reason;
      if (reason)
        this.update(
          reduce(this.rec, {
            type: "event",
            event: { type: "fault", atMs: now, detail: { reason } },
          }),
        );
    }
    if (now - (this.rec.markers.startMs ?? now) >= this.rec.config.durationMs) {
      void this.stop();
      return;
    }
    this.emit();
  }

  private handleWords(batch: Word[]) {
    const offset = this.rec.markers.startMs;
    if (offset === null || this.rec.state === "setup") return;
    // The transcriber's clock starts at zero on Start; storage uses capture time.
    const shifted = batch.map((w) => ({
      ...w,
      startMs: w.startMs + offset,
      endMs: w.endMs + offset,
    }));
    this.talk.add(shifted);
    const finals = shifted.filter((w) => w.isFinal);
    if (finals.length) {
      this.finals.push(...finals);
      this.finals.sort((a, b) => a.startMs - b.startMs || a.channel - b.channel);
      this.countTargets();
    }
    this.emit();
  }

  private countTargets() {
    const map = this.rec.channelMap ?? { "0": "A", "1": "B" };
    for (const P of ["A", "B"] as Participant[]) {
      const ch = map["0"] === P ? 0 : 1;
      const own = this.finals
        .filter((w) => w.channel === ch)
        .map((w, index) => ({ ...w, index }) as IndexedWord);
      this.hits[P] = targetHits(own, this.rec.config.targetPatterns);
    }
  }

  private handleEvent(e: TranscriberEvent) {
    const offset = this.rec.markers.startMs ?? 0;
    switch (e.type) {
      case "reconnecting":
        this.socketFault = "warn";
        this.socketReason = "Reconnecting to the transcriber";
        break;
      case "open":
      case "reconnected":
        this.socketFault = "clear";
        this.socketReason = null;
        break;
      case "error":
        if ((e.detail as { fatal?: boolean } | undefined)?.fatal) {
          this.socketFault = "fault";
          this.socketReason = "The transcriber connection failed";
        }
        break;
      case "gap": {
        const g = e.detail as { startMs: number; endMs: number };
        this.update(
          reduce(this.rec, {
            type: "event",
            event: {
              type: "gap",
              atMs: g.startMs + offset,
              detail: { startMs: g.startMs + offset, endMs: g.endMs + offset },
            },
          }),
        );
        return;
      }
      default:
        return;
    }
    this.emit();
  }

  private update(rec: SessionRecord) {
    if (rec === this.rec) return;
    this.rec = rec;
    void this.deps.persist?.(rec);
    this.emit();
  }

  private view(): LiveView {
    const start = this.rec.markers.startMs;
    const end = this.rec.markers.stopMs ?? (start !== null ? this.deps.now() : null);
    const elapsed = start !== null && end !== null ? Math.max(0, end - start) : 0;
    const map = this.rec.channelMap ?? { "0": "A", "1": "B" };
    const share0 = this.talk.share();
    let fault: FaultLevel = this.socketFault;
    let reason = this.socketReason;
    if (this.deviceReason || this.watchdogReason) {
      fault = "fault";
      reason = this.deviceReason ?? this.watchdogReason;
    }
    return {
      state: this.rec.state ?? "setup",
      elapsedMs: elapsed,
      remainingMs: Math.max(0, this.rec.config.durationMs - elapsed),
      talkShareA: share0 === null ? null : map["0"] === "A" ? share0 : 1 - share0,
      revealed: this.rec.instructorLiveScore !== null,
      score: this.rec.instructorLiveScore?.value ?? null,
      index: { ...this.index },
      targets: { A: this.hits.A.length, B: this.hits.B.length },
      fault,
      faultReason: reason,
      recomputes: this.recomputes,
    };
  }

  private emit() {
    const v = this.view();
    for (const fn of this.listeners) fn(v);
  }
}
