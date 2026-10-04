"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Icon } from "@/lib/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      const next = params.get("next");
      // Only follow same-site relative paths.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } else {
      setError(res.status === 401 ? "That password is wrong." : "Login failed.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-on-surface-variant">Password</span>
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-control bg-surface-highest border border-outline-variant px-3 py-2 text-on-surface"
        />
      </label>
      {error ? (
        <p className="flex items-center gap-2 text-fault" role="alert">
          <Icon name="error" />
          {error}
        </p>
      ) : null}
      <Button variant="filled" type="submit" disabled={busy || password.length === 0}>
        Sign in
      </Button>
    </form>
  );
}
