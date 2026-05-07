export type AgentIntakeDecision = "ready_to_merge" | "needs_followup" | "reject";

export type AgentIntakeIssueCode =
  | "wrong_base"
  | "forbidden_artifact"
  | "missing_validation"
  | "runtime_mirror_without_drift_check"
  | "docs_only_runtime_closure_claim";

export type AgentIntakeIssueSeverity = "followup" | "reject";

export type AgentReturnValidationStatus = "pass" | "fail" | "missing" | "skipped";

export type AgentReturnValidation = {
  name: string;
  status: AgentReturnValidationStatus;
  command?: string;
  notes?: string;
};

export type AgentReturnBase = {
  branch: string;
  commit?: string;
  containsRequiredCommit?: boolean;
};

export type AgentReturnClaims = {
  runtimeClosure?: boolean;
  liveVerified?: boolean;
  docsOnly?: boolean;
};

export type AgentReturnReport = {
  id?: string;
  agent?: string;
  branch: string;
  commit: string;
  base: AgentReturnBase;
  summary?: string;
  changedFiles: string[];
  artifacts?: string[];
  validations: AgentReturnValidation[];
  claims?: AgentReturnClaims;
  docsOnly?: boolean;
  notes?: string[];
};

export type AgentIntakeIssue = {
  code: AgentIntakeIssueCode;
  severity: AgentIntakeIssueSeverity;
  message: string;
  evidence: string[];
};

export type AgentIntakeResult = {
  report: AgentReturnReport;
  decision: AgentIntakeDecision;
  issues: AgentIntakeIssue[];
};

export type AgentIntakeSummary = {
  total: number;
  readyToMerge: number;
  needsFollowup: number;
  reject: number;
  byIssue: Record<AgentIntakeIssueCode, number>;
};

export type AgentIntakeQueueReport = {
  summary: AgentIntakeSummary;
  results: AgentIntakeResult[];
  notes: string[];
};

export type AgentIntakeOptions = {
  requiredBaseBranch?: string;
  requiredBaseCommit?: string;
  requiredValidations?: string[];
};

const DEFAULT_REQUIRED_BASE_BRANCH = "origin/codex/goal-core-reliability-long-run";
const DEFAULT_REQUIRED_VALIDATIONS = [
  "targeted_vitest",
  "tsc",
  "check_drift",
  "gate_phase1",
  "git_diff_check",
] as const;

const ZERO_ISSUES: Record<AgentIntakeIssueCode, number> = {
  wrong_base: 0,
  forbidden_artifact: 0,
  missing_validation: 0,
  runtime_mirror_without_drift_check: 0,
  docs_only_runtime_closure_claim: 0,
};

const FORBIDDEN_ARTIFACT_PATTERNS: RegExp[] = [
  /(^|[/\\])\.env($|[.\-/\\])/i,
  /(^|[/\\])\.tmp($|[/\\])/i,
  /(^|[/\\])(logs?|screenshots?|debug-artifacts)($|[/\\])/i,
  /(^|[/\\])benchmark[/\\]runs($|[/\\])/i,
  /\.(log|png|jpe?g|webp|zip|trace)$/i,
  /(^|[/\\])(cookies|storage-state|secrets?)($|[.\-/\\])/i,
];

const RUNTIME_MIRROR_PATTERNS: RegExp[] = [
  /^lib[/\\]booking-autopilot[/\\]/i,
  /^worker[/\\]src[/\\]booking-autopilot[/\\]/i,
];

