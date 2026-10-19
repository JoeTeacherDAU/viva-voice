"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionSummary } from "@/lib/output/sessionList";
import { Card } from "@/lib/ui";

/** Groups summaries by session label; live sessions share one group at the end. */
function groups(sessions: SessionSummary[]): { label: string | null; items: SessionSummary[] }[] {
  const out: { label: string | null; items: SessionSummary[] }[] = [];
  for (const s of sessions) {
    const g = out.find((x) => x.label === s.sessionLabel);
    if (g) g.items.push(s);
    else out.push({ label: s.sessionLabel, items: [s] });
  }
  return out;
}

/** Every archived session, file imports grouped by session label beside live sessions (work order 02). */
export function ReviewListClient() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [status, setStatus] = useState("Loading");

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await fetch("/api/sessions", { cache: "no-store" });
      if (!live) return;
      if (!r.ok) {
        setStatus(`The session list did not load (HTTP ${r.status}).`);
        return;
      }
      const body = (await r.json()) as { sessions: SessionSummary[] };
      setSessions(body.sessions);
      setStatus(body.sessions.length ? "" : "The archive holds no sessions yet.");
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="flex flex-col gap-6 p-8 max-w-5xl w-full mx-auto">
      <div className="flex items-baseline gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold">Sessions</h1>
        <Link className="text-primary underline" href="/import/session">
          Import a session file
        </Link>
        <Link className="text-primary underline" href="/setup">
          Live setup
        </Link>
      </div>
      {status ? <p className="text-on-surface-variant">{status}</p> : null}
      {groups(sessions ?? []).map((g) => (
        <Card
          key={g.label ?? "live"}
          className="flex flex-col gap-3"
          data-testid={`group-${g.label ?? "live"}`}
        >
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="text-xl font-medium">{g.label ?? "Live sessions"}</h2>
            <span className="text-sm text-on-surface-variant">
              {g.label
                ? `file import, ${g.items[0].sessionDate}, exam ${g.items[0].examId}`
                : "live"}
            </span>
            {g.label ? (
              <a
                className="rounded-control border border-outline-variant px-4 py-2 ml-auto text-sm"
                href={`/api/session-download?label=${encodeURIComponent(g.label)}`}
                download={`${g.label}.zip`}
              >
                Download all
              </a>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {g.items.map((s) => (
              <li key={s.id} className="flex gap-3 flex-wrap" data-testid={`session-${s.id}`}>
                <Link className="text-primary underline" href={`/review/${s.id}`}>
                  {s.id}
                </Link>
                <span className="text-on-surface-variant">
                  {s.captureMode === "file-import" ? "file import" : "live"}
                </span>
                <span>
                  <span className="text-student-a">A {s.participantIds.A}</span>,{" "}
                  <span className="text-student-b">B {s.participantIds.B}</span>
                </span>
                <span className={s.status.startsWith("excluded") ? "text-warn" : ""}>
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </main>
  );
}
