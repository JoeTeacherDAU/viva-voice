"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeatureValue, SessionRecord } from "@/lib/analysis/types";
import { featureLabel, formatValue } from "@/lib/output/format";
import { byTier, thresholdsFor } from "@/lib/registry";
import { Button, Card, Icon } from "@/lib/ui";

interface Measurements {
  pipelineVersion: string;
  features: FeatureValue[];
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
