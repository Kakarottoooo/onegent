/**
 * Safe demo script - deterministic content for the founder-facing
 * demo prep dashboard.
 *
 * Pulled together from:
 *   - `docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md` (manual checklist)
 *   - `docs/90-archive/phase1-demo/PHASE_1_PLAN.md` (happy path)
 *   - `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
 *     (safety boundaries)
 *   - User-locked safety rules:
 *       * no payment
 *       * no OTP bypass
 *       * no CAPTCHA bypass
 *       * stop before final confirm
 *
 * Pure module - no fs / DB / LLM. Imported by the page server
 * component and by tests. Markdown export keeps the same content
 * verbatim so the founder can copy + paste into Slack / a deck.
 */

/* ------ Public types ---------------------------------------------------------------------------------------------------- */

export interface DemoScriptStep {
  /** 1-based ordinal for display. */
  index: number;
  /** Short verb phrase. */
  title: string;
  /** What the founder should say or do. */
  body: string;
  /** Optional safety note rendered alongside the step. */
  safety?: string;
}

export interface PreDemoChecklistItem {
  id: string;
  label: string;
  hint: string;
}

export interface HardStop {
  trigger: string;
  rule: string;
  /** Recovery phrase the founder can say verbatim. */
  recoveryLine: string;
}

export interface RecoveryPhrase {
  scenario: string;
  line: string;
}

export interface SafeDemoScript {
  schemaVersion: 1;
  /** Pre-demo prep, target time ~5 minutes. */
  preDemoChecklist: PreDemoChecklistItem[];
  /** Happy path the founder should drive on stage. */
  happyPath: DemoScriptStep[];
  /** Hard stops + canned recovery lines. */
  hardStops: HardStop[];
  /** Recovery phrases for unexpected boundaries. */
  recoveryPhrases: RecoveryPhrase[];
}

/* ------ Canonical script -------------------------------------------------------------------------------------------- */

export const SAFE_DEMO_SCRIPT: SafeDemoScript = {
  schemaVersion: 1,
  preDemoChecklist: [
    {
      id: "gate",
      label: "Run `npm run gate:phase1 -- --allow-known-drift`",
      hint:
        "Confirms tsc + targeted vitest + check-drift. Verdict should be " +
        "`pass` or `needs_polish`. If `fail` or `env_blocked`, do NOT demo.",
    },
    {
      id: "control-room",
      label: "Open `/dev/demo-control-room` and confirm 3 verdicts",
      hint:
        "Phase 1 gate, founder-e2e, smoke (extracted from gate). Each card " +
        "should be green or yellow. Red = stop and triage.",
    },
    {
      id: "smoke-included",
      label: "If smoke is missing, re-run gate with `--include-smoke`",
      hint:
        "Smoke isn't required for the gate to pass, but a fresh smoke " +
        "verdict is much better demo signal than absence.",
    },
    {
      id: "tabs",
      label:
        "Bookmark `/`, `/tasks?view=history`, `/dev/runtime-forensics` in tab order",
      hint:
        "If something stalls mid-demo, switch to `/dev/runtime-forensics` " +
        "to show the failure pre-classified instead of digging in console.",
    },
    {
      id: "phase2-status",
      label:
        "Re-read the Phase 2 panel: Expedia Flight is candidate, hotels need fresh artifacts",
      hint:
        "Locked phrasing: \"candidate, not live-verified\" for Expedia, " +
        "\"needs fresh artifacts before live promises\" for Booking.com + " +
        "Hotels.com. Do NOT promise these vert work live without that " +
        "phrasing or fresh evidence.",
    },
    {
      id: "audience",
      label: "Confirm audience boundary: no payment / OTP / CAPTCHA on stage",
      hint:
        "If the demo lands on a payment wall, OTP page, or CAPTCHA, you " +
        "tap your phone; the agent never bypasses. State this up front.",
    },
  ],
  happyPath: [
    {
      index: 1,
      title: "Open `/` and start a chat",
      body:
        "Show the homepage. Type a single travel intent in plain English " +
        "(\"Dinner Saturday 7pm at Bestia in LA, party of 2\"). The NLU " +
        "extracts a structured plan. Wait for the confirm card.",
      safety:
        "Use a public, low-stakes restaurant or trip. No real personal " +
        "data needed beyond a placeholder name + phone (`+10000000000`).",
    },
    {
      index: 2,
      title: "Confirm the plan card",
      body:
        "Click the confirm button on the chat card. The system creates a " +
        "task and routes to `/tasks/<id>`. Talk through the timeline view: " +
        "this is what the founder/operator sees during a real run.",
    },
    {
      index: 3,
      title: "Show task timeline + step shape",
      body:
        "Walk through 2-3 timeline events. Each has a `__source` marker " +
        "(`lib/core/execution`). If a step ever lands without one, it's a " +
        "P0 caught by `/dev/runtime-forensics`.",
    },
    {
      index: 4,
      title: "Demonstrate safe handoff",
      body:
        "Pause before any provider OTP / payment screen. Say: \"This is " +
        "the safe-handoff boundary. I'd tap my phone to enter the OTP, " +
        "or my card to confirm. The agent never bypasses these.\"",
      safety:
        "If a provider page demands OTP / login / CAPTCHA / final-confirm, " +
        "STOP. The hard-stops table covers what to say.",
    },
    {
      index: 5,
      title: "Open `/dev/demo-control-room` (optional)",
      body:
        "If the audience asks \"how do you know it's working?\", open the " +
        "control room and show: latest gate verdict, founder-e2e verdict, " +
        "smoke check, runtime forensics link, Phase 2 vertical status.",
    },
    {
      index: 6,
      title: "Open `/tasks?view=history` (optional)",
      body:
        "Show the history view: previous tasks with their status. " +
        "Demonstrates that the system remembers and that operators can " +
        "audit what happened.",
    },
  ],
  hardStops: [
    {
      trigger: "Provider asks for OTP / SMS code",
      rule:
        "Never type the OTP. The agent reaches a safe-handoff boundary; " +
        "the operator (founder) provides the code on their own phone.",
      recoveryLine:
        "\"That's the OTP wall; that's where I take over and tap my phone.\"",
    },
    {
      trigger: "Provider asks for CVV / payment / final confirm",
      rule:
        "The agent stops before payment fields. Operator manually fills " +
        "and clicks confirm.",
      recoveryLine:
        "\"And here's the payment boundary. I'd swipe my card; the agent " +
        "doesn't store or submit cards.\"",
    },
    {
      trigger: "CAPTCHA appears",
      rule:
        "Never bypass. Operator solves manually. If recurring, escalate " +
        "to warm-session strategy off-stage.",
      recoveryLine:
        "\"That's a CAPTCHA. I solve those; the agent doesn't bypass.\"",
    },
    {
      trigger: "Login wall on a fresh browser",
      rule:
        "If the provider opens a login wall, the agent stops. Operator " +
        "logs in manually before re-running the booking.",
      recoveryLine:
        "\"This provider wants me to log in. I'd do that off-camera, then " +
        "we'd re-run the agent against the warm session.\"",
    },
    {
      trigger: "Final booking / purchase button",
      rule:
        "The agent never clicks the irreversible action. Operator clicks.",
      recoveryLine:
        "\"This is the irreversible button. I click it, not the agent.\"",
    },
  ],
  recoveryPhrases: [
    {
      scenario: "Provider returns no availability",
      line:
        "\"Provider says no slots in our window; that's data, not a bug. " +
        "Let me adjust the time and re-run.\"",
    },
    {
      scenario: "Card / time disappears between scan and click",
      line:
        "\"That option just disappeared; the agent caught it and stopped " +
        "rather than booking the wrong thing.\"",
    },
    {
      scenario: "Form field selector drift",
      line:
        "\"The provider changed their form layout. The agent flagged it " +
        "and we'd open `/dev/runtime-forensics` to see exactly which " +
        "selector failed.\"",
    },
    {
      scenario: "Network 5xx",
      line:
        "\"That's a 5xx from the provider. I'd retry once or move to a " +
        "fallback. Not an agent bug.\"",
    },
    {
      scenario: "Computer Use / model rate limit",
      line:
        "\"We hit a model rate limit. I'd back off and re-run; the agent " +
        "doesn't burn tokens in a tight loop.\"",
    },
  ],
};

