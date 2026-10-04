import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { byTier, thresholdsFor } from "@/lib/registry";
import type {
  FeatureValue,
  Participant,
  RemovedSpan,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";
import { featureLabel, findValue, formatValue, mmss } from "./format";

export const DOC_FONT = process.env.VIVA_DOCX_FONT || "Sukhumvit Set";

export interface StudentDocInput {
  record: SessionRecord;
  student: Participant;
  course?: string;
  unit?: string;
  /** Pass-two words after cross-talk rejection, flags set, in capture time. */
  words: Word[];
  pass1: FeatureValue[] | null;
  pass2: FeatureValue[] | null;
  removedSpans: RemovedSpan[];
  unattributedRatio: number | null;
}

/** Phonation thresholds for features that use one without listing it (docs/OPERATIONAL_DEFINITIONS.md). */
function thresholdsOf(id: string, fs: FeatureValue[]): (number | null)[] {
  const t = thresholdsFor(id);
  if (t) return t;
  const used = fs.find((f) => f.featureId === id && f.window === "full")?.thresholdMs ?? null;
  return [used];
}

/**
 * One student's DOCX (PLAN.md 11.1): header, interleaved transcript with this
 * student's turns in bold, this student's tier 1 measurements for both passes,
 * the session log, and the configuration block. It carries no partner
 * measurement and no instructor score (ruling R1).
 */
export async function buildStudentDoc(input: StudentDocInput): Promise<Uint8Array> {
  const { record: rec, student } = input;
  const start = rec.markers.startMs ?? 0;
  const label = (ch: 0 | 1) => (rec.channelMap ?? { "0": "A", "1": "B" })[String(ch) as "0" | "1"];
  const run = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
    new TextRun({ text, font: DOC_FONT, ...opts });
  const para = (children: TextRun[], heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({ children, heading });
  const line = (text: string) => para([run(text)]);

  const out: Paragraph[] = [];
  out.push(
    para(
      [run(`Viva Voice report: student ${student}`, { bold: true, size: 32 })],
      HeadingLevel.TITLE,
    ),
  );
  out.push(line(`Course: ${input.course ?? rec.examId}`));
  out.push(line(`Unit: ${input.unit ?? "not recorded"}`));
  out.push(line(`Date: ${rec.createdAt.slice(0, 10)}`));
  out.push(line(`Pair: ${rec.id}`));
  out.push(line(`Student: ${student} (participant ${rec.participantIds[student]})`));

  // Transcript: consecutive attributed words on one channel form a paragraph.
  out.push(para([run("Transcript", { bold: true })], HeadingLevel.HEADING_1));
  const events = [
    ...input.words
      .filter((w) => !w.removedAsCrosstalk)
      .map((w) => ({ kind: "word" as const, at: w.startMs, w })),
    ...input.removedSpans.map((r) => ({ kind: "removed" as const, at: r.startMs, r })),
  ].sort((a, b) => a.at - b.at);
  let cur: { ch: 0 | 1; runs: TextRun[] } | null = null;
  const flush = () => {
    if (cur) out.push(new Paragraph({ children: cur.runs }));
    cur = null;
  };
  for (const e of events) {
    if (e.kind === "removed") {
      const marker = run(
        ` [cross-talk removed from ${label(e.r.channel)}'s microphone: "${e.r.words.join(" ")}"] `,
        {
          italics: true,
        },
      );
      if (cur) cur.runs.push(marker);
      else out.push(new Paragraph({ children: [marker] }));
      continue;
    }
    const ch = e.w.channel;
    const bold = label(ch) === student;
    if (!cur || cur.ch !== ch) {
      flush();
      cur = {
        ch,
        runs: [
          run(`${label(ch)} ${mmss(e.w.startMs - start)}  `, { bold: true }),
          run(e.w.punctuatedWord, { bold }),
        ],
      };
    } else {
      cur.runs.push(run(` ${e.w.punctuatedWord}`, { bold }));
    }
  }
  flush();

  // Measurements: one paragraph per tier 1 feature, so each label appears once.
  out.push(
    para([run(`Measurements for student ${student}`, { bold: true })], HeadingLevel.HEADING_1),
  );
  const all = [...(input.pass1 ?? []), ...(input.pass2 ?? [])];
  for (const f of byTier(1)) {
    const parts = thresholdsOf(f.id, all).map((t) => {
      const v1 = findValue(input.pass1, f.id, student, t)?.value;
      const v2 = findValue(input.pass2, f.id, student, t)?.value;
      const at = t === null ? "" : `at ${t} ms: `;
      return `${at}pass 1 ${formatValue(v1)}, pass 2 ${formatValue(v2)}`;
    });
    out.push(
      para([run(`${featureLabel(f.id)} (${f.unit}): `, { bold: true }), run(parts.join("; "))]),
    );
  }

  out.push(para([run("Session log", { bold: true })], HeadingLevel.HEADING_1));
  const stop = rec.markers.stopMs ?? start;
  out.push(
    line(
      `Window: ${mmss(0)} to ${mmss(stop - start)} (configured duration ${Math.round(rec.config.durationMs / 1000)} s)`,
    ),
  );
  const faults = rec.events.filter((e) => e.type === "fault");
  const gaps = rec.events.filter((e) => e.type === "gap");
  out.push(
    line(
      `Faults: ${faults.length ? faults.map((e) => `${mmss(e.atMs - start)} ${(e.detail as { reason?: string })?.reason ?? ""}`).join("; ") : "none"}`,
    ),
  );
  out.push(
    line(
      `Transcriber gaps: ${
        gaps.length
          ? gaps
              .map((e) => {
                const d = e.detail as { startMs: number; endMs: number };
                return `${mmss(d.startMs - start)} to ${mmss(d.endMs - start)}`;
              })
              .join("; ")
          : "none"
      }`,
    ),
  );
  out.push(line(`Unattributed frame ratio: ${formatValue(input.unattributedRatio)}`));
  out.push(line(`Removed cross-talk spans: ${input.removedSpans.length}`));

  out.push(para([run("Configuration", { bold: true })], HeadingLevel.HEADING_1));
  const c = rec.config;
  out.push(line(`Receiver gain: ${c.gainDb} dB`));
  out.push(
    line(
      `Pause thresholds: ${c.pauseThresholdsMs.join(" and ")} ms; turn threshold ${c.turnThresholdMs} ms`,
    ),
  );
  out.push(line(`Gating margin: ${c.gatingMarginDb} dB`));
  out.push(
    line(
      `Composite weights (version ${c.weightsVersion}): pause rate ${c.compositeWeights.silent_pause_rate}, speech rate ${c.compositeWeights.speech_rate_wpm}, mean length of run ${c.compositeWeights.mean_length_of_run}`,
    ),
  );
  out.push(line(`Transcription model: ${rec.deepgramModel}`));
  out.push(line(`Pipeline version: ${rec.pipelineVersion}`));
  out.push(
    line(`Pass: ${input.pass2 ? "2 (record of account), with pass 1 alongside" : "1 only"}`),
  );

  const doc = new Document({
    creator: "Viva Voice",
    title: `Viva Voice report ${rec.id} ${student}`,
    styles: { default: { document: { run: { font: DOC_FONT } } } },
    sections: [{ children: out }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
