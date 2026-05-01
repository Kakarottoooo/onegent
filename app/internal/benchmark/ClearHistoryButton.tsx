"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Wipe benchmark run history. By default skips runs that are still
 * pending/running so we don't orphan an in-flight Chrome session — there's
 * an "include running" checkbox for when the user really does want to nuke
 * a stuck run too.
 */
export function ClearHistoryButton() {
  const router = useRouter();
  const [includeInFlight, setIncludeInFlight] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(
      includeInFlight
        ? "Delete ALL benchmark runs (including any pending/running)?\n\nThis cannot be undone."
        : "Delete all completed benchmark runs?\n\nIn-flight (pending/running) runs will be kept. This cannot be undone.",
    );
    if (!confirmed) return;

    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/internal/benchmark/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeInFlight }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason = (data as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(reason);
      }
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={includeInFlight}
            onChange={(e) => setIncludeInFlight(e.target.checked)}
            disabled={running}
            className="h-3.5 w-3.5 rounded border-[var(--border)]"
          />
          Include in-flight
        </label>
        <button
          type="button"
          onClick={handleClick}
          disabled={running}
          className="rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Clearing…" : "Clear history"}
        </button>
      </div>
      {errorMsg && (
        <p className="text-xs text-red-700">Cleanup failed: {errorMsg}</p>
      )}
    </div>
  );
}
