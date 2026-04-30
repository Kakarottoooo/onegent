import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { resolveBenchmarkRun } from "@/lib/benchmark/run-restaurant-benchmark";
import type {
  BenchmarkCaseRow,
  BenchmarkRunRow,
  BenchmarkRunSummary,
} from "@/lib/benchmark/types";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function isTerminal(run: BenchmarkRunRow, cases: BenchmarkCaseRow[]): boolean {
  if (run.status !== "running" && run.status !== "pending") return true;
  return !cases.some(
    (c) => c.status === "running" || c.status === "pending",
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default async function BenchmarkRunDetailPage({ params }: Params) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    if (access.status === 401) {
      return (
        <main className="min-h-screen bg-[var(--bg)] px-6 py-16 text-[var(--text-primary)]">
          <div className="mx-auto max-w-3xl rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_24px_80px_rgba(44,36,22,0.08)]">
            <h1 className="font-serif text-3xl">Sign in required</h1>
          </div>
        </main>
      );
    }
    notFound();
  }

  const { runId } = await params;
  const { run, cases, summary } = await resolveBenchmarkRun(runId);

  if (!run) {
    notFound();
  }

  const terminal = isTerminal(run, cases);

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <AutoRefresh terminal={terminal} />

      <div className="mx-auto max-w-6xl space-y-6">
        {/* Breadcrumb + header */}
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Link href="/internal/benchmark" className="hover:underline">
            ← Benchmark runs
          </Link>
          <span>/</span>
          <span className="font-mono text-xs">{run.id}</span>
        </div>

        <section className="rounded-[32px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,246,239,0.92))] p-6 shadow-[0_24px_80px_rgba(44,36,22,0.08)] sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                {run.scenario.replaceAll("_", " ")} · {run.city}
              </p>
              <h1 className="mt-2 font-serif text-3xl text-[var(--text-primary)]">
                {run.name}
              </h1>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Created {formatDate(run.created_at)}
                {run.completed_at ? ` · Completed ${formatDate(run.completed_at)}` : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill label={`mode: ${run.mode}`} tone="neutral" />
              <Pill
                label={run.status}
                tone={
                  run.status === "completed"
                    ? "success"
                    : run.status === "running"
                      ? "warn"
                      : run.status === "errored"
                        ? "error"
                        : "neutral"
                }
              />
              {!terminal && (
                <span className="text-xs text-[var(--text-secondary)]">
                  · auto-refreshing every 10s
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Stats grid */}
        <SummaryStats summary={summary} run={run} />

        {/* Failure breakdown */}
        <FailureBreakdown summary={summary} />

        {/* Cases table */}
        <CasesTable cases={cases} />
      </div>
    </main>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warn" | "error" | "neutral";
}) {
  const cls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "error"
          ? "bg-red-50 text-red-700 ring-red-200"
          : "bg-stone-50 text-stone-700 ring-stone-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

function SummaryStats({
  summary,
  run,
}: {
  summary: BenchmarkRunSummary;
  run: BenchmarkRunRow;
}) {
  const successRatePct =
    summary.total === 0
      ? 0
      : Math.round(summary.success_rate * 100);
  const items: { label: string; value: string }[] = [
    { label: "Total cases", value: String(summary.total) },
    {
      label: "Success rate",
      value: summary.total === 0 ? "—" : `${successRatePct}%`,
    },
    {
      label: "Succeeded",
      value: String(summary.by_status.succeeded),
    },
    {
      label: "Failed",
      value: String(summary.by_status.failed),
    },
    {
      label: "Running",
      value: String(summary.by_status.pending + summary.by_status.running),
    },
    {
      label: "Avg duration",
      value:
        summary.avg_duration_seconds == null
          ? "—"
          : `${Math.round(summary.avg_duration_seconds)}s`,
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_8px_24px_rgba(44,36,22,0.04)]"
        >
          <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
            {it.label}
          </p>
          <p className="mt-1 font-serif text-2xl text-[var(--text-primary)]">
            {it.value}
          </p>
        </div>
      ))}
    </section>
  );
}

function FailureBreakdown({ summary }: { summary: BenchmarkRunSummary }) {
  const entries = Object.entries(summary.by_failure_reason).sort(
    ([, a], [, b]) => (b ?? 0) - (a ?? 0),
  );
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_18px_48px_rgba(44,36,22,0.06)]">
      <h2 className="font-serif text-xl">Failure breakdown</h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Buckets come from the canonical failure taxonomy in
        <code className="mx-1">lib/benchmark/types.ts</code>.
      </p>
      <ul className="mt-4 space-y-1.5 text-sm">
        {entries.map(([reason, count]) => (
          <li key={reason} className="flex items-center justify-between">
            <span className="font-mono text-xs text-[var(--text-secondary)]">
              {reason}
            </span>
            <span className="tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CasesTable({ cases }: { cases: BenchmarkCaseRow[] }) {
  if (cases.length === 0) return null;
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_48px_rgba(44,36,22,0.06)]">
      <header className="border-b border-[var(--border)] px-6 py-4">
        <h2 className="font-serif text-xl">Cases</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--card-2)] text-left text-xs uppercase tracking-wider text-[var(--text-secondary)]">
            <tr>
              <th className="px-6 py-3 font-medium">Case</th>
              <th className="px-6 py-3 font-medium">Provider</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Failure reason</th>
              <th className="px-6 py-3 text-right font-medium">Duration</th>
              <th className="px-6 py-3 font-medium">Booking job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {cases.map((c) => (
              <tr key={c.id} className="transition hover:bg-[var(--card-2)]">
                <td className="px-6 py-3">
                  <p className="font-medium text-[var(--text-primary)]">
                    {c.task_payload.restaurant_name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    {c.case_id} · {c.task_payload.city}
                  </p>
                </td>
                <td className="px-6 py-3 text-[var(--text-secondary)]">
                  {c.provider ?? c.task_payload.expected_provider}
                </td>
                <td className="px-6 py-3">
                  <StatusPill status={c.status} success={c.success} />
                </td>
                <td className="px-6 py-3">
                  {c.failure_reason ? (
                    <span className="font-mono text-xs text-[var(--text-secondary)]">
                      {c.failure_reason}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--text-secondary)]">—</span>
                  )}
                </td>
                <td className="px-6 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatDuration(c.duration_seconds)}
                </td>
                <td className="px-6 py-3 font-mono text-xs text-[var(--text-secondary)]">
                  {c.booking_job_id ? c.booking_job_id.slice(0, 8) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ status, success }: { status: string; success: boolean }) {
  const tone =
    status === "succeeded"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "failed"
        ? "bg-red-50 text-red-700 ring-red-200"
        : status === "running"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : status === "skipped" || status === "timed_out"
            ? "bg-stone-50 text-stone-700 ring-stone-200"
            : "bg-stone-50 text-stone-700 ring-stone-200";
  const label = status === "succeeded" && success ? "succeeded ✓" : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${tone}`}
    >
      {label}
    </span>
  );
}
