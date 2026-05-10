import { listWorkedExamples } from "@/lib/operator-failure-taxonomy";

export const PHASE_CLOSURE_EVIDENCE_PACK_VERSION = 1 as const;
export const CANONICAL_PHASE_CLOSURE_BASE_SHORT_SHA = "63837d9";
export const CANONICAL_PHASE_CLOSURE_BASE_SHA =
  "63837d92f7bb286e4463684054e65e8381c6e1f8";

export type PhaseClosureVerdict = "closed" | "blocked" | "frozen";

export type PhaseClosureId = "phase-0a" | "phase-1" | "phase-1.5" | "phase-2";

export type PhaseClosureDocumentKey =
  | "phaseStatus"
  | "huddle"
  | "codex"
  | "claude"
  | "phase2"
  | "providerClosureAcceptance"
  | "providerClosureOperatorRoom"
  | "liveClosureEvidenceProtocol"
  | "demoFreezeAcceptance"
  | "demoControlRoom"
  | "ycDemoRunbook";

export interface PhaseClosureEvidenceDocuments {
  phaseStatus: string;
  huddle: string;
  codex: string;
  claude: string;
  phase2: string;
  providerClosureAcceptance: string;
  providerClosureOperatorRoom: string;
  liveClosureEvidenceProtocol: string;
  demoFreezeAcceptance: string;
  demoControlRoom: string;
  ycDemoRunbook: string;
}

export interface PhaseClosureEvidenceInput {
  canonicalIntegratedPreviewSha: string;
  generatedAt?: string;
  documents: PhaseClosureEvidenceDocuments;
}

export interface PhaseClosureEvidenceCheck {
  key: string;
  label: string;
  passed: boolean;
  source: string;
}

export interface PhaseClosureRow {
  id: PhaseClosureId;
  phase: "Phase 0A" | "Phase 1" | "Phase 1.5" | "Phase 2";
  status: string;
  closureVerdict: PhaseClosureVerdict;
  blockingEvidence: string;
  closureUnblockPlan: string;
  closureProofRequired: string;
  nextSingleAllowedAction: string;
  hardStopReminder: string;
  evidenceRefs: string[];
}

export interface PhaseClosureIntegrationAnchor {
  owner: "Agent2" | "Agent3" | "Claude" | "Goal" | "Codex";
  label: string;
  evidence: string;
}

export interface PhaseClosureEvidencePack {
  schemaVersion: typeof PHASE_CLOSURE_EVIDENCE_PACK_VERSION;
  generatedAt: string;
  canonicalIntegratedPreviewSha: string;
  canonicalIntegratedPreviewShortSha: string;
  providerClosureLiveVerifiedEvidencePresent: boolean;
  latestR030Evidence: {
    category: "model_env_transient";
    label: string;
    evidenceId: string;
    takeaway: string;
  };
  checks: PhaseClosureEvidenceCheck[];
  phases: PhaseClosureRow[];
  integrationAnchors: PhaseClosureIntegrationAnchor[];
  hardStops: string[];
  summary: string;
}

export const PHASE_CLOSURE_REQUIRED_DOCS: Record<
  PhaseClosureDocumentKey,
  string
> = {
  phaseStatus: "docs/00-start-here/PHASE_STATUS.md",
  huddle: "docs/10-coordination/HUDDLE.md",
  codex: "docs/10-coordination/codex.md",
  claude: "docs/10-coordination/claude.md",
  phase2: "docs/10-coordination/phase2.md",
  providerClosureAcceptance:
    "docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md",
  providerClosureOperatorRoom:
    "docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md",
  liveClosureEvidenceProtocol:
    "docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md",
  demoFreezeAcceptance: "docs/90-archive/phase1-demo/DEMO_FREEZE_ACCEPTANCE.md",
  demoControlRoom: "docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md",
  ycDemoRunbook: "docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md",
};

