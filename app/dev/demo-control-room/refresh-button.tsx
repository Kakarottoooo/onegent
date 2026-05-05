/**
 * Refresh button for /dev/demo-control-room.
 *
 * Tiny client subcomponent -?calls `router.refresh()` to re-render
 * the parent server component (which re-runs the loader). No live
 * runner, no provider call, no mutating fetch.
 *
 * Kept in its own file so the page itself stays a pure server
 * component (avoids client-server import boundary crashes that
 * previously bit /dev/founder-e2e + others).
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
      className={className ?? "dcr__refresh-btn"}
      onClick={onClick}
      disabled={isPending}
      title="Re-render the server component, re-reading benchmark/runs/"
    >
      {isPending ? "Refreshing..." : "Refresh now"}
      {lastRefreshedAt && !isPending && (
        <span className="dcr__refresh-stamp">
          {" "}
          (last: {new Date(lastRefreshedAt).toLocaleTimeString()})
        </span>
      )}
    </button>
  );
}
