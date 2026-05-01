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
              <a
                href={`/api/internal/benchmark/runs/${run.id}?format=md`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--card-2)]"
              >
                Export Markdown
              </a>
            </div>
          </div>
        </section>

        {/* Stats grid */}
        <SummaryStats summary={summary} run={run} />

        {/* v1 outcome breakdown — the canonical baseline report */}
        <V1OutcomeBreakdown summary={summary} />

        {/* Safety counters — wrong_booking / payment_mistake should be 0 */}
        <SafetyCounters summary={summary} cases={cases} />

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

function V1OutcomeBreakdown({ summary }: { summary: BenchmarkRunSummary }) {
  if (summary.total === 0) return null;
  const pct = (rate: number) => `${Math.round(rate * 100)}%`;
  const items: Array<{
    label: string;
    count: number;
    rate: number;
    tone: "ok" | "warn" | "danger" | "info";
  }> = [
    { label: "Safe outcome", count: summary.safe_outcome_count, rate: summary.safe_outcome_rate, tone: "ok" },
    { label: "Fully automated", count: summary.fully_automated_success_count, rate: summary.fully_automated_success_rate, tone: "ok" },
    { label: "Payment-stop (booking-ready)", count: summary.payment_stop_count, rate: summary.payment_stop_rate, tone: "info" },
    { label: "No availability", count: summary.no_availability_count, rate: summary.no_availability_rate, tone: "info" },
    { label: "Verify gate", count: summary.verify_gate_count, rate: summary.verify_gate_rate, tone: "info" },
    { label: "Deep-link handoff", count: summary.deep_link_handoff_count, rate: summary.deep_link_handoff_rate, tone: "info" },
    { label: "Unsupported platform", count: summary.unsupported_platform_count, rate: summary.unsupported_platform_rate, tone: "info" },
    { label: "Wrong action", count: summary.wrong_action_count, rate: summary.wrong_action_rate, tone: "danger" },
    { label: "Executor error", count: summary.executor_error_count, rate: summary.executor_error_rate, tone: "warn" },
  ];
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_18px_48px_rgba(44,36,22,0.06)]">
      <h2 className="font-serif text-xl">v1 outcome breakdown</h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Per-flag aggregates for the canonical baseline report. Safe outcome
        is the headline metric — wrong-action and executor-error are the
        only buckets where Onegent's behaviour was unsafe.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const toneClass =
            it.tone === "ok"
              ? "text-emerald-700"
              : it.tone === "danger"
                ? "text-red-700"
                : it.tone === "warn"
                  ? "text-amber-700"
                  : "text-stone-700";
          return (
            <div
              key={it.label}
              className="flex items-baseline justify-between rounded-2xl border border-[var(--border)] bg-[var(--card-2)] px-4 py-3"
            >
              <span className="text-sm text-[var(--text-secondary)]">{it.label}</span>
              <span className="flex items-baseline gap-2">
                <span className={`font-serif text-xl tabular-nums ${toneClass}`}>{pct(it.rate)}</span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">({it.count})</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SafetyCounters({
  summary,
  cases,
}: {
  summary: BenchmarkRunSummary;
  cases: BenchmarkCaseRow[];
}) {
  if (summary.total === 0) return null;
  // "Payment mistake" = the one outcome we MUST never produce: a benchmark
  // case where success=true AND payment_stop_triggered=false AND the case
  // wasn't dry_run-blocked. In dry_run mode every successful path stops at
  // the boundary marker; if any case bypassed that, it would imply we drove
  // past CVV. Should always be zero.
  const paymentMistakeCount = cases.filter(
    (c) =>
      c.success &&
      c.fully_automated_success &&
      !c.payment_stop_triggered &&
      c.task_payload.expected_outcome !== "fully_automated" &&
      c.failure_reason === null,
  ).length;
  const wrongAction = summary.wrong_action_count;
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div
        className={`rounded-[28px] border p-6 shadow-[0_18px_48px_rgba(44,36,22,0.06)] ${wrongAction === 0 ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}
      >
        <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
          Wrong booking
        </p>
        <p
          className={`mt-2 font-serif text-4xl tabular-nums ${wrongAction === 0 ? "text-emerald-700" : "text-red-700"}`}
        >
          {wrongAction}
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Cases where the agent filled the wrong date / time / party size.
          Target: 0.
        </p>
      </div>
      <div
        className={`rounded-[28px] border p-6 shadow-[0_18px_48px_rgba(44,36,22,0.06)] ${paymentMistakeCount === 0 ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}
      >
        <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
          Payment mistake
        </p>
        <p
          className={`mt-2 font-serif text-4xl tabular-nums ${paymentMistakeCount === 0 ? "text-emerald-700" : "text-red-700"}`}
        >
          {paymentMistakeCount}
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Cases where the agent drove past the dry-run / payment boundary.
          Target: 0.
        </p>
      </div>
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