export const PHASE_CLOSURE_HARD_STOPS = [
  "No live OpenAI, provider, browser automation, worker start, or DB mutation from this pack.",
  "No payment, CVV/security-code, OTP/CAPTCHA/login handling, account verification, human verification, or final confirmation.",
  "No Phase 2 live promise until Provider Closure Acceptance records verified live closure evidence.",
] as const;

export function buildPhaseClosureEvidencePack(
  input: PhaseClosureEvidenceInput,
): PhaseClosureEvidencePack {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const shortSha = input.canonicalIntegratedPreviewSha.slice(0, 7);
  const hasVerifiedLiveClosure = hasProviderClosureAcceptanceEvidence(
    input.documents.providerClosureAcceptance,
  );
  const r030 = findLatestR030ModelEnvWorkedExample();
  const checks = buildEvidenceChecks(input.documents, {
    shortSha,
    hasVerifiedLiveClosure,
  });

  const phases: PhaseClosureRow[] = [
    {
      id: "phase-0a",
      phase: "Phase 0A",
      status: "Closed via OpenTable safe handoff",
      closureVerdict: "closed",
      blockingEvidence:
        "OpenTable Sirrah live dogfood on 2026-05-05 reached the final review boundary with phone filled and stopped before Complete reservation. DB/log/operator evidence is recorded in Provider Closure Acceptance.",
      closureUnblockPlan:
        "Phase 0B can broaden OpenTable-first restaurant fixtures. Resy remains a provider/network/IP follow-up lane and should use the probe/readiness flow before any future controlled attempt.",
      closureProofRequired:
        "Recorded: OpenTable Sirrah non-synthetic provider-path evidence with `safe_handoff` / `ready_for_confirmation`, DB row, agent logs, local snapshot path, human screenshot, and operator sign-off.",
      nextSingleAllowedAction:
        "Review the Sirrah OpenTable evidence, then prepare a Phase 0B OpenTable-first fixture plan; do not click final confirmation.",
      hardStopReminder:
        "Stop before payment, final reservation, OTP/CAPTCHA/login handling, account verification, and human verification.",
      evidenceRefs: [
        PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
        PHASE_CLOSURE_REQUIRED_DOCS.providerClosureAcceptance,
        PHASE_CLOSURE_REQUIRED_DOCS.liveClosureEvidenceProtocol,
        "lib/operator-failure-taxonomy/categories.ts",
      ],
    },
    {
      id: "phase-1",
      phase: "Phase 1",
      status: "Demo-freeze passed",
      closureVerdict: "blocked",
      blockingEvidence:
        "Phase 1 gate, smoke, and autonomous founder E2E are recorded as passing, but Phase 1 still lists the founder manual E2E walkthrough as the final acceptance check. Documentation and tooling alone do not close the phase.",
      closureUnblockPlan:
        "External founder-acceptance blocker: founder runs the manual E2E walkthrough on the intended integrated preview and records pass/fail. If it fails, the smallest code fix is the single UI/API/runtime gap exposed by that walkthrough; no current code fix is inferable from docs alone.",
      closureProofRequired:
        "Founder manual walkthrough sign-off, or a named blocker with the exact smallest code/runtime owner if the walkthrough fails.",
      nextSingleAllowedAction:
        "Have the founder or operator perform the manual walkthrough acceptance step and record the result; keep provider execution out of this phase-level pack.",
      hardStopReminder:
        "Do not turn Phase 1 demo readiness into provider, payment, OTP/CAPTCHA/login, or final-confirm automation.",
      evidenceRefs: [
        PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
        PHASE_CLOSURE_REQUIRED_DOCS.demoFreezeAcceptance,
        PHASE_CLOSURE_REQUIRED_DOCS.demoControlRoom,
        PHASE_CLOSURE_REQUIRED_DOCS.ycDemoRunbook,
      ],
    },
    {
      id: "phase-1.5",
      phase: "Phase 1.5",
      status: "Demo-freeze passed",
      closureVerdict: "blocked",
      blockingEvidence:
        "Quality gate, demo-control surfaces, runtime forensics, and demo-readiness evidence are passed for the freeze, but that is observability/QA readiness. It is not phase closure from docs, fixtures, or tooling alone.",
      closureUnblockPlan:
        "External QA/founder acceptance blocker: rerun or read the latest Phase 1.5 gate, route dogfood, and demo-control evidence on the intended integrated preview, then record an explicit acceptance note. If a gate fails, fix only the smallest surfaced polish/import/build issue.",
      closureProofRequired:
        "Explicit QA/founder acceptance of the latest integrated preview gate/dogfood state, or one named failing gate with its owner.",
      nextSingleAllowedAction:
        "Record the Phase 1.5 acceptance result after the latest no-live gates are read or rerun; do not add mutating controls.",
      hardStopReminder:
        "Do not add run/retry/live buttons or any mutating provider control to QA dashboards.",
      evidenceRefs: [
        PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
        PHASE_CLOSURE_REQUIRED_DOCS.demoFreezeAcceptance,
        PHASE_CLOSURE_REQUIRED_DOCS.demoControlRoom,
      ],
    },
    {
      id: "phase-2",
      phase: "Phase 2",
      status: "Frozen, not demo-promised",
      closureVerdict: "frozen",
      blockingEvidence:
        "Agent2 Expedia and Agent3 hotel hardening are integrated, but flight and hotel lanes remain liveVerified false; Goal war-room reports are no-live/synthetic and cannot prove Phase 2 provider closure.",
      closureUnblockPlan:
        "Cannot be closed by more docs, fixtures, or tooling. Founder must approve one exact controlled live retry for a chosen lane after reading Provider Closure Acceptance; Expedia's MCO -> BNA/Southwest case and Booking.com's YOTEL case are the named candidates. Only a fresh accepted artifact can unblock the lane.",
      closureProofRequired:
        "A fresh, non-synthetic, founder-approved restaurant/flight/hotel artifact with `liveAttempt: true`, minimum DB/log/screenshot evidence, accepted terminal outcome, and Provider Closure Acceptance sign-off.",
      nextSingleAllowedAction:
        "Read Provider Closure Acceptance and inspect local artifacts; only a separately founder-approved single controlled retry can create new closure evidence.",
      hardStopReminder:
        "No Phase 2 provider promise, broad suite, payment/CVV, OTP/CAPTCHA/login handling, verification handling, or final confirmation.",
      evidenceRefs: [
        PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
        PHASE_CLOSURE_REQUIRED_DOCS.phase2,
        PHASE_CLOSURE_REQUIRED_DOCS.providerClosureAcceptance,
        PHASE_CLOSURE_REQUIRED_DOCS.providerClosureOperatorRoom,
        PHASE_CLOSURE_REQUIRED_DOCS.liveClosureEvidenceProtocol,
      ],
    },
  ];

  return {
    schemaVersion: PHASE_CLOSURE_EVIDENCE_PACK_VERSION,
    generatedAt,
    canonicalIntegratedPreviewSha: input.canonicalIntegratedPreviewSha,
    canonicalIntegratedPreviewShortSha: shortSha,
    providerClosureLiveVerifiedEvidencePresent: hasVerifiedLiveClosure,
    latestR030Evidence: {
      category: "model_env_transient",
      label: r030.title,
      evidenceId: r030.id,
      takeaway: r030.takeaway,
    },
    checks,
    phases,
    integrationAnchors: buildIntegrationAnchors(),
    hardStops: [...PHASE_CLOSURE_HARD_STOPS],
    summary:
      "Phase 0A is closed via OpenTable safe handoff. Phase 1 and Phase 1.5 are demo-freeze passed, but still need human acceptance to close. Phase 2 remains frozen and not live verified.",
  };
}

