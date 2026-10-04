"use client";

import { useCallback, useEffect, useState } from "react";
import { PIPELINE_VERSION } from "@/lib/analysis/pipeline";
import type {
  Baseline,
  EnergyTrack,
  FeatureValue,
  SessionRecord,
  Word,
} from "@/lib/analysis/types";
import { diffFeatures, replicate, type FeatureDiff } from "@/lib/output/replicate";
import { featureLabel, formatValue } from "@/lib/output/format";
import { byTier, thresholdsFor } from "@/lib/registry";
import { Button, Card, Icon } from "@/lib/ui";

interface Measurements {
  pipelineVersion: string;
  features: FeatureValue[];
  baseline?: Baseline | null;
  model?: string;
  createdAt?: string;
}

interface Comparison {
  label: string;
  diffs: FeatureDiff[];
}

/** Pass one and pass two disagree when they differ by more than this share. */
export const AGREEMENT_TOLERANCE = 0.1;

async function fetchJson<T>(pathname: string): Promise<T | null> {
  const r = await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`, {
    cache: "no-store",
  });
  return r.ok ? ((await r.json()) as T) : null;
}

function disagree(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && Math.abs(a - b) / scale > AGREEMENT_TOLERANCE;
}

export function ReviewClient({ id }: { id: string }) {
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [m1, setM1] = useState<Measurements | null>(null);
  const [m2, setM2] = useState<Measurements | null>(null);
  const [status, setStatus] = useState<string | null>("Loading");
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<SessionRecord>(`sessions/${id}.json`);
    setRec(r);
    setM1(await fetchJson<Measurements>(`measurements/${id}/pass1.json`));
    setM2(await fetchJson<Measurements>(`measurements/${id}/pass2.json`));
    setStatus(r ? null : `No archived session ${id}.`);
  }, [id]);

  useEffect(() => {
    // Load once on mount; load() sets state only after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function runPass2() {
    setBusy(true);
    setStatus("Running pass two");
    const res = await fetch("/api/pass2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setStatus(`Pass two failed: ${body.error ?? res.status}`);
      return;
    }
    setStatus(null);
    await load();
  }

  /** Replication run (build-plan P7.2): the current pipeline over the stored pass-two transcript. */
  async function recompute() {
    if (!rec || !m2) return;
    setStatus("Recomputing from the stored transcript");
    const t = await fetchJson<{ words: Word[] }>(`transcripts/${id}/pass2.json`);
    const energy = await fetchJson<EnergyTrack>(`energy/${id}.json`);
    if (!t) {
      setStatus("No stored pass-two transcript.");
      return;
    }
    const fresh = replicate({
      record: rec,
      words: t.words,
      energy,
      baseline: m2.baseline ?? null,
      pass1: m1?.features ?? null,
    });
    setComparison({
      label: `Replication run (pipeline ${PIPELINE_VERSION})`,
      diffs: diffFeatures(m2.features, fresh),
    });
    setStatus(null);
  }

  /** Robustness check: a fresh pass two into separate files, compared with the record of account. */
  async function retranscribe() {
    if (!m2) return;
    setBusy(true);
    setStatus("Re-transcribing");
    const res = await fetch("/api/pass2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: id, robustness: true }),
    });
    const out = (await res.json()) as { error?: string; measurements?: string };
    setBusy(false);
    if (!res.ok || !out.measurements) {
      setStatus(`Re-transcribe failed: ${out.error ?? res.status}`);
      return;
    }
    const check = await fetchJson<Measurements>(out.measurements);
    setComparison({
      label: `Robustness check (model ${check?.model ?? "unknown"}, ${check?.createdAt?.slice(0, 10) ?? ""})`,
      diffs: diffFeatures(m2.features, check?.features ?? []),
    });
    setStatus(null);
  }

  const value = (fs: FeatureValue[] | undefined, fid: string, P: string, t: number | null) =>
    fs?.find(
      (f) =>
        f.featureId === fid && f.participant === P && f.window === "full" && f.thresholdMs === t,
    )?.value;

  const rows = byTier(1).flatMap((f) => {
    const ts = thresholdsFor(f.id) ?? [
      m2?.features.find((x) => x.featureId === f.id)?.thresholdMs ??
        m1?.features.find((x) => x.featureId === f.id)?.thresholdMs ??
        null,
    ];
    return ts.map((t) => ({ id: f.id, t, unit: f.unit }));
  });

  return (
    <main className="flex flex-col gap-6 p-8 max-w-6xl w-full mx-auto">
      <h1 className="text-3xl font-semibold">Session {id}</h1>
      {status ? (
        <p data-testid="review-status" className="text-on-surface-variant">
          {status}
        </p>
      ) : null}
      {rec ? (
        <>
          <Card className="flex flex-wrap gap-4 items-center">
            <p data-testid="review-state">State: {rec.state}</p>
            <p className="text-on-surface-variant text-sm">
              Exam {rec.examId}. Pipeline {rec.pipelineVersion}. Model {rec.deepgramModel}.
            </p>
            <div className="flex gap-3 ml-auto flex-wrap">
              {!rec.passes["2"] ? (
                <Button variant="filled" onClick={runPass2} disabled={busy}>
                  Run pass two
                </Button>
              ) : null}
              {rec.passes["2"] ? (
                <>
                  <Button onClick={recompute} disabled={busy}>
                    Recompute from stored transcript
                  </Button>
                  <Button onClick={retranscribe} disabled={busy}>
                    Re-transcribe
                  </Button>
                  <a
                    className="rounded-control border border-outline-variant px-4 py-2"
                    href={`/api/file?pathname=${encodeURIComponent(`documents/${id}/A.docx`)}`}
                    download={`${id}-A.docx`}
                  >
                    A.docx
                  </a>
                  <a
                    className="rounded-control border border-outline-variant px-4 py-2"
                    href={`/api/file?pathname=${encodeURIComponent(`documents/${id}/B.docx`)}`}
                    download={`${id}-B.docx`}
                  >
                    B.docx
                  </a>
                </>
              ) : null}
              <a
                className="rounded-control border border-outline-variant px-4 py-2"
                href={`/api/bundle?sessionId=${encodeURIComponent(id)}`}
                download={`${id}.zip`}
              >
                bundle.zip
              </a>
            </div>
          </Card>

          {comparison ? (
            <Card className="flex flex-col gap-2" data-testid="comparison">
              <p data-testid="comparison-result">
                {comparison.label}: {comparison.diffs.length} difference
                {comparison.diffs.length === 1 ? "" : "s"} from the stored measurements.
              </p>
              {comparison.diffs.slice(0, 20).map((d) => (
                <p
                  key={`${d.featureId}-${d.participant}-${d.window}-${d.thresholdMs}`}
                  className="text-sm text-warn"
                >
                  {featureLabel(d.featureId)} {d.participant} {d.window}
                  {d.thresholdMs !== null ? ` at ${d.thresholdMs} ms` : ""}: stored{" "}
                  {formatValue(d.stored)}, now {formatValue(d.fresh)}
                </p>
              ))}
            </Card>
          ) : null}

          <Card className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pass-table">
              <thead className="text-on-surface-variant text-left">
                <tr>
                  <th className="py-2 pr-4">Feature</th>
                  <th className="py-2 pr-4 text-student-a">A pass 1</th>
                  <th className="py-2 pr-4 text-student-a">A pass 2</th>
                  <th className="py-2 pr-4 text-student-b">B pass 1</th>
                  <th className="py-2 pr-4 text-student-b">B pass 2</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id: fid, t, unit }) => {
                  const cells = (["A", "B"] as const).flatMap((P) => {
                    const a = value(m1?.features, fid, P, t);
                    const b = value(m2?.features, fid, P, t);
                    const flag = disagree(a, b);
                    return [
                      <td key={`${P}1`} className="py-1 pr-4 tabular-nums">
                        {formatValue(a)}
                      </td>,
                      <td
                        key={`${P}2`}
                        className={`py-1 pr-4 tabular-nums ${flag ? "text-warn" : ""}`}
                        data-flag={flag || undefined}
                      >
                        {formatValue(b)}
                        {flag ? (
                          <Icon name="warning" className="text-[16px] align-middle ml-1" />
                        ) : null}
                      </td>,
                    ];
                  });
                  return (
                    <tr key={`${fid}-${t}`} className="border-t border-outline-variant">
                      <td className="py-1 pr-4">
                        {featureLabel(fid)}
                        {t !== null ? ` at ${t} ms` : ""}{" "}
                        <span className="text-on-surface-variant">({unit})</span>
                      </td>
                      {cells}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-on-surface-variant text-xs mt-3">
              Amber marks a pass-two value more than {AGREEMENT_TOLERANCE * 100} percent away from
              pass one.
            </p>
          </Card>
        </>
      ) : null}
    </main>
  );
}
