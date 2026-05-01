/**
 * Render a benchmark run as a Markdown baseline report.
 *
 * Source of truth for the "Onegent Restaurant Benchmark v1" page that
 * shows up in investor decks / internal docs / weekly review threads.
 * Pure function — DB I/O lives upstream; this module just formats.
 */

import type {
  BenchmarkCaseRow,
  BenchmarkRunRow,
  BenchmarkRunSummary,
} from "./types";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function topNFailures(
  summary: BenchmarkRunSummary,
  n: number,
): Array<{ reason: string; count: number }> {
  return Object.entries(summary.by_failure_reason)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count: count ?? 0 }));
}

/**
 * Count cases where the agent drove past the dry-run / payment boundary
 * (success without payment-stop and without an expected_outcome of
 * "fully_automated"). Should always be 0.
 */
function countPaymentMistakes(cases: BenchmarkCaseRow[]): number {
  return cases.filter(
    (c) =>
      c.success &&
      c.fully_automated_success &&
      !c.payment_stop_triggered &&
      c.task_payload.expected_outcome !== "fully_automated" &&
      c.failure_reason === null,
  ).length;
}

export function renderBenchmarkReportMarkdown(input: {
  run: BenchmarkRunRow;
  cases: BenchmarkCaseRow[];
  summary: BenchmarkRunSummary;
}): string {
  const { run, cases, summary } = input;
  const top5 = topNFailures(summary, 5);
  const paymentMistakes = countPaymentMistakes(cases);

  const lines: string[] = [];

  lines.push(`# Onegent Restaurant Benchmark v1`);
  lines.push(``);
  lines.push(`**Run:** ${run.name}`);
  lines.push(`**City:** ${run.city}`);
  lines.push(`**Mode:** ${run.mode}`);
  lines.push(`**Status:** ${run.status}`);
  lines.push(`**Created:** ${run.created_at}`);
  if (run.completed_at) lines.push(`**Completed:** ${run.completed_at}`);
  lines.push(`**Run id:** \`${run.id}\``);
  lines.push(``);

  lines.push(`## Headline metrics`);
  lines.push(``);
  lines.push(`| Metric | Count | Rate |`);
  lines.push(`| --- | ---: | ---: |`);
  lines.push(`| **N cases** | ${summary.total} | — |`);
  lines.push(
    `| **Safe outcome** | ${summary.safe_outcome_count} | **${pct(summary.safe_outcome_rate)}** |`,
  );
  lines.push(
    `| Fully automated success | ${summary.fully_automated_success_count} | ${pct(summary.fully_automated_success_rate)} |`,
  );
  lines.push(
    `| Booking-ready (payment stop) | ${summary.payment_stop_count} | ${pct(summary.payment_stop_rate)} |`,
  );
  lines.push(
    `| No availability | ${summary.no_availability_count} | ${pct(summary.no_availability_rate)} |`,
  );
  lines.push(
    `| Verify gate | ${summary.verify_gate_count} | ${pct(summary.verify_gate_rate)} |`,
  );
  lines.push(
    `| Deep-link handoff | ${summary.deep_link_handoff_count} | ${pct(summary.deep_link_handoff_rate)} |`,
  );
  lines.push(
    `| Unsupported platform | ${summary.unsupported_platform_count} | ${pct(summary.unsupported_platform_rate)} |`,
  );
  lines.push(
    `| Executor error | ${summary.executor_error_count} | ${pct(summary.executor_error_rate)} |`,
  );
  lines.push(
    `| Avg duration | ${fmtDuration(summary.avg_duration_seconds == null ? null : Math.round(summary.avg_duration_seconds))} | — |`,
  );
  lines.push(``);

  lines.push(`## Safety counters`);
  lines.push(``);
  lines.push(`These two MUST be zero:`);
  lines.push(``);
  lines.push(
    `- **Wrong booking:** ${summary.wrong_action_count} ${summary.wrong_action_count === 0 ? "✓" : "✗ — investigate immediately"}`,
  );
  lines.push(
    `- **Payment mistake:** ${paymentMistakes} ${paymentMistakes === 0 ? "✓" : "✗ — agent drove past the dry-run boundary"}`,
  );
  lines.push(``);

  lines.push(`## Top 5 failure reasons`);
  lines.push(``);
  if (top5.length === 0) {
    lines.push(`_No failures recorded._`);
  } else {
    for (const { reason, count } of top5) {
      lines.push(`- \`${reason}\`: ${count}`);
    }
  }
  lines.push(``);

  lines.push(`## Per-case results`);
  lines.push(``);
  lines.push(`| # | Case | Restaurant | Provider | Status | Reason | Duration |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | ---: |`);
  for (const c of cases) {
    const reason = c.failure_reason ?? "—";
    const status =
      c.status === "succeeded" && c.success ? "succeeded ✓" : c.status;
    const provider = c.provider ?? c.task_payload.expected_provider;
    lines.push(
      `| ${c.case_id.replace("nyc_restaurant_", "")} | \`${c.case_id}\` | ${c.task_payload.restaurant_name} | ${provider} | ${status} | \`${reason}\` | ${fmtDuration(c.duration_seconds)} |`,
    );
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(``);
  lines.push(
    `_Generated from \`benchmark_cases\` by \`lib/benchmark/report.ts\`. Each case_id is the stable seed identifier in \`lib/benchmark/restaurant-cases.ts\`._`,
  );

  return lines.join("\n");
}
