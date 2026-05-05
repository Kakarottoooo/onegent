/**
 * Refresh button for /dev/provider-closure.
 *
 * Tiny client subcomponent. Calls `router.refresh()` to re-render
 * the parent server component (which re-runs the loader and
 * re-reads `benchmark/runs/`). No live runner, no provider call,
 * no mutating fetch, no run/retry/start/resume/execute/submit
 * verb anywhere.
 *
 * Kept in its own file so the page itself stays a pure server
 * component.
 */

"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const onClick = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastRefreshedAt(new Date().toISOString());
    });
  }, [router]);

  return (
    <button
      type="button"
      className={className ?? "pcr__refresh-btn"}
      onClick={onClick}
      disabled={isPending}
      title="Re-render the server component, re-reading benchmark/runs/"
    >
      {isPending ? "Refreshing..." : "Refresh now"}
      {lastRefreshedAt && !isPending && (
        <span className="pcr__refresh-stamp">
          {" "}
          (last: {new Date(lastRefreshedAt).toLocaleTimeString()})
        </span>
      )}
    </button>
  );
}
