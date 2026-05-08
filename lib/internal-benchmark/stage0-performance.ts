import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Stage0PerformanceOwner =
  | "app-shell"
  | "task-workspace"
  | "calendar"
  | "rooms"
  | "contacts"
  | "memory"
  | "codex";

export type Stage0PerformanceRisk = "low" | "medium" | "high";

export type Stage0PerformanceEndpointSpec = {
  label: string;
  endpoint: string;
  sourcePaths: string[];
  owner: Stage0PerformanceOwner;
  suggestedNextPatch: string;
};

export type Stage0PerformanceFinding = {
  field: string;
  severity: Stage0PerformanceRisk;
  reason: string;
  sourcePath: string;
  line: number;
  suggestedCompactAlternative: string;
  owner: Stage0PerformanceOwner;
};

export type Stage0PerformanceProbe = Stage0PerformanceEndpointSpec & {
  routeSourceBytes: number;
  heavyFieldsDetected: string[];
  findings: Stage0PerformanceFinding[];
  riskLevel: Stage0PerformanceRisk;
  durationEstimateMs: number | null;
  recommendedCompactEndpoint: string;
};

export type Stage0PerformanceReport = {
  generatedAt: string;
  mode: "stage0-static";
  totalEndpoints: number;
  highRiskEndpoints: number;
  mediumRiskEndpoints: number;
  probes: Stage0PerformanceProbe[];
  notes: string[];
};

export type Stage0PerformanceOptions = {
  rootDir?: string;
  specs?: Stage0PerformanceEndpointSpec[];
  sourceOverrides?: Record<string, string>;
};

const GENERATED_AT = "2026-05-07T12:00:00.000Z";

const HEAVY_FIELD_PATTERNS: Array<{
  field: string;
  matches: (line: string, spec: Pick<Stage0PerformanceEndpointSpec, "endpoint" | "owner">) => boolean;
  suggestedCompactAlternative: string;
}> = [
  { field: "steps", matches: (line) => /\bsteps\b/i.test(line), suggestedCompactAlternative: "Return step counts/status labels only; load full steps from task detail." },
  { field: "decisionLog", matches: (line) => /\bdecisionLog\b/i.test(line), suggestedCompactAlternative: "Return a decision-log presence flag or latest label; load full decisionLog lazily." },
  { field: "screenshots", matches: (line) => /\b(screenshots|snapshot|snapshots|imageBase64)\b/i.test(line), suggestedCompactAlternative: "Return screenshot counts/last timestamp only; load images from the evidence view." },
  { field: "logs", matches: (line) => /\b(logs?|workerLog|logExcerpt)\b/i.test(line), suggestedCompactAlternative: "Return log counts/status only; load log excerpts from task detail." },
  { field: "profile blobs", matches: matchesProfileBlob, suggestedCompactAlternative: "Return compact preference labels; load full profile detail after the user opens memory." },
  { field: "room full messages", matches: (line) => /\b(messages|messageHistory|transcript)\b/i.test(line), suggestedCompactAlternative: "Return room summary counts; lazy-load messages after room open." },
  { field: "calendar full event payloads", matches: matchesCalendarPayload, suggestedCompactAlternative: "Return calendar counts/status; load full calendar events from calendar detail." },
  { field: "provider runtime artifacts", matches: matchesProviderRuntimeArtifact, suggestedCompactAlternative: "Return artifact counts or refs; load provider artifacts from evidence/debug surfaces." },
];

export const STAGE0_PERFORMANCE_ENDPOINTS: Stage0PerformanceEndpointSpec[] = [
  {
    label: "app bootstrap",
    endpoint: "/api/app/bootstrap",
    sourcePaths: ["app/api/app/bootstrap/route.ts"],
    owner: "app-shell",
    suggestedNextPatch: "Keep bootstrap to compact sidebar/session rows and move task/history detail behind lazy endpoints.",
  },
  {
    label: "chat sessions",
    endpoint: "/api/chat/sessions",
    sourcePaths: ["app/api/chat/sessions/route.ts"],
    owner: "app-shell",
    suggestedNextPatch: "Return compact session rows by default; fetch message history only for the selected session.",
  },
  {
    label: "rooms compact list",
    endpoint: "/api/rooms/compact-list",
    sourcePaths: ["app/api/rooms/compact-list/route.ts"],
    owner: "rooms",
    suggestedNextPatch: "Keep room cards compact and lazy-load member/message/proposal detail after room open.",
  },
  {
    label: "calendar jobs",
    endpoint: "/api/calendar/jobs",
    sourcePaths: ["app/api/calendar/jobs/route.ts"],
    owner: "calendar",
    suggestedNextPatch: "Keep calendar jobs as shell metadata and load Google month/status independently.",
  },
  {
    label: "contacts bootstrap",
    endpoint: "/api/contacts/bootstrap",
    sourcePaths: ["app/api/contacts/bootstrap/route.ts"],
    owner: "contacts",
    suggestedNextPatch: "Keep contacts bootstrap to compact cards; lazy-load suggestions, blocks, and relationship detail.",
  },
  {
    label: "memory compact summary",
    endpoint: "/api/memory/compact",
    sourcePaths: ["app/api/memory/compact/route.ts", "lib/memory-endpoint.ts", "lib/memory-read-model.ts"],
    owner: "memory",
    suggestedNextPatch: "Keep memory compact summary bounded; load full memory detail only after the user opens insights.",
  },
  {
    label: "tasks compact list",
    endpoint: "/api/booking-jobs/compact-list",
    sourcePaths: ["app/api/booking-jobs/compact-list/route.ts", "lib/booking-jobs/read-model.ts"],
    owner: "task-workspace",
    suggestedNextPatch: "Keep task list free of steps, logs, screenshots, and decision logs; detail remains per selected task.",
  },
  {
    label: "tasks summary",
    endpoint: "/api/booking-jobs/summary",
    sourcePaths: ["app/api/booking-jobs/summary/route.ts"],
    owner: "task-workspace",
    suggestedNextPatch: "Keep counters cheap and avoid loading job detail or evidence for collapsed tasks.",
  },
];