export function classifyAgentReturnReport(
  report: AgentReturnReport,
  options: AgentIntakeOptions = {},
): AgentIntakeResult {
  const requiredBaseBranch = options.requiredBaseBranch ?? DEFAULT_REQUIRED_BASE_BRANCH;
  const requiredValidations = options.requiredValidations ?? [...DEFAULT_REQUIRED_VALIDATIONS];
  const issues: AgentIntakeIssue[] = [];

  const baseIssue = baseMismatch(report, requiredBaseBranch, options.requiredBaseCommit);
  if (baseIssue) issues.push(baseIssue);

  const forbiddenPaths = [...report.changedFiles, ...(report.artifacts ?? [])].filter(isForbiddenArtifactPath);
  if (forbiddenPaths.length > 0) {
    issues.push({
      code: "forbidden_artifact",
      severity: "reject",
      message: "Branch metadata includes local artifacts or secret-bearing paths that should not be merged.",
      evidence: forbiddenPaths,
    });
  }

  const missingValidation = requiredValidations.filter(
    (validationName) => !hasPassingValidation(report, validationName),
  );
  if (missingValidation.length > 0) {
    issues.push({
      code: "missing_validation",
      severity: "followup",
      message: "Required validation is missing or not reported as passing.",
      evidence: missingValidation,
    });
  }

  const runtimeMirrorPaths = report.changedFiles.filter(isRuntimeMirrorPath);
  if (runtimeMirrorPaths.length > 0 && !hasPassingValidation(report, "check_drift")) {
    issues.push({
      code: "runtime_mirror_without_drift_check",
      severity: "followup",
      message: "Runtime mirror paths changed without a passing drift check.",
      evidence: runtimeMirrorPaths,
    });
  }

  if (isDocsOnlyReport(report) && claimsRuntimeClosure(report)) {
    issues.push({
      code: "docs_only_runtime_closure_claim",
      severity: "reject",
      message: "Docs-only branch claims runtime/provider closure without runtime evidence.",
      evidence: [report.summary ?? "runtime closure claim"],
    });
  }

  return {
    report,
    issues,
    decision: decideIntakeStatus(issues),
  };
}

export function classifyAgentIntakeQueue(
  reports: AgentReturnReport[],
  options: AgentIntakeOptions = {},
): AgentIntakeQueueReport {
  const results = reports.map((report) => classifyAgentReturnReport(report, options));
  const byIssue = { ...ZERO_ISSUES };
  for (const result of results) {
    for (const issue of result.issues) {
      byIssue[issue.code] += 1;
    }
  }

  return {
    summary: {
      total: results.length,
      readyToMerge: results.filter((result) => result.decision === "ready_to_merge").length,
      needsFollowup: results.filter((result) => result.decision === "needs_followup").length,
      reject: results.filter((result) => result.decision === "reject").length,
      byIssue,
    },
    results,
    notes: [
      "Intake uses returned branch metadata only; it does not merge, fetch branch diffs, or run providers.",
      "ready_to_merge means metadata is clean enough for Codex to start normal merge validation.",
      "needs_followup means the returning agent should add evidence or validation before merge review.",
      "reject means the branch violates base/artifact/claim rules and should not enter the merge train.",
    ],
  };
}

export function parseAgentIntakeJson(input: string): AgentReturnReport[] {
  const parsed = JSON.parse(input) as unknown;
  if (Array.isArray(parsed)) return parsed.map(normalizeReport);
  if (isRecord(parsed) && Array.isArray(parsed.reports)) {
    return parsed.reports.map(normalizeReport);
  }
  throw new Error("Expected a JSON array of agent return reports or an object with reports[].");
}

