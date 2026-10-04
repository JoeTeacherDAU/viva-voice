"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { SessionRecord } from "@/lib/analysis/types";
import { getSession } from "@/lib/storage/local";
import { Card } from "@/lib/ui";

// Placeholder until phase P5 builds the live display.
function SessionPlaceholder() {
  const id = useSearchParams().get("id") ?? "";
  const [rec, setRec] = useState<SessionRecord | null>(null);
  useEffect(() => {
    if (id) void getSession(id).then((r) => setRec(r ?? null));
  }, [id]);
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Session {id}</h1>
        <p data-testid="session-state">{rec ? `State: ${rec.state}` : "Loading"}</p>
      </Card>
    </main>
  );
}

export default function SessionPage() {
  return (
    <Suspense>
      <SessionPlaceholder />
    </Suspense>
  );
}