export function formatPhaseClosureEvidencePackMarkdown(
  pack: PhaseClosureEvidencePack,
): string {
  const lines: string[] = [];
  lines.push("# Phase Closure Evidence Pack");
  lines.push("");
  lines.push(`Last generated: ${pack.generatedAt}`);
  lines.push(
    `Canonical integrated preview: \`origin/codex/integrated-preview-20260504 @ ${pack.canonicalIntegratedPreviewShortSha}\` (\`${pack.canonicalIntegratedPreviewSha}\`).`,
  );
  lines.push("");
  lines.push("Scope: no-live phase-level evidence summary from existing docs, reports, artifacts, and read-only tooling. This pack does not start providers, OpenAI, browsers, workers, DB mutations, payment, verification handling, or final confirmation.");
  lines.push("");
  lines.push("## Bottom Line");
  lines.push("");
  lines.push(pack.summary);
  lines.push("");
  lines.push("Closure claim rule: tooling integrated is not provider closure proven, and docs / fixtures / green no-live tests do not close a phase by themselves. Do not claim any provider lane is live verified unless `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` records a non-empty verified live closure section for that lane.");
  lines.push("");
  lines.push("## Phase Table");
  lines.push("");
  lines.push("| Phase | Status | Closure verdict | Blocking / closure evidence | Closure unblock plan | Next single allowed action | Hard-stop reminder |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const phase of pack.phases) {
    lines.push(
      `| ${phase.phase} | ${escapeTableCell(phase.status)} | \`${phase.closureVerdict}\` | ${escapeTableCell(phase.blockingEvidence)} | ${escapeTableCell(phase.closureUnblockPlan)} | ${escapeTableCell(phase.nextSingleAllowedAction)} | ${escapeTableCell(phase.hardStopReminder)} |`,
    );
  }
  lines.push("");
  lines.push("## Closure Proof Required");
  lines.push("");
  for (const phase of pack.phases) {
    lines.push(`- **${phase.phase}** - ${phase.closureProofRequired}`);
  }
  lines.push("");
  lines.push("## Evidence Checks");
  lines.push("");
  for (const check of pack.checks) {
    const status = check.passed ? "pass" : "fail";
    lines.push(`- \`${status}\` - ${check.label} (${check.source})`);
  }
  lines.push("");
  lines.push("## Integration Anchors");
  lines.push("");
  for (const anchor of pack.integrationAnchors) {
    lines.push(`- **${anchor.owner}** - ${anchor.label}: ${anchor.evidence}`);
  }
  lines.push("");
  lines.push("## R-030 Runtime Env/Project Mismatch");
  lines.push("");
  lines.push(`- Evidence id: \`${pack.latestR030Evidence.evidenceId}\``);
  lines.push(`- Category: \`${pack.latestR030Evidence.category}\``);
  lines.push(`- Label: ${pack.latestR030Evidence.label}`);
  lines.push(`- Takeaway: ${pack.latestR030Evidence.takeaway}`);
  lines.push("");
  lines.push("This is runtime env/project blocked evidence, not a Resy provider pass/fail. It does not affect the OpenTable Phase 0A closure.");
  lines.push("");
  lines.push("## Hard Stops");
  lines.push("");
  for (const stop of pack.hardStops) {
    lines.push(`- ${stop}`);
  }
  lines.push("");
  lines.push("## Source Documents");
  lines.push("");
  for (const source of Object.values(PHASE_CLOSURE_REQUIRED_DOCS)) {
    lines.push(`- \`${source}\``);
  }
  return `${lines.join("\n")}\n`;
}