/* ------ Markdown export ---------------------------------------------------------------------------------------------- */

/**
 * Format the demo script as paste-ready markdown. Keep ASCII-only
 * (no emoji) so it travels well across Slack / printed handouts.
 */
export function formatDemoScriptMarkdown(
  script: SafeDemoScript = SAFE_DEMO_SCRIPT,
): string {
  const lines: string[] = [];
  lines.push("# Safe Demo Script");
  lines.push("");
  lines.push(
    "Pre-demo checklist + happy path + hard stops + recovery phrases. " +
      "Source: `/dev/demo-control-room`. Read-only; do not run live " +
      "providers from this script without explicit founder approval.",
  );
  lines.push("");

  lines.push("## Pre-demo (target 5 min)");
  lines.push("");
  for (const item of script.preDemoChecklist) {
    lines.push(`- **${item.label}**`);
    lines.push(`  - ${item.hint}`);
  }
  lines.push("");

  lines.push("## Happy path");
  lines.push("");
  for (const step of script.happyPath) {
    lines.push(`### ${step.index}. ${step.title}`);
    lines.push("");
    lines.push(step.body);
    if (step.safety) {
      lines.push("");
      lines.push(`> [SAFETY] ${step.safety}`);
    }
    lines.push("");
  }

  lines.push("## Hard stops");
  lines.push("");
  lines.push("| Trigger | Rule | Recovery line |");
  lines.push("|---|---|---|");
  for (const hs of script.hardStops) {
    lines.push(
      `| ${escapeTableCell(hs.trigger)} | ${escapeTableCell(hs.rule)} | ${escapeTableCell(hs.recoveryLine)} |`,
    );
  }
  lines.push("");

  lines.push("## Recovery phrases");
  lines.push("");
  for (const r of script.recoveryPhrases) {
    lines.push(`- **${r.scenario}**: ${r.line}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    "_This script is content, not a runner. The dashboard reads " +
      "filesystem artifacts only and never invokes a provider, OpenAI, " +
      "payment, or worker. See " +
      "`docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md` for the operator runbook._",
  );

  return lines.join("\n");
}

/** Escape a markdown table cell. Pipes break tables. */
function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/* ------ Convenience accessors ---------------------------------------------------------------------------------- */

export function listPreDemoChecklist(): PreDemoChecklistItem[] {
  return SAFE_DEMO_SCRIPT.preDemoChecklist.slice();
}

export function listHappyPathSteps(): DemoScriptStep[] {
  return SAFE_DEMO_SCRIPT.happyPath.slice();
}

export function listHardStops(): HardStop[] {
  return SAFE_DEMO_SCRIPT.hardStops.slice();
}

export function listRecoveryPhrases(): RecoveryPhrase[] {
  return SAFE_DEMO_SCRIPT.recoveryPhrases.slice();
}
