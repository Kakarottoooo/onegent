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

export type Stage0PerformanceProbe = Stage0PerformanceEndpointSpec & {
  routeSourceBytes: number;
  heavyFieldsDetected: string[];
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

const HEAVY_FIELD_PATTERNS: Array<{ field: string; pattern: RegExp }> = [
  { field: "steps", pattern: /\bsteps\b/i },
  { field: "decisionLog", pattern: /\bdecisionLog\b/i },
  { field: "screenshots", pattern: /\b(screenshots|snapshot|snapshots)\b/i },
  { field: "logs", pattern: /\b(logs?|workerLog|logExcerpt)\b/i },
  { field: "profile blobs", pattern: /\b(profile|bookingProfile|preferences)\b/i },
  { field: "room full messages", pattern: /\b(messages|messageHistory|transcript)\b/i },
  { field: "calendar full event payloads", pattern: /\b(events|attendees|calendarEvents)\b/i },
  { field: "provider runtime artifacts", pattern: /\b(provider|runtime|artifact|decision_log)\b/i },
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
    label: "memory summary",
    endpoint: "/api/memory",
    sourcePaths: ["app/api/memory/route.ts"],
    owner: "memory",
    suggestedNextPatch: "Add a compact memory summary endpoint before loading large preference/profile bodies.",
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
  const combinedSource = sources.map((source) => source.text).join("\n");
  const routeSourceBytes = sources.reduce((sum, source) => sum + source.bytes, 0);
  const heavyFieldsDetected = detectHeavyFields(combinedSource);
  const riskLevel = riskFor(heavyFieldsDetected, spec.endpoint);
  return {
    ...spec,
    routeSourceBytes,
    heavyFieldsDetected,
    riskLevel,
    durationEstimateMs: null,
    recommendedCompactEndpoint: compactRecommendationFor(spec),
  };
}

export function detectHeavyFields(source: string): string[] {
  return HEAVY_FIELD_PATTERNS
    .filter((entry) => entry.pattern.test(source))
    .map((entry) => entry.field);
}

function readSource(
  rootDir: string,
  sourcePath: string,
  sourceOverrides: Record<string, string>,
): { text: string; bytes: number } {
  if (Object.prototype.hasOwnProperty.call(sourceOverrides, sourcePath)) {
    const text = sourceOverrides[sourcePath] ?? "";
    return { text, bytes: Buffer.byteLength(text) };
  }
  const absolute = path.join(rootDir, sourcePath);
  if (!existsSync(absolute)) return { text: "", bytes: 0 };
  const text = readFileSync(absolute, "utf8");
  return { text, bytes: Buffer.byteLength(text) };
}

function riskFor(heavyFields: string[], endpoint: string): Stage0PerformanceRisk {
  if (heavyFields.some((field) => field === "steps" || field === "decisionLog" || field === "screenshots" || field === "logs")) {
    return endpoint.includes("compact") || endpoint.includes("bootstrap") || endpoint.includes("summary") ? "high" : "medium";
  }
  if (heavyFields.length >= 2) return "medium";
  return "low";
}

function compactRecommendationFor(spec: Stage0PerformanceEndpointSpec): string {
  if (spec.endpoint.includes("compact") || spec.endpoint.includes("bootstrap") || spec.endpoint.includes("summary")) {
    return "Keep compact contract and add tests if heavy fields appear.";
  }
  return `Consider a compact shell endpoint before loading ${spec.endpoint} detail.`;
}
