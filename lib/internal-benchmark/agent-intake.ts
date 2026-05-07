export type AgentIntakeDecision = "ready_to_merge" | "needs_followup" | "reject";

export type AgentTaskKind =
  | "runtime_fix"
  | "benchmark_fixture"
  | "read_model_perf"
  | "task_workspace_ux"
  | "docs_contract";

export type AgentDependencyEdgeType =
  | "depends_on_shared_schema"
  | "independent"
  | "supersedes"
  | "requires_rebase_before_merge";

export type AgentDependencyRequiredState = "present" | "ready_to_merge" | "merged";

export type AgentDependencyEdge = {
  type: AgentDependencyEdgeType;
  targetBranch?: string;
  requiredState?: AgentDependencyRequiredState;
  reason?: string;
};

export type AgentIntakeIssueCode =
  | "wrong_base"
  | "forbidden_artifact"
  | "missing_validation"
  | "runtime_mirror_without_drift_check"
  | "provider_runtime_without_permission"
  | "docs_only_runtime_closure_claim"
  | "unresolved_shared_schema_dependency"
  | "requires_rebase_before_merge"
  | "superseded_by_newer_branch"
  | "invalid_task_kind";

export type AgentIntakeIssueSeverity = "followup" | "reject";
export type AgentReturnValidationStatus = "pass" | "fail" | "missing" | "skipped";
export type AgentMergeState = "merged" | "unmerged" | "unknown";
export type AgentConflictRisk = "low" | "medium" | "high";

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
  taskKind?: AgentTaskKind;
  mergeState?: AgentMergeState;
  summary?: string;
  changedFiles: string[];
  artifacts?: string[];
  validations: AgentReturnValidation[];
  dependencyEdges?: AgentDependencyEdge[];
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

export type AgentNextTaskRecommendation = {
  can_start_next_task: boolean;
  reason: string;
  recommended_base: string;
  conflict_risk: AgentConflictRisk;
  blockers: string[];
};

export type AgentIntakeSummary = {
  total: number;
  readyToMerge: number;
  needsFollowup: number;
  reject: number;
  byIssue: Record<AgentIntakeIssueCode, number>;
  byTaskKind: Record<AgentTaskKind, number>;
  dependencyEdges: number;
  supersededBranches: string[];
};

export type AgentIntakeQueueReport = {
  summary: AgentIntakeSummary;
  nextTaskRecommendation: AgentNextTaskRecommendation;
  results: AgentIntakeResult[];
  notes: string[];
};

export type AgentIntakeOptions = {
  requiredBaseBranch?: string;
  requiredBaseCommit?: string;
  recommendedBase?: string;
  requiredValidations?: string[];
  mergedBranches?: string[];
  forbidProviderRuntimeChanges?: boolean;
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
  provider_runtime_without_permission: 0,
  docs_only_runtime_closure_claim: 0,
  unresolved_shared_schema_dependency: 0,
  requires_rebase_before_merge: 0,
  superseded_by_newer_branch: 0,
  invalid_task_kind: 0,
};

const ZERO_TASK_KINDS: Record<AgentTaskKind, number> = {
  runtime_fix: 0,
  benchmark_fixture: 0,
  read_model_perf: 0,
  task_workspace_ux: 0,
  docs_contract: 0,
};

const TASK_KINDS = new Set<AgentTaskKind>([
  "runtime_fix",
  "benchmark_fixture",
  "read_model_perf",
  "task_workspace_ux",
  "docs_contract",
]);

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

const PROVIDER_RUNTIME_FORBIDDEN_PATTERNS: RegExp[] = [
  /^lib[/\\]booking-autopilot[/\\]/i,
  /^worker[/\\]src[/\\]/i,
  /^app[/\\]api[/\\]booking-jobs[/\\]/i,
  /^app[/\\]api[/\\]v1[/\\]/i,
  /^lib[/\\]db\.ts$/i,
  /(^|[/\\])(schema|schemas|migrations)[/\\]/i,
];

type QueueContext = {
  byBranch: Map<string, AgentReturnReport>;
  supersededBy: Map<string, string>;
  mergedBranches: Set<string>;
};