export function hasProviderClosureAcceptanceEvidence(doc: string): boolean {
  const sections = doc.split(/###\s+Verified live closure/i).slice(1);
  if (sections.length === 0) return false;
  return sections.some((section) => {
    const body = section.split(/^##\s|^###\s/m)[0] ?? "";
    return !/\bNone\./i.test(body) && /\bartifact|operator|sign-?off|bundle/i.test(body);
  });
}

function buildEvidenceChecks(
  documents: PhaseClosureEvidenceDocuments,
  context: { shortSha: string; hasVerifiedLiveClosure: boolean },
): PhaseClosureEvidenceCheck[] {
  const allCoord = [
    documents.huddle,
    documents.codex,
    documents.claude,
    documents.phase2,
  ].join("\n");
  const r030 = findLatestR030ModelEnvWorkedExample();
  return [
    {
      key: "canonical-sha",
      label: `Canonical integrated preview SHA is ${context.shortSha}`,
      passed: context.shortSha === CANONICAL_PHASE_CLOSURE_BASE_SHORT_SHA,
      source: "git/origin integrated preview",
    },
    {
      key: "phase-0a-opentable-closed",
      label:
        "Phase 0A is closed by OpenTable Sirrah safe handoff evidence",
      passed:
        /Phase 0A[\s\S]{0,120}Closed via OpenTable/i.test(documents.phaseStatus) &&
        /OpenTable Sirrah safe handoff[\s\S]{0,120}accepted closure/i.test(
          documents.providerClosureAcceptance,
        ),
      source: PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
    },
    {
      key: "r030-model-env",
      label:
        "Latest R-030 runtime env/project mismatch is model_env_transient / infra blocked, not provider pass/fail",
      passed:
        r030.category === "model_env_transient" &&
        (/OpenAI Responses API[\s\S]{0,80}403[\s\S]{0,80}model_not_found/i.test(
          r030.story,
        ) ||
          r030.evidence.some((row) =>
            /OpenAI Responses API 403 model_not_found/i.test(row.value),
          )) &&
        /F-INFRA-MODEL-ACCESS/i.test(r030.takeaway) &&
        /not a Resy provider regression/i.test(r030.takeaway) &&
        /2026-05-05 R-030 retry[\s\S]{0,360}model_env_transient/i.test(
          documents.providerClosureAcceptance,
        ),
      source: "lib/operator-failure-taxonomy/categories.ts",
    },
    {
      key: "phase-1-demo-freeze",
      label: "Phase 1 remains demo-freeze passed but still needs human acceptance",
      passed:
        /Phase 1\s*-\s*First Paying User Path[\s\S]{0,160}Demo-freeze passed/i.test(
          documents.phaseStatus,
        ) ||
        /Phase 1\s*\|\s*Demo-freeze passed/i.test(documents.phaseStatus),
      source: PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
    },
    {
      key: "phase-1-human-acceptance",
      label:
        "Phase 1 is not closed from tooling alone because founder manual E2E remains final acceptance",
      passed: /Founder manual E2E walkthrough remains the final acceptance check/i.test(
        documents.phaseStatus,
      ),
      source: PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
    },
    {
      key: "phase-1-5-demo-freeze",
      label: "Phase 1.5 remains demo-freeze passed but needs explicit acceptance to close",
      passed:
        /Phase 1\.5\s*-\s*QA and polish[\s\S]{0,160}Demo-freeze passed/i.test(
          documents.phaseStatus,
        ) ||
        /Phase 1\.5\s*\|\s*Demo-freeze passed/i.test(documents.phaseStatus),
      source: PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus,
    },
    {
      key: "phase-2-not-live-verified",
      label:
        "Phase 2 remains not demo-promised / not live verified despite Expedia and hotel hardening",
      passed:
        /Runtime closure hardening, not demo-promised/i.test(
          documents.phaseStatus,
        ) &&
        /not live[- ]verified/i.test(documents.demoFreezeAcceptance) &&
        /flight and hotel remain not live verified/i.test(
          documents.providerClosureAcceptance + documents.phaseStatus,
        ),
      source: PHASE_CLOSURE_REQUIRED_DOCS.demoFreezeAcceptance,
    },
    {
      key: "agent2-expedia-anchor",
      label: "Agent2 Expedia closure evidence is integrated but not closure-pass",
      passed:
        /Agent2\s+`codex\/flight-live-closure-final @ fa7afc3`/i.test(
          allCoord,
        ) && /selector_drift/i.test(allCoord),
      source: PHASE_CLOSURE_REQUIRED_DOCS.huddle,
    },
    {
      key: "agent3-hotel-anchor",
      label: "Agent3 hotel hardening is integrated but still liveVerified false",
      passed:
        /Agent3\s+`codex\/hotel-live-closure-final @ 12b5a0e`/i.test(
          allCoord,
        ) && /Booking\.com/i.test(allCoord),
      source: PHASE_CLOSURE_REQUIRED_DOCS.huddle,
    },
    {
      key: "claude-acceptance-anchor",
      label: "Claude acceptance criteria now records restaurant evidence and keeps remaining lanes gated",
      passed:
        /provider-closure-acceptance-final/i.test(allCoord) &&
        context.hasVerifiedLiveClosure &&
        /Tooling passing is not provider closure passing/i.test(
          documents.providerClosureAcceptance,
        ),
      source: PHASE_CLOSURE_REQUIRED_DOCS.providerClosureAcceptance,
    },
    {
      key: "goal-war-room-anchor",
      label: "Goal war-room exists but synthetic reports cannot prove live readiness",
      passed:
        /goal-provider-closure-war-room/i.test(allCoord) &&
        /synthetic/i.test(documents.liveClosureEvidenceProtocol) &&
        (/synthetic[\s\S]{0,180}cannot claim/i.test(
          documents.providerClosureOperatorRoom + documents.liveClosureEvidenceProtocol,
        ) ||
          /Synthetic fixtures[\s\S]{0,220}not live verified/i.test(
            documents.liveClosureEvidenceProtocol,
          )),
      source: PHASE_CLOSURE_REQUIRED_DOCS.liveClosureEvidenceProtocol,
    },
  ];
}

function buildIntegrationAnchors(): PhaseClosureIntegrationAnchor[] {
  return [
    {
      owner: "Agent2",
      label: "Expedia flight live closure final",
      evidence:
        "`codex/flight-live-closure-final @ fa7afc3` integrated as `25d29fb`; one authorized MCO -> BNA retry ended `selector_drift`, not closure-pass.",
    },
    {
      owner: "Agent3",
      label: "Hotel live closure final",
      evidence:
        "`codex/hotel-live-closure-final @ 12b5a0e` integrated as `7916ff1`; Booking.com prompt/runtime hardening is integrated, but provider closure acceptance remains unverified.",
    },
    {
      owner: "Claude",
      label: "Provider closure acceptance",
      evidence:
        "`claude/provider-closure-acceptance-final @ ed46abc` integrated as `c33b429`; restaurant now records accepted OpenTable evidence while flight/hotel remain gated until evidence is recorded.",
    },
    {
      owner: "Goal",
      label: "Provider Closure War Room",
      evidence:
        "`codex/goal-provider-closure-war-room @ 29ebdc6` integrated as `7597b12`; war-room reports are no-live evidence tooling and synthetic reports cannot prove closure.",
    },
    {
      owner: "Codex",
      label: "R-030 runtime env/project mismatch",
      evidence:
        "Latest R-030 OpenAI Responses API 403 `model_not_found` is preserved as `model_env_transient` / `F-INFRA-MODEL-ACCESS`, not a Resy provider regression.",
    },
  ];
}

function findLatestR030ModelEnvWorkedExample(): ReturnType<
  typeof listWorkedExamples
>[number] {
  const found = listWorkedExamples().find((example) =>
    example.id.includes("r030-openai-403-model-not-found"),
  );
  if (!found || found.category !== "model_env_transient") {
    throw new Error("R-030 model_env_transient worked example is missing.");
  }
  return found;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
