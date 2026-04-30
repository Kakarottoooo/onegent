"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the run page every N seconds while the run isn't terminal yet.
 * Server component re-renders with fresh data because /internal/benchmark/[id]
 * uses dynamic = "force-dynamic". Stops polling once the parent passes
 * `terminal=true`.
 */
export function AutoRefresh({
  terminal,
  intervalMs = 10_000,
}: {
  terminal: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (terminal) return;
    const handle = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(handle);
  }, [terminal, intervalMs, router]);

  return null;
}
