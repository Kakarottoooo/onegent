import {
  providerClosureKindToCliKind,
  type ProviderClosureAnalysis,
} from "./schema";

export function formatProviderClosureReportMarkdown(
  analysis: ProviderClosureAnalysis,
): string {
  const lines: string[] = [];
  lines.push("# Provider Closure Report");
  lines.push("");
  lines.push(`- **Kind**: \`${analysis.kind}\``);
  lines.push(`- **Outcome**: \`${analysis.terminalOutcome}\` (${analysis.outcomeLabel})`);
  lines.push(`- **Confidence**: \`${analysis.confidence}\``);
  lines.push(`- **Provider state**: \`${analysis.providerAnalysis.state}\` (${analysis.providerAnalysis.label})`);
  lines.push(`- **Runtime class**: \`${analysis.runtimeClass}\` (${analysis.runtimeSeverity})`);
  lines.push(`- **Job id**: \`${analysis.jobId ?? "(unknown)"}\``);
  if (analysis.taskId) lines.push(`- **Task id**: \`${analysis.taskId}\``);
  lines.push(`- **Provider**: \`${analysis.provider}\``);
  lines.push(`- **Scenario**: \`${analysis.scenario}\``);
  lines.push(`- **Status**: \`${analysis.status}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(analysis.summary);
  lines.push("");
  lines.push("## Exact Next Step");
  lines.push("");
  lines.push(analysis.exactNextStep);
  lines.push("");
  lines.push("## Recommended Controlled Run");
  lines.push("");
  lines.push(analysis.recommendedControlledRun);
  lines.push("");
  lines.push("## Evidence Sources");
  lines.push("");
  for (const source of analysis.sources) {
    const status = source.present ? "present" : "missing";
    const detail = source.detail ? ` - ${source.detail}` : "";
    lines.push(`- \`${source.kind}\`: ${status}${detail}`);
  }
  lines.push("");
  lines.push("## Provider Signals");
  lines.push("");
  if (analysis.providerAnalysis.signals.length === 0) {
    lines.push("_No provider-specific analyzer signals were found._");
  } else {
    for (const signal of analysis.providerAnalysis.signals.slice(0, 12)) {
      lines.push(
        `- **${signal.label}** from \`${signal.source}\`: ${escapeMarkdownLine(signal.excerpt)}`,
      );
    }
  }
  lines.push("");
  lines.push("## Runtime Signals");
  lines.push("");
  if (analysis.runtimeClassification.signals.length === 0) {
    lines.push("_No runtime-forensics classifier signals were found._");
  } else {
    for (const signal of analysis.runtimeClassification.signals.slice(0, 12)) {
      lines.push(
        `- **${signal.label}** from \`${signal.source}\`: ${escapeMarkdownLine(signal.excerpt ?? "")}`,
      );
    }
  }
  lines.push("");
  lines.push("## Artifact Paths");
  lines.push("");
  if (analysis.artifactPaths.workerLogPath) {
    lines.push(`- Worker log: \`${analysis.artifactPaths.workerLogPath}\``);
  }
  if (analysis.artifactPaths.benchmarkReportPath) {
    lines.push(`- Benchmark report: \`${analysis.artifactPaths.benchmarkReportPath}\``);
  }
  if (analysis.artifactPaths.analyzerFixturePath) {
    lines.push(`- Analyzer fixture: \`${analysis.artifactPaths.analyzerFixturePath}\``);
  }
  for (const screenshot of analysis.artifactPaths.screenshots) {
    lines.push(`- Screenshot: \`${screenshot}\``);
  }
  for (const snapshot of analysis.artifactPaths.liveSnapshots) {
    lines.push(`- Live snapshot: \`${snapshot}\``);
  }
  if (
    !analysis.artifactPaths.workerLogPath &&
    !analysis.artifactPaths.benchmarkReportPath &&
    !analysis.artifactPaths.analyzerFixturePath &&
    analysis.artifactPaths.screenshots.length === 0 &&
    analysis.artifactPaths.liveSnapshots.length === 0
  ) {
    lines.push("_No artifact paths were included._");
  }
  lines.push("");
  lines.push("## Hard Stops");
  lines.push("");
  for (const hardStop of analysis.hardStops) {
    lines.push(`- ${hardStop}`);
  }
  lines.push("");
  lines.push("## Re-run This Report");
  lines.push("");
  lines.push("```powershell");
  lines.push(
    `npx tsx scripts/provider-closure.ts report --kind ${providerClosureKindToCliKind(analysis.kind)} --artifact <bundle.json> --markdown`,
  );
  lines.push("```");

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownLine(text: string): string {
  return text.replace(/`/g, "\\`").replace(/\s+/g, " ").trim();
}
