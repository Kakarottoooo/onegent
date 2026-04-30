"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Trigger a new benchmark run from the dashboard. Posts to /seed which
 * creates the run + dispatches up to maxCases booking jobs (fire-and-forget).
 *
 * UX: dropdown for case count, button shows loading state, disables on error.
 * Page navigates to the new run's detail view on success.
 */
export function TriggerRunButton() {
  const router = useRouter();
  const [maxCases, setMaxCases] = useState<number>(1);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/internal/benchmark/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "dry_run",
          maxCases,
          name: `Dashboard run ${new Date().toLocaleString()}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason = (data as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(reason);
      }
      const data = (await res.json()) as { run_id: string };
      router.push(`/internal/benchmark/${data.run_id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "unknown error");
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <label className="text-sm text-[var(--text-secondary)]">
          Cases:
          <select
            value={maxCases}
            onChange={(e) => setMaxCases(Number(e.target.value))}
            disabled={running}
            className="ml-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleClick}
          disabled={running}
          className="rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[#2C2416] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Dispatching…" : "Trigger benchmark run"}
        </button>
      </div>
      {errorMsg && (
        <p className="text-xs text-red-700">Trigger failed: {errorMsg}</p>
      )}
    </div>
  );
}
