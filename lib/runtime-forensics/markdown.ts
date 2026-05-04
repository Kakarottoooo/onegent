/**
 * Forensics → paste-ready markdown bug report.
 *
 * Format optimized for pasting into a chat with codex / Claude.
 * The dashboard renders this verbatim into a `<textarea readOnly>`
 * that the operator triple-clicks to copy.
 *
 * Pure module.
 */

import {
  FAILURE_CLASS_LABEL,
  FORENSICS_SEVERITY_LABEL,
  type ClassifierSignal,
  type ForensicsReport,
} from "./types";
import {
  recommendNextEvidence,
  type Recommendation,
  type RecommendOptions,
} from "./recommendations";

export interface FormatBugReportOptions extends RecommendOptions {
  /**
   * Override the recommendation entirely (e.g. tests). When absent the
   * formatter calls `recommendNextEvidence(report, options)`.
   */
  recommendation?: Recommendation;
}

export function formatForensicsBugReport(
  report: ForensicsReport,
  options: FormatBugReportOptions = {},
): string {
  const recommendation =
    options.recommendation ?? recommendNextEvidence(report, options);
  const lines: string[] = [];

  const fixtureTag = report.isFixture ? "[FIXTURE] " : "";
  lines.push(
    `## ${fixtureTag}[${FORENSICS_SEVERITY_LABEL[report.classification.severity]}] Runtime forensics — ${
      FAILURE_CLASS_LABEL[report.classification.primaryClass]
    }`,
  );
  if (report.isFixture) {
    lines.push("");
    lines.push(
      "_This row is a synthetic fixture, not real evidence. " +
        "Do not file bugs against it._",
    );
  }
  lines.push("");
  lines.push(`- **Job id**: \`${report.jobId ?? "(unknown)"}\``);
  if (report.taskId) lines.push(`- **Task id**: \`${report.taskId}\``);
  if (report.sessionId) lines.push(`- **Session id**: \`${report.sessionId}\``);
  lines.push(`- **Provider**: \`${report.provider}\``);
  lines.push(`- **Scenario**: \`${report.scenario}\``);
  lines.push(`- **Status**: \`${report.status}\``);
  if (report.updatedAt) lines.push(`- **Updated**: ${report.updatedAt}`);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Input source**: \`${report.inputSource}\``);
  lines.push(
    `- **Confidence**: \`${report.classification.confidence}\` (winning weight: ${
      (report.classification.perClassWeights[report.classification.primaryClass] ?? 0).toFixed(2)
    })`,
  );
  if (report.classification.alternatives.length > 0) {
    const altText = report.classification.alternatives
      .slice(0, 3)
      .map((a) => `\`${a.class}\` (${a.weight.toFixed(2)})`)
      .join(", ");
    lines.push(`- **Alternative classes**: ${altText}`);
  }
  lines.push("");

  // ── Verdict reason
  lines.push("### Verdict reason");
  lines.push("");
  if (report.classification.signals.length === 0) {
    lines.push("_No matching signals — classifier returned `unknown`._");
  } else {
    lines.push("Top matched signals (highest weight first):");
    lines.push("");
    for (const s of report.classification.signals.slice(0, 8)) {
      lines.push(formatSignalLine(s));
    }
  }
  lines.push("");

  // ── Step shape audit
  lines.push("### Step shape audit");
  lines.push("");
  lines.push(
    `- Total steps: **${report.stepShape.totalSteps}** ` +
      `(with __source: ${report.stepShape.stepsWithSourceMarker}, ` +
      `missing __source: ${report.stepShape.stepsMissingSourceMarker})`,
  );
  if (report.stepShape.hasLegacyShapeBug) {
    lines.push(
      "- **[!] Legacy-shape bug detected** — step reached worker without " +
        "`__source` marker. This is a P0: M5 force-gate at " +
        "`app/api/booking-jobs/[id]/start/route.ts` failed to stamp the step.",
    );
  }
  if (report.stepShape.legacyShapeQuotes.length > 0) {
    lines.push("");
    lines.push("Legacy-shape quotes:");
    lines.push("");
    for (const q of report.stepShape.legacyShapeQuotes.slice(0, 4)) {
      lines.push(`- > ${escapeQuote(q)}`);
    }
  }
  lines.push("");

  // ── Raw fields
  lines.push("### Raw terminal fields");
  lines.push("");
  if (report.rawTerminalReason) {
    lines.push("**terminalReason**:");
    lines.push("```");
    lines.push(truncateBlock(report.rawTerminalReason, 1024));
    lines.push("```");
    lines.push("");
  }
  if (report.rawTerminalCode) {
    lines.push(`**terminalCode**: \`${report.rawTerminalCode}\``);
    lines.push("");
  }
  if (report.rawErrorMessage) {
    lines.push("**errorMessage**:");
    lines.push("```");
    lines.push(truncateBlock(report.rawErrorMessage, 1024));
    lines.push("```");
    lines.push("");
  }

  // ── Decision log
  if (report.decisionLogSummary.totalEntries > 0) {
    lines.push("### Decision log");
    lines.push("");
    lines.push(
      `- Total entries: ${report.decisionLogSummary.totalEntries}; ` +
        `levels: ${formatLevelMap(report.decisionLogSummary.byLevel)}`,
    );
    if (report.decisionLogSummary.topEvents.length > 0) {
      lines.push("- Top events:");
      for (const e of report.decisionLogSummary.topEvents) {
        lines.push(`  - \`${e.event}\` × ${e.count}`);
      }
    }
    if (report.decisionLogSummary.notableSignals.length > 0) {
      lines.push(
        `- Notable signals: ${report.decisionLogSummary.notableSignals
          .map((s) => `\`${s}\``)
          .join(", ")}`,
      );
    }
    lines.push("");
  }

  // ── Hints
  if (
    report.hints.hasScreenshots ||
    report.hints.benchmarkReportFile ||
    report.hints.taskPagePath
  ) {
    lines.push("### Cross-references");
    lines.push("");
    if (report.hints.taskPagePath) {
      lines.push(`- Task page: \`${report.hints.taskPagePath}\``);
    }
    if (report.hints.benchmarkReportFile) {
      lines.push(
        `- Benchmark report: \`benchmark/runs/${report.hints.benchmarkReportFile}\``,
      );
    }
    if (report.hints.hasScreenshots) {
      const dir =
        report.hints.screenshotsRel ?? `worker/.debug-screenshots/${report.provider}/`;
      lines.push(`- Debug screenshots: \`${dir}\``);
    }
    lines.push("");
  }

  // ── Recommended next evidence
  lines.push("### Recommended next evidence");
  lines.push("");
  lines.push("Checklist (work top to bottom):");
  lines.push("");
  recommendation.baseChecklist.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  if (recommendation.pointers.length > 0) {
    lines.push("");
    lines.push("Pointers:");
    lines.push("");
    for (const p of recommendation.pointers) {
      lines.push(`- **${p.label}** (\`${p.kind}\`) — \`${p.ref}\``);
    }
  }
  if (recommendation.searchCommands.length > 0) {
    lines.push("");
    lines.push("Suggested worker-log searches (PowerShell):");
    lines.push("");
    for (const sc of recommendation.searchCommands) {
      lines.push(`- ${sc.description}`);
      lines.push("  ```powershell");
      lines.push(`  ${sc.command}`);
      lines.push("  ```");
    }
  }
  lines.push("");

  // ── Notes (V1 caveat)
  lines.push("---");
  lines.push("");
  lines.push(`_${recommendation.caveat}_`);
  if (report.notes.length > 0) {
    lines.push("");
    lines.push("Loader notes:");
    for (const n of report.notes.slice(0, 10)) {
      lines.push(`- ${n}`);
    }
  }

  return lines.join("\n");
}

function formatSignalLine(s: ClassifierSignal): string {
  const excerpt = s.excerpt ? ` — _${escapeQuote(s.excerpt)}_` : "";
  return `- **[${s.weight.toFixed(2)}] [${s.source}] [${s.supportsClass}]** ${s.label}${excerpt}`;
}

function formatLevelMap(byLevel: Partial<Record<string, number>>): string {
  const entries = Object.entries(byLevel)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (entries.length === 0) return "(none)";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function escapeQuote(s: string): string {
  return s.replace(/\n+/g, " ").replace(/`/g, "\\`");
}

function truncateBlock(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}