export function buildStage0PerformanceReport(
  options: Stage0PerformanceOptions = {},
): Stage0PerformanceReport {
  const rootDir = options.rootDir ?? process.cwd();
  const specs = options.specs ?? STAGE0_PERFORMANCE_ENDPOINTS;
  const probes = specs.map((spec) => analyzeEndpointSpec(spec, rootDir, options.sourceOverrides ?? {}));
  return {
    generatedAt: GENERATED_AT,
    mode: "stage0-static",
    totalEndpoints: probes.length,
    highRiskEndpoints: probes.filter((probe) => probe.riskLevel === "high").length,
    mediumRiskEndpoints: probes.filter((probe) => probe.riskLevel === "medium").length,
    probes,
    notes: [
      "Stage 0 performance mode is static/no-live; it does not require a dev server or call app endpoints.",
      "Byte size is route/helper source bytes, not network payload bytes. Use normal probe mode with a dev server for latency.",
      "Heavy-field findings are contract risk hints for compact read-model review, not proof of runtime payload size.",
      "Full detail endpoints may remain lazy surfaces; Stage 0 guards the compact/bootstrap paths that can affect app-shell navigation.",
    ],
  };
}

export function renderStage0PerformanceMarkdown(report: Stage0PerformanceReport): string {
  const lines = [
    "# Stage 0 Performance Measurement",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Endpoints: ${report.totalEndpoints}`,
    `High risk: ${report.highRiskEndpoints}`,
    `Medium risk: ${report.mediumRiskEndpoints}`,
    "",
    "| Endpoint | Owner | Source bytes | Risk | Heavy fields | Suggested next patch |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const probe of report.probes) {
    lines.push(
      `| \`${probe.endpoint}\` | \`${probe.owner}\` | ${probe.routeSourceBytes} | \`${probe.riskLevel}\` | ${probe.heavyFieldsDetected.join(", ") || "-"} | ${probe.suggestedNextPatch} |`,
    );
  }
  lines.push("", "## Findings", "", "| Endpoint | Severity | Field | Owner | File | Line | Reason | Compact alternative |", "| --- | --- | --- | --- | --- | ---: | --- | --- |");
  const findings = report.probes.flatMap((probe) => probe.findings.map((finding) => ({ probe, finding })));
  if (findings.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - |");
  } else {
    for (const { probe, finding } of findings) {
      lines.push(
        `| \`${probe.endpoint}\` | \`${finding.severity}\` | \`${finding.field}\` | \`${finding.owner}\` | \`${finding.sourcePath}\` | ${finding.line} | ${finding.reason} | ${finding.suggestedCompactAlternative} |`,
      );
    }
  }
  lines.push("", "## Notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}

export function analyzeEndpointSpec(
  spec: Stage0PerformanceEndpointSpec,
  rootDir: string,
  sourceOverrides: Record<string, string> = {},
): Stage0PerformanceProbe {
  const sources = spec.sourcePaths.map((sourcePath) => readSource(rootDir, sourcePath, sourceOverrides));
  const routeSourceBytes = sources.reduce((sum, source) => sum + source.bytes, 0);
  const findings = sources.flatMap((source) => detectHeavyFieldFindings(source.text, source.path, spec));
  const heavyFieldsDetected = Array.from(new Set(findings.map((finding) => finding.field)));
  const riskLevel = riskForFindings(findings);
  return {
    ...spec,
    routeSourceBytes,
    heavyFieldsDetected,
    findings,
    riskLevel,
    durationEstimateMs: null,
    recommendedCompactEndpoint: compactRecommendationFor(spec),
  };
}

export function detectHeavyFields(source: string): string[] {
  return Array.from(new Set(detectHeavyFieldFindings(source, "inline.ts", {
    endpoint: "/inline",
    owner: "codex",
  }).map((finding) => finding.field)));
}

export function detectHeavyFieldFindings(
  source: string,
  sourcePath: string,
  spec: Pick<Stage0PerformanceEndpointSpec, "endpoint" | "owner">,
): Stage0PerformanceFinding[] {
  const findings: Stage0PerformanceFinding[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (shouldIgnorePerformanceLine(line)) return;
    for (const entry of HEAVY_FIELD_PATTERNS) {
      if (!entry.matches(line, spec)) continue;
      findings.push({
        field: entry.field,
        severity: severityFor(entry.field, spec.endpoint),
        reason: `${entry.field} appears in ${spec.endpoint} source outside comments, imports, type-only declarations, or explicit exclusion metadata.`,
        sourcePath,
        line: index + 1,
        suggestedCompactAlternative: entry.suggestedCompactAlternative,
        owner: spec.owner,
      });
    }
  });
  return dedupeFindings(findings);
}

