import {
  providerClosureKindToCliKind,
  type ProviderClosureKind,
} from "./schema";

export function formatProviderClosurePreflightMarkdown(
  kind: ProviderClosureKind,
): string {
  const cliKind = providerClosureKindToCliKind(kind);
  const label = kind === "expedia-flight" ? "Expedia flight" : kind;
  const runbook = runbookForKind(kind);
  const artifactName =
    kind === "expedia-flight"
      ? "expedia-retry-artifact-bundle.json"
      : `${cliKind}-artifact-bundle.json`;

  return [
    `# Provider Closure Preflight - ${label}`,
    "",
    "This is a no-live evidence harness. It does not approve or start a provider run.",
    "",
    "## Required Evidence",
    "",
    "- DB row JSON from `booking_jobs`.",
    "- Bounded worker log excerpt.",
    "- Worker log path.",
    "- Provider screenshot paths.",
    "- Live snapshot JSON paths.",
    "- Operator notes describing visible hard stops.",
    "",
    "## Hard Stops",
    "",
    "- No live provider run.",
    "- No live OpenAI call.",
    "- No payment, CVV/CVC/security-code, OTP/CAPTCHA/login bypass, or final confirmation.",
    "- Do not add run/retry/live buttons, retry loops, cron jobs, or one-click live controls.",
    "",
    "## Build The Bundle",
    "",
    "```powershell",
    `npx tsx scripts/create-artifact-bundle-template.ts --kind ${templateKindForKind(kind)} > .tmp\\${artifactName}`,
    "```",
    "",
    "Replace placeholders only with already-collected evidence, then run:",
    "",
    "```powershell",
    `npx tsx scripts/provider-closure.ts analyze --kind ${cliKind} --artifact .tmp\\${artifactName}`,
    `npx tsx scripts/provider-closure.ts report --kind ${cliKind} --artifact .tmp\\${artifactName} --markdown`,
    "```",
    "",
    "## Read First",
    "",
    `- ${runbook}`,
    "- `docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md`",
  ].join("\n");
}

function templateKindForKind(kind: ProviderClosureKind): string {
  return kind === "expedia-flight" ? "expedia" : kind;
}

function runbookForKind(kind: ProviderClosureKind): string {
  switch (kind) {
    case "restaurant":
      return "`docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md`";
    case "expedia-flight":
      return "`docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`";
    case "hotel":
      return "`docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`";
  }
}
