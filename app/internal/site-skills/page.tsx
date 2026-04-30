import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { listProviderSkills } from "@/lib/site-skills/aggregate";
import type { ProviderSkillSummary } from "@/lib/site-skills/types";
import { RefreshButton } from "./RefreshButton";

export const dynamic = "force-dynamic";

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function SiteSkillsPage() {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    if (access.status === 401) {
      return (
        <main className="min-h-screen bg-[var(--bg)] px-6 py-16 text-[var(--text-primary)]">
          <div className="mx-auto max-w-3xl rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_24px_80px_rgba(44,36,22,0.08)]">
            <p className="text-sm uppercase tracking-[0.22em] text-[var(--text-secondary)]">
              Internal Site Skills
            </p>
            <h1 className="mt-3 font-serif text-4xl text-[var(--text-primary)]">
              Sign in required
            </h1>
          </div>
        </main>
      );
    }
    notFound();
  }

  const skills = await listProviderSkills();

  // Group by task_type for clearer reading.
  const byTaskType = new Map<string, ProviderSkillSummary[]>();
  for (const s of skills) {
    const arr = byTaskType.get(s.task_type) ?? [];
    arr.push(s);
    byTaskType.set(s.task_type, arr);
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <section className="rounded-[32px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,246,239,0.92))] p-6 shadow-[0_24px_80px_rgba(44,36,22,0.08)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                Internal Site Skills
              </p>
              <h1 className="mt-3 font-serif text-4xl text-[var(--text-primary)]">
                Provider success registry
              </h1>
              <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
                Aggregated success rate + failure breakdown per (provider,
                task_type) pair, computed from finalised{" "}
                <Link href="/internal/benchmark" className="underline">
                  benchmark cases
                </Link>
                . Click <em>Re-aggregate</em> after a benchmark run to refresh.
                <br />
                <span className="text-xs">
                  Phase 4 minimum — only data-driven fields. Hand-curated
                  recovery_strategies will land once we have enough samples to
                  see real patterns.
                </span>
              </p>
            </div>
            <RefreshButton />
          </div>
        </section>

        {/* Sections by task_type */}
        {byTaskType.size === 0 ? (
          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--text-secondary)]">
            No aggregated data yet. Run a benchmark and click Re-aggregate.
          </section>
        ) : (
          Array.from(byTaskType.entries()).map(([taskType, rows]) => (
            <section
              key={taskType}
              className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_48px_rgba(44,36,22,0.06)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
                <h2 className="font-serif text-2xl">{taskType.replaceAll("_", " ")}</h2>
                <span className="text-xs text-[var(--text-secondary)]">
                  {rows.length} provider{rows.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--card-2)] text-left text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                    <tr>
                      <th className="px-6 py-3 font-medium">Provider</th>
                      <th className="px-6 py-3 text-right font-medium">Samples</th>
                      <th className="px-6 py-3 text-right font-medium">Success</th>
                      <th className="px-6 py-3 text-right font-medium">Avg duration</th>
                      <th className="px-6 py-3 font-medium">Top failure</th>
                      <th className="px-6 py-3 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {rows.map((s) => (
                      <tr
                        key={`${s.provider}-${s.task_type}`}
                        className="transition hover:bg-[var(--card-2)]"
                      >
                        <td className="px-6 py-3 font-medium">{s.provider}</td>
                        <td className="px-6 py-3 text-right tabular-nums">{s.sample_count}</td>
                        <td className="px-6 py-3 text-right tabular-nums">
                          {s.success_count}
                          <span className="ml-1 text-xs text-[var(--text-secondary)]">
                            ({pct(s.success_rate)})
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                          {s.avg_duration_s == null ? "—" : `${Math.round(s.avg_duration_s)}s`}
                        </td>
                        <td className="px-6 py-3">
                          {s.top_failure_reason ? (
                            <span className="font-mono text-xs text-[var(--text-secondary)]">
                              {s.top_failure_reason}
                              {" · "}
                              {s.failure_buckets[s.top_failure_reason]}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-secondary)]">—</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-xs text-[var(--text-secondary)]">
                          {formatDate(s.last_seen_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Failure breakdown sub-row, expandable in future iterations.
                  For now show as inline list under each row's mouse-over.
                  Keeping markup minimal so the dashboard stays readable. */}
            </section>
          ))
        )}
      </div>
    </main>
  );
}