function readSource(
  rootDir: string,
  sourcePath: string,
  sourceOverrides: Record<string, string>,
): { path: string; text: string; bytes: number } {
  if (Object.prototype.hasOwnProperty.call(sourceOverrides, sourcePath)) {
    const text = sourceOverrides[sourcePath] ?? "";
    return { path: sourcePath, text, bytes: Buffer.byteLength(text) };
  }
  const absolute = path.join(rootDir, sourcePath);
  if (!existsSync(absolute)) return { path: sourcePath, text: "", bytes: 0 };
  const text = readFileSync(absolute, "utf8");
  return { path: sourcePath, text, bytes: Buffer.byteLength(text) };
}

function riskForFindings(findings: Stage0PerformanceFinding[]): Stage0PerformanceRisk {
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  return "low";
}

function compactRecommendationFor(spec: Stage0PerformanceEndpointSpec): string {
  if (spec.endpoint.includes("compact") || spec.endpoint.includes("bootstrap") || spec.endpoint.includes("summary")) {
    return "Keep compact contract and add tests if heavy fields appear.";
  }
  return `Consider a compact shell endpoint before loading ${spec.endpoint} detail.`;
}

function shouldIgnorePerformanceLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  if (/^import\s/i.test(trimmed)) return true;
  if (/^(export\s+)?type\s/i.test(trimmed) || /^(export\s+)?interface\s/i.test(trimmed)) return true;
  if (/heavy_fields_excluded/i.test(trimmed)) return true;
  if (/^\s*["'](steps|decisionLog|screenshots|logs|profile|autonomy_settings|messages|private_messages|proposals|votes|context_json|synthesis_json|constraints)["']\s*,?\s*$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function matchesProfileBlob(
  line: string,
  spec: Pick<Stage0PerformanceEndpointSpec, "endpoint" | "owner">,
): boolean {
  if (/\b(bookingProfile|fullProfile|profileBlob|profileJson|profile_json|preferences)\b/i.test(line)) {
    return true;
  }
  if (spec.owner === "memory" && /\b(buildPreferenceProfile|UserPreferenceProfile)\b/i.test(line)) {
    return true;
  }
  return false;
}

function matchesCalendarPayload(
  line: string,
  spec: Pick<Stage0PerformanceEndpointSpec, "endpoint" | "owner">,
): boolean {
  if (/\b(calendarEvents|googleEvents|attendees|eventPayload|event_payload|eventsJson|events_json)\b/i.test(line)) {
    return true;
  }
  if (spec.owner === "calendar" && /\bevents\b/i.test(line) && !/\b(eventCount|count|summary|status)\b/i.test(line)) {
    return true;
  }
  return false;
}

function matchesProviderRuntimeArtifact(line: string): boolean {
  return /\b(provider\s+artifact|providerRuntime|runtimeArtifact|artifactPayload|artifact_payload|decision_log|artifacts?)\b/i.test(line);
}

function severityFor(field: string, endpoint: string): Stage0PerformanceRisk {
  const compactCritical = isCompactCriticalEndpoint(endpoint);
  if (field === "steps" || field === "decisionLog" || field === "screenshots" || field === "logs") {
    return compactCritical ? "high" : "medium";
  }
  if (
    compactCritical &&
    (field === "profile blobs" ||
      field === "room full messages" ||
      field === "calendar full event payloads" ||
      field === "provider runtime artifacts")
  ) {
    return "medium";
  }
  return "low";
}

function isCompactCriticalEndpoint(endpoint: string): boolean {
  return (
    endpoint.includes("compact") ||
    endpoint.includes("bootstrap") ||
    endpoint.includes("summary") ||
    endpoint === "/api/calendar/jobs"
  );
}

function dedupeFindings(findings: Stage0PerformanceFinding[]): Stage0PerformanceFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.field}:${finding.sourcePath}:${finding.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