export function parseAgentIntakeMarkdown(input: string): AgentReturnReport[] {
  const sections = input.split(/^##\s+/m).map((section) => section.trim()).filter(Boolean);
  const reports: AgentReturnReport[] = [];
  for (const [index, section] of sections.entries()) {
    const lines = section.split(/\r?\n/);
    const heading = lines.shift()?.trim() || `report-${index + 1}`;
    const fields = new Map<string, string>();
    for (const line of lines) {
      const match = line.match(/^\s*[-*]\s*([^:]+):\s*(.*?)\s*$/);
      if (!match) continue;
      fields.set(normalizeKey(match[1]), match[2]);
    }
    if (fields.size === 0) continue;

    const branch = fields.get("branch") ?? heading;
    reports.push(normalizeReport({
      id: fields.get("id") || heading,
      agent: fields.get("agent"),
      branch,
      commit: fields.get("commit") ?? "unknown",
      base: {
        branch: fields.get("basebranch") ?? fields.get("base") ?? "",
        commit: fields.get("basecommit"),
        containsRequiredCommit: parseBoolean(fields.get("basecontainsrequiredcommit")),
      },
      summary: fields.get("summary"),
      changedFiles: parseList(fields.get("changedfiles") ?? fields.get("changedpaths")),
      artifacts: parseList(fields.get("artifacts")),
      validations: parseValidationList(fields.get("validations")),
      docsOnly: parseBoolean(fields.get("docsonly")),
      claims: {
        runtimeClosure: parseBoolean(fields.get("runtimeclosure")),
        liveVerified: parseBoolean(fields.get("liveverified")),
        docsOnly: parseBoolean(fields.get("docsonly")),
      },
      notes: parseList(fields.get("notes")),
    }));
  }
  return reports;
}

export function parseAgentIntakeInput(input: string, filename = ""): AgentReturnReport[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (filename.endsWith(".md") || filename.endsWith(".markdown")) {
    return parseAgentIntakeMarkdown(trimmed);
  }
  if (trimmed.startsWith("#")) {
    return parseAgentIntakeMarkdown(trimmed);
  }
  return parseAgentIntakeJson(trimmed);
}

export function renderAgentIntakeMarkdown(report: AgentIntakeQueueReport): string {
  const lines = [
    "# Agent Intake Queue",
    "",
    ...report.notes,
    "",
    `Total: ${report.summary.total}`,
    `Ready to merge: ${report.summary.readyToMerge}`,
    `Needs follow-up: ${report.summary.needsFollowup}`,
    `Reject: ${report.summary.reject}`,
    "",
    "## Queue",
    "",
    "| Branch | Decision | Commit | Issues |",
    "| --- | --- | --- | --- |",
  ];

  for (const result of report.results) {
    const issues = result.issues.length === 0
      ? "-"
      : result.issues.map((issue) => `\`${issue.code}\``).join(", ");
    lines.push(
      `| \`${result.report.branch}\` | \`${result.decision}\` | \`${result.report.commit}\` | ${issues} |`,
    );
  }

  lines.push("", "## Issue Counts", "", "| Issue | Count |", "| --- | ---: |");
  for (const [issue, count] of Object.entries(report.summary.byIssue)) {
    if (count > 0) lines.push(`| \`${issue}\` | ${count} |`);
  }

  lines.push("", "## Follow-Up Detail");
  for (const result of report.results.filter((item) => item.issues.length > 0)) {
    lines.push("", `### ${result.report.branch}`, "", `Decision: \`${result.decision}\``);
    for (const issue of result.issues) {
      lines.push(`- \`${issue.code}\`: ${issue.message} Evidence: ${issue.evidence.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function baseMismatch(
  report: AgentReturnReport,
  requiredBaseBranch: string,
  requiredBaseCommit?: string,
): AgentIntakeIssue | null {
  const evidence: string[] = [];
  if (report.base.branch !== requiredBaseBranch) {
    evidence.push(`base.branch=${report.base.branch || "missing"}`);
  }
  if (requiredBaseCommit) {
    const commitMatches = report.base.commit?.startsWith(requiredBaseCommit) ?? false;
    const containsCommit = report.base.containsRequiredCommit === true;
    if (!commitMatches && !containsCommit) {
      evidence.push(`base.commit=${report.base.commit || "missing"}`);
    }
  }
  if (evidence.length === 0) return null;
  return {
    code: "wrong_base",
    severity: "reject",
    message: `Branch was not reported from required base ${requiredBaseBranch}.`,
    evidence,
  };
}

function hasPassingValidation(report: AgentReturnReport, expectedName: string): boolean {
  const expected = normalizeValidationName(expectedName);
  return report.validations.some((validation) => {
    const normalizedName = normalizeValidationName(validation.name);
    const normalizedCommand = validation.command ? normalizeValidationName(validation.command) : "";
    return validation.status === "pass" && (normalizedName === expected || normalizedCommand.includes(expected));
  });
}

function isForbiddenArtifactPath(pathname: string): boolean {
  return FORBIDDEN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isRuntimeMirrorPath(pathname: string): boolean {
  return RUNTIME_MIRROR_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isDocsOnlyReport(report: AgentReturnReport): boolean {
  if (typeof report.docsOnly === "boolean") return report.docsOnly;
  if (typeof report.claims?.docsOnly === "boolean") return report.claims.docsOnly;
  return report.changedFiles.length > 0 && report.changedFiles.every((file) => /^docs[/\\]/i.test(file));
}

function claimsRuntimeClosure(report: AgentReturnReport): boolean {
  if (report.claims?.runtimeClosure || report.claims?.liveVerified) return true;
  return /\b(runtime|provider|live)\s+(closure|closed|verified)\b/i.test(report.summary ?? "");
}

function decideIntakeStatus(issues: AgentIntakeIssue[]): AgentIntakeDecision {
  if (issues.some((issue) => issue.severity === "reject")) return "reject";
  if (issues.length > 0) return "needs_followup";
  return "ready_to_merge";
}

function normalizeReport(raw: unknown): AgentReturnReport {
  if (!isRecord(raw)) throw new Error("Agent return report must be an object.");
  const base = isRecord(raw.base) ? raw.base : {};
  return {
    id: stringOrUndefined(raw.id),
    agent: stringOrUndefined(raw.agent),
    branch: requiredString(raw.branch, "branch"),
    commit: requiredString(raw.commit, "commit"),
    base: {
      branch: requiredString(base.branch, "base.branch"),
      commit: stringOrUndefined(base.commit),
      containsRequiredCommit: booleanOrUndefined(base.containsRequiredCommit),
    },
    summary: stringOrUndefined(raw.summary),
    changedFiles: stringArray(raw.changedFiles),
    artifacts: stringArray(raw.artifacts),
    validations: validationArray(raw.validations),
    claims: claimsOrUndefined(raw.claims),
    docsOnly: booleanOrUndefined(raw.docsOnly),
    notes: stringArray(raw.notes),
  };
}

function claimsOrUndefined(value: unknown): AgentReturnClaims | undefined {
  if (!isRecord(value)) return undefined;
  return {
    runtimeClosure: booleanOrUndefined(value.runtimeClosure),
    liveVerified: booleanOrUndefined(value.liveVerified),
    docsOnly: booleanOrUndefined(value.docsOnly),
  };
}

function validationArray(value: unknown): AgentReturnValidation[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Validation entries must be objects.");
    return {
      name: requiredString(item.name, "validation.name"),
      status: validationStatus(item.status),
      command: stringOrUndefined(item.command),
      notes: stringOrUndefined(item.notes),
    };
  });
}

function validationStatus(value: unknown): AgentReturnValidationStatus {
  if (value === "pass" || value === "fail" || value === "missing" || value === "skipped") return value;
  return "missing";
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return parseList(value);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Missing required ${field}.`);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseList(value: string | undefined): string[] {
  if (!value || value.trim().toLowerCase() === "none") return [];
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseValidationList(value: string | undefined): AgentReturnValidation[] {
  return parseList(value).map((entry) => {
    const match = entry.match(/^(.*?)(?:=|:\s*)(pass|fail|missing|skipped)$/i);
    const rawName = match?.[1]?.trim() ?? entry.trim();
    const rawStatus = match?.[2]?.trim();
    return {
      name: rawName,
      status: validationStatus(rawStatus),
    };
  });
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeValidationName(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered.includes("check-drift") || lowered.includes("check_drift")) return "check_drift";
  if (lowered.includes("gate:phase1") || lowered.includes("gate_phase1")) return "gate_phase1";
  if (lowered.includes("git diff --check") || lowered.includes("git_diff_check")) return "git_diff_check";
  if (lowered.includes("vitest")) return "targeted_vitest";
  if (lowered.includes("tsc")) return "tsc";
  return lowered.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