export function classifyAgentReturnReport(
  report: AgentReturnReport,
  options: AgentIntakeOptions = {},
  context?: QueueContext,
): AgentIntakeResult {
  const requiredBaseBranch = options.requiredBaseBranch ?? DEFAULT_REQUIRED_BASE_BRANCH;
  const requiredValidations = options.requiredValidations ?? [...DEFAULT_REQUIRED_VALIDATIONS];
  const queueContext = context ?? buildQueueContext([report], options);
  const issues: AgentIntakeIssue[] = [];

  const baseIssue = baseMismatch(report, requiredBaseBranch, options.requiredBaseCommit);
  if (baseIssue) issues.push(baseIssue);

  if (!isTaskKind(report.taskKind)) {
    issues.push({
      code: "invalid_task_kind",
      severity: "reject",
      message: "Every returned task must declare one supported task kind.",
      evidence: [report.taskKind ?? "missing"],
    });
  }

  const forbiddenPaths = [...report.changedFiles, ...(report.artifacts ?? [])].filter(isForbiddenArtifactPath);
  if (forbiddenPaths.length > 0) {
    issues.push({
      code: "forbidden_artifact",
      severity: "reject",
      message: "Branch metadata includes local artifacts or secret-bearing paths that should not be merged.",
      evidence: forbiddenPaths,
    });
  }

  if (options.forbidProviderRuntimeChanges) {
    const forbiddenRuntimePaths = report.changedFiles.filter(isProviderRuntimeForbiddenPath);
    if (forbiddenRuntimePaths.length > 0) {
      issues.push({
        code: "provider_runtime_without_permission",
        severity: "reject",
        message: "Branch touches provider runtime, worker, API mutation, DB, or schema paths without permission.",
        evidence: forbiddenRuntimePaths,
      });
    }
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

  const supersedingBranch = queueContext.supersededBy.get(report.branch);
  if (supersedingBranch) {
    issues.push({
      code: "superseded_by_newer_branch",
      severity: "reject",
      message: "A newer returned branch supersedes this branch.",
      evidence: [supersedingBranch],
    });
  }

  for (const edge of report.dependencyEdges ?? []) {
    if (edge.type === "requires_rebase_before_merge") {
      issues.push({
        code: "requires_rebase_before_merge",
        severity: "followup",
        message: "Branch metadata says it must be rebased before merge.",
        evidence: [edge.reason ?? edge.targetBranch ?? "requires rebase"],
      });
    }
    if (edge.type === "depends_on_shared_schema") {
      const dependencyIssue = sharedSchemaDependencyIssue(report, edge, queueContext);
      if (dependencyIssue) issues.push(dependencyIssue);
    }
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
  const context = buildQueueContext(reports, options);
  const baseResults = reports.map((report) => classifyAgentReturnReport(report, options, context));
  const byBranch = new Map(baseResults.map((result) => [result.report.branch, result]));
  const results = baseResults.map((result) =>
    finalizeDependencyIssues(result, byBranch, context),
  );

  const byIssue = { ...ZERO_ISSUES };
  const byTaskKind = { ...ZERO_TASK_KINDS };
  let dependencyEdges = 0;
  for (const result of results) {
    if (isTaskKind(result.report.taskKind)) byTaskKind[result.report.taskKind] += 1;
    dependencyEdges += result.report.dependencyEdges?.length ?? 0;
    for (const issue of result.issues) byIssue[issue.code] += 1;
  }

  const summary: AgentIntakeSummary = {
    total: results.length,
    readyToMerge: results.filter((result) => result.decision === "ready_to_merge").length,
    needsFollowup: results.filter((result) => result.decision === "needs_followup").length,
    reject: results.filter((result) => result.decision === "reject").length,
    byIssue,
    byTaskKind,
    dependencyEdges,
    supersededBranches: Array.from(context.supersededBy.keys()).sort(),
  };

  return {
    summary,
    nextTaskRecommendation: recommendNextTask(results, options),
    results,
    notes: [
      "Intake uses returned branch metadata only; it does not merge, fetch branch diffs, or run providers.",
      "ready_to_merge means metadata is clean enough for Codex to start normal merge validation.",
      "needs_followup means the returning agent should add evidence, rebase, or validation before merge review.",
      "reject means the branch violates base, artifact, supersession, task-kind, or claim rules.",
    ],
  };
}

export function parseAgentIntakeJson(input: string): AgentReturnReport[] {
  const parsed = JSON.parse(input) as unknown;
  if (Array.isArray(parsed)) return parsed.map(normalizeReport);
  if (isRecord(parsed) && Array.isArray(parsed.reports)) return parsed.reports.map(normalizeReport);
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

    reports.push(normalizeReport({
      id: fields.get("id") || heading,
      agent: fields.get("agent"),
      branch: fields.get("branch") ?? heading,
      commit: fields.get("commit") ?? "unknown",
      base: {
        branch: fields.get("basebranch") ?? fields.get("base") ?? "",
        commit: fields.get("basecommit"),
        containsRequiredCommit: parseBoolean(fields.get("basecontainsrequiredcommit")),
      },
      taskKind: fields.get("taskkind"),
      mergeState: fields.get("mergestate"),
      summary: fields.get("summary"),
      changedFiles: parseList(fields.get("changedfiles") ?? fields.get("changedpaths")),
      artifacts: parseList(fields.get("artifacts")),
      validations: parseValidationList(fields.get("validations")),
      dependencyEdges: parseDependencyEdges(fields.get("dependencyedges") ?? fields.get("dependencies")),
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
  if (filename.endsWith(".md") || filename.endsWith(".markdown") || trimmed.startsWith("#")) {
    return parseAgentIntakeMarkdown(trimmed);
  }
  return parseAgentIntakeJson(trimmed);
}

export function renderAgentIntakeMarkdown(report: AgentIntakeQueueReport): string {
  const rec = report.nextTaskRecommendation;
  const lines = [
    "# Agent Intake Queue",
    "",
    ...report.notes,
    "",
    `Total: ${report.summary.total}`,
    `Ready to merge: ${report.summary.readyToMerge}`,
    `Needs follow-up: ${report.summary.needsFollowup}`,
    `Reject: ${report.summary.reject}`,
    `Dependency edges: ${report.summary.dependencyEdges}`,
    "",
    "## Next Task Recommendation",
    "",
    `can_start_next_task: ${rec.can_start_next_task}`,
    `reason: ${rec.reason}`,
    `recommended_base: ${rec.recommended_base}`,
    `conflict_risk: ${rec.conflict_risk}`,
  ];

  if (rec.blockers.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of rec.blockers) lines.push(`- ${blocker}`);
  }

  lines.push(
    "",
    "## Queue",
    "",
    "| Branch | Kind | Decision | Commit | Merge State | Issues |",
    "| --- | --- | --- | --- | --- | --- |",
  );

  for (const result of report.results) {
    const issues = result.issues.length === 0
      ? "-"
      : result.issues.map((issue) => `\`${issue.code}\``).join(", ");
    lines.push(
      `| \`${result.report.branch}\` | \`${result.report.taskKind ?? "missing"}\` | \`${result.decision}\` | \`${result.report.commit}\` | \`${result.report.mergeState ?? "unknown"}\` | ${issues} |`,
    );
  }

  lines.push("", "## Task Kinds", "", "| Kind | Count |", "| --- | ---: |");
  for (const [kind, count] of Object.entries(report.summary.byTaskKind)) {
    if (count > 0) lines.push(`| \`${kind}\` | ${count} |`);
  }

  lines.push("", "## Issue Counts", "", "| Issue | Count |", "| --- | ---: |");
  for (const [issue, count] of Object.entries(report.summary.byIssue)) {
    if (count > 0) lines.push(`| \`${issue}\` | ${count} |`);
  }

  lines.push("", "## Dependency Edges", "", "| Branch | Edge | Target | Required | Reason |", "| --- | --- | --- | --- | --- |");
  for (const result of report.results) {
    for (const edge of result.report.dependencyEdges ?? []) {
      lines.push(
        `| \`${result.report.branch}\` | \`${edge.type}\` | ${edge.targetBranch ? `\`${edge.targetBranch}\`` : "-"} | \`${edge.requiredState ?? "-"}\` | ${edge.reason ?? "-"} |`,
      );
    }
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

function buildQueueContext(reports: AgentReturnReport[], options: AgentIntakeOptions): QueueContext {
  const supersededBy = new Map<string, string>();
  for (const report of reports) {
    for (const edge of report.dependencyEdges ?? []) {
      if (edge.type === "supersedes" && edge.targetBranch) supersededBy.set(edge.targetBranch, report.branch);
    }
  }
  return {
    byBranch: new Map(reports.map((report) => [report.branch, report])),
    supersededBy,
    mergedBranches: new Set(options.mergedBranches ?? []),
  };
}

function finalizeDependencyIssues(
  result: AgentIntakeResult,
  byBranch: Map<string, AgentIntakeResult>,
  context: QueueContext,
): AgentIntakeResult {
  const dependencyIssues = (result.report.dependencyEdges ?? [])
    .map((edge): AgentIntakeIssue | null => {
      if (edge.type !== "depends_on_shared_schema" || !edge.targetBranch) return null;
      const target = byBranch.get(edge.targetBranch);
      const targetMerged = context.mergedBranches.has(edge.targetBranch) || target?.report.mergeState === "merged";
      const targetReady = target?.decision === "ready_to_merge";
      const requiredState = edge.requiredState ?? "merged";
      const ok =
        requiredState === "present"
          ? Boolean(target) || targetMerged
          : requiredState === "ready_to_merge"
            ? targetReady || targetMerged
            : targetMerged;
      if (ok) return null;
      return {
        code: "unresolved_shared_schema_dependency" as const,
        severity: "followup" as const,
        message: `Branch depends on shared schema ${edge.targetBranch} before it is ${requiredState}.`,
        evidence: [edge.targetBranch, edge.reason ?? "shared schema dependency"],
      };
    })
    .filter((issue): issue is AgentIntakeIssue => issue !== null);

  if (dependencyIssues.length === 0) return result;
  const issues = [...result.issues, ...dependencyIssues];
  return {
    ...result,
    issues,
    decision: decideIntakeStatus(issues),
  };
}

function sharedSchemaDependencyIssue(
  report: AgentReturnReport,
  edge: AgentDependencyEdge,
  context: QueueContext,
): AgentIntakeIssue | null {
  if (!edge.targetBranch) {
    return {
      code: "unresolved_shared_schema_dependency",
      severity: "followup",
      message: "Shared schema dependency edge is missing targetBranch.",
      evidence: [report.branch],
    };
  }
  const targetExists = context.byBranch.has(edge.targetBranch) || context.mergedBranches.has(edge.targetBranch);
  if (targetExists) return null;
  return {
    code: "unresolved_shared_schema_dependency",
    severity: "followup",
    message: "Branch depends on a shared schema branch not present in intake metadata.",
    evidence: [edge.targetBranch],
  };
}

function recommendNextTask(
  results: AgentIntakeResult[],
  options: AgentIntakeOptions,
): AgentNextTaskRecommendation {
  const recommendedBase = options.recommendedBase ?? options.requiredBaseBranch ?? DEFAULT_REQUIRED_BASE_BRANCH;
  const dependencyBlockers = collectIssues(results, "unresolved_shared_schema_dependency");
  const rebaseBlockers = collectIssues(results, "requires_rebase_before_merge");
  const rejectBlockers = results.filter((result) => result.decision === "reject").map((result) => result.report.branch);
  const validationBlockers = collectIssues(results, "missing_validation");

  if (dependencyBlockers.length > 0) {
    return {
      can_start_next_task: false,
      reason: "Dependent agents must wait for the shared schema branch to merge or be declared ready.",
      recommended_base: recommendedBase,
      conflict_risk: "high",
      blockers: dependencyBlockers,
    };
  }

  if (rejectBlockers.length > 0) {
    return {
      can_start_next_task: true,
      reason: "Only independent follow-up work should start; rejected branches must not be used as a base.",
      recommended_base: recommendedBase,
      conflict_risk: "high",
      blockers: rejectBlockers,
    };
  }

  if (rebaseBlockers.length > 0 || validationBlockers.length > 0) {
    return {
      can_start_next_task: true,
      reason: "Independent tasks can start from the accepted base while follow-up validation or rebases run.",
      recommended_base: recommendedBase,
      conflict_risk: "medium",
      blockers: [...rebaseBlockers, ...validationBlockers],
    };
  }

  return {
    can_start_next_task: true,
    reason: "No blocking shared-contract dependency is unresolved; start independent work from the accepted base.",
    recommended_base: recommendedBase,
    conflict_risk: "low",
    blockers: [],
  };
}

function collectIssues(results: AgentIntakeResult[], code: AgentIntakeIssueCode): string[] {
  const blockers: string[] = [];
  for (const result of results) {
    for (const issue of result.issues) {
      if (issue.code === code) blockers.push(`${result.report.branch}: ${issue.evidence.join(", ")}`);
    }
  }
  return blockers;
}

function baseMismatch(
  report: AgentReturnReport,
  requiredBaseBranch: string,
  requiredBaseCommit?: string,
): AgentIntakeIssue | null {
  const evidence: string[] = [];
  if (report.base.branch !== requiredBaseBranch) evidence.push(`base.branch=${report.base.branch || "missing"}`);
  if (requiredBaseCommit) {
    const commitMatches = report.base.commit?.startsWith(requiredBaseCommit) ?? false;
    const containsCommit = report.base.containsRequiredCommit === true;
    if (!commitMatches && !containsCommit) evidence.push(`base.commit=${report.base.commit || "missing"}`);
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

function isProviderRuntimeForbiddenPath(pathname: string): boolean {
  return PROVIDER_RUNTIME_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(pathname));
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
    taskKind: taskKindOrUndefined(raw.taskKind),
    mergeState: mergeStateOrUndefined(raw.mergeState),
    summary: stringOrUndefined(raw.summary),
    changedFiles: stringArray(raw.changedFiles),
    artifacts: stringArray(raw.artifacts),
    validations: validationArray(raw.validations),
    dependencyEdges: dependencyArray(raw.dependencyEdges),
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

function dependencyArray(value: unknown): AgentDependencyEdge[] {
  if (typeof value === "string") return parseDependencyEdges(value);
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Dependency entries must be objects.");
    return {
      type: dependencyType(item.type),
      targetBranch: stringOrUndefined(item.targetBranch),
      requiredState: dependencyRequiredState(item.requiredState),
      reason: stringOrUndefined(item.reason),
    };
  });
}

function dependencyType(value: unknown): AgentDependencyEdgeType {
  if (
    value === "depends_on_shared_schema" ||
    value === "independent" ||
    value === "supersedes" ||
    value === "requires_rebase_before_merge"
  ) {
    return value;
  }
  return "independent";
}

function dependencyRequiredState(value: unknown): AgentDependencyRequiredState | undefined {
  if (value === "present" || value === "ready_to_merge" || value === "merged") return value;
  return undefined;
}

function validationStatus(value: unknown): AgentReturnValidationStatus {
  if (value === "pass" || value === "fail" || value === "missing" || value === "skipped") return value;
  return "missing";
}

function taskKindOrUndefined(value: unknown): AgentTaskKind | undefined {
  return isTaskKind(value) ? value : undefined;
}

function mergeStateOrUndefined(value: unknown): AgentMergeState | undefined {
  if (value === "merged" || value === "unmerged" || value === "unknown") return value;
  return undefined;
}

function isTaskKind(value: unknown): value is AgentTaskKind {
  return typeof value === "string" && TASK_KINDS.has(value as AgentTaskKind);
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
  return value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
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

function parseDependencyEdges(value: string | undefined): AgentDependencyEdge[] {
  return parseList(value).map((entry) => {
    const [rawType, rawTarget, rawState] = entry.split(">").map((item) => item.trim());
    return {
      type: dependencyType(rawType),
      targetBranch: rawTarget || undefined,
      requiredState: dependencyRequiredState(rawState),
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
