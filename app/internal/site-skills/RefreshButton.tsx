"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    cases_scanned: number;
    rows_upserted: number;
    duration_ms: number;
  } | null>(null);

  async function handleClick() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/site-skills/refresh", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setLastResult(await res.json());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "refresh failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={running}
        className="rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[#2C2416] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Refreshing…" : "↻ Re-aggregate"}
      </button>
      {lastResult && (
        <p className="text-xs text-[var(--text-secondary)]">
          Scanned {lastResult.cases_scanned} cases · upserted {lastResult.rows_upserted} rows ·{" "}
          {lastResult.duration_ms}ms
        </p>
      )}
      {error && <p className="text-xs text-red-700">Refresh failed: {error}</p>}
    </div>
  );
}
