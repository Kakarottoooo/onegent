import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { listBenchmarkRuns } from "@/lib/benchmark/store";
import { TriggerRunButton } from "./TriggerRunButton";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function successRate(success: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((success / total) * 100)}%`;
}

export default async function BenchmarkListPage() {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    if (access.status === 401) {
      return (
        <main className="min-h-screen bg-[var(--bg)] px-6 py-16 text-[var(--text-primary)]">
          <div className="mx-auto max-w-3xl rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_24px_80px_rgba(44,36,22,0.08)]">
            <p className="text-sm uppercase tracking-[0.22em] text-[var(--text-secondary)]">
              Internal Benchmark
            </p>
            <h1 className="mt-3 font-serif text-4xl text-[var(--text-primary)]">
              Sign in required
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
              This internal view is only available to signed-in allowlisted users.
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }

  const runs = await listBenchmarkRuns(50);

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <section className="rounded-[32px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,246,239,0.92))] p-6 shadow-[0_24px_80px_rgba(44,36,22,0.08)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                Internal Benchmark
              </p>
              <h1 className="mt-3 font-serif text-4xl text-[var(--text-primary)]">
                Restaurant booking benchmark
              </h1>
              <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
                Real-dispatch runs against OpenTable / Resy with{" "}
                <code>autonomy.benchmark_dry_run = true</code>. Providers fill
                the form but refuse the final submit click — proves end-to-end
                automation without producing real reservations.
              </p>
            </div>

            <TriggerRunButton />
          </div>
        </section>

        {/* Runs table */}
        <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_48px_rgba(44,36,22,0.06)]">
          <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
            <h2 className="font-serif text-2xl">Recent runs</h2>
            <span className="text-xs text-[var(--text-secondary)]">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </header>

          {runs.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">
              No benchmark runs yet. Hit{" "}
              <span className="font-medium text-[var(--text-primary)]">
                Trigger benchmark run
              </span>{" "}
              above to dispatch your first case.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--card-2)] text-left text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                  <tr>
                    <th className="px-6 py-3 font-medium">Run</th>
                    <th className="px-6 py-3 font-medium">Mode</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 text-right font-medium">Cases</th>
                    <th className="px-6 py-3 text-right font-medium">Success</th>
                    <th className="px-6 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="transition hover:bg-[var(--card-2)]"
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/internal/benchmark/${run.id}`}
                          className="font-medium text-[var(--text-primary)] hover:underline"
                        >
                          {run.name}
                        </Link>
                        <p className="mt-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {run.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-6 py-3 text-[var(--text-secondary)]">
                        {run.mode === "dry_run" ? "dry_run" : run.mode}
                      </td>
                      <td className="px-6 py-3">
                        <StatusPill status={run.status} />
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {run.total_cases}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {run.success_cases}
                        <span className="ml-1 text-xs text-[var(--text-secondary)]">
                          ({successRate(run.success_cases, run.total_cases)})
                        </span>
                      </td>
                      <td className="px-6 py-3 text-xs text-[var(--text-secondary)]">
                        {formatDate(run.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "running"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : status === "errored"
          ? "bg-red-50 text-red-700 ring-red-200"
          : "bg-stone-50 text-stone-700 ring-stone-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${tone}`}
    >
      {status}
    </span>
  );
}
