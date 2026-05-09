#!/usr/bin/env tsx
/**
 * Stage 0B Activity Provider Skill Lab — operator-driven runner template.
 *
 * THIS SCRIPT DOES NOT LAUNCH A BROWSER. It is a thin TypeScript helper
 * that:
 *
 *   1. Prints the 20-URL test plan with each entry's expected resolver
 *      classification (so the operator can sanity-check before any live
 *      run).
 *   2. Validates that every plan URL still classifies the way the plan
 *      author intended, by running the existing pure URL resolver
 *      (lib/capture/travel-link-resolver.ts) against each one.
 *   3. With `--dry-run` (default), prints what an operator would do
 *      with Browser Harness CLI and exits.
 *   4. With `--check`, also computes a non-zero exit code if any plan
 *      entry's expected resolver outputs do not match what the resolver
 *      currently produces.
 *
 * The script INTENTIONALLY does not import the Browser Harness package,
 * does not spawn a browser, and does not make network requests. Those
 * happen in an external dev-mode harness invocation the operator runs by
 * hand, against the URLs this script lists.
 *
 * Usage:
 *   npx tsx scripts/stage0b-activity-skill-lab.ts --dry-run
 *   npx tsx scripts/stage0b-activity-skill-lab.ts --check
 *   npx tsx scripts/stage0b-activity-skill-lab.ts --provider seatgeek --check
 */

import {
  STAGE0B_TEST_PLAN,
  STAGE0B_PLAN_COUNTS,
  TICKETMASTER_SKILL_FORGE_PLAN,
  STUBHUB_SKILL_FORGE_PLAN,
  type LabTestPlanEntry,
  type Stage0bLabPlanName,
  type Stage0bLabProvider,
} from "@/lib/stage0b-skill-runtime";
import { resolveActivityProviderSkillUrl } from "@/lib/activity-skills";

interface LabRunnerArgs {
  dryRun: boolean;
  check: boolean;
  providerFilter?: Stage0bLabProvider;
  plan: Stage0bLabPlanName;
}

function parseArgs(argv: ReadonlyArray<string>): LabRunnerArgs {
  const args: LabRunnerArgs = {
    dryRun: argv.includes("--dry-run") || (!argv.includes("--check") && !argv.includes("--print-plan")),
    check: argv.includes("--check"),
    plan: "stage0b",
  };
  const planIdx = argv.indexOf("--plan");
  if (planIdx >= 0 && argv[planIdx + 1]) {
    const value = argv[planIdx + 1];
    if (value === "stage0b" || value === "ticketmaster-forge" || value === "stubhub-forge") {
      args.plan = value;
    } else {
      throw new Error(`Unknown --plan value: ${value}`);
    }
  }
  const providerIdx = argv.indexOf("--provider");
  if (providerIdx >= 0 && argv[providerIdx + 1]) {
    const value = argv[providerIdx + 1];
    if (value === "ticketmaster" || value === "seatgeek" || value === "stubhub") {
      args.providerFilter = value;
    } else {
      throw new Error(`Unknown --provider value: ${value}`);
    }
  }
  return args;
}

function formatPlanEntry(entry: LabTestPlanEntry): string {
  return [
    `  [${entry.id}] ${entry.provider}/${entry.intended_class}`,
    `    URL: ${entry.url}`,
    `    expected_page_type=${entry.expected_resolver_page_type}`,
    `    expected_execution_mode=${entry.expected_resolver_execution_mode}`,
    `    reason: ${entry.reason}`,
  ].join("\n");
}

interface PreflightResult {
  entry: LabTestPlanEntry;
  ok: boolean;
  notes: string[];
}

/**
 * Validate a plan entry's URL against the existing pure activity skill resolver.
 * NO network. NO browser. Pure function call.
 */
function preflight(entry: LabTestPlanEntry): PreflightResult {
  const notes: string[] = [];
  const resolved = resolveActivityProviderSkillUrl(entry.url);
  if (!resolved) {
    notes.push("resolver returned null — URL is malformed or unreachable to the resolver");
    return { entry, ok: false, notes };
  }
  if (resolved.provider !== entry.provider) {
    notes.push(`expected provider=${entry.provider} got ${resolved.provider}`);
  }
  if (resolved.pageType !== entry.expected_resolver_page_type) {
    notes.push(
      `expected page_type=${entry.expected_resolver_page_type} got ${resolved.pageType}`,
    );
  }
  if (resolved.executionMode !== entry.expected_resolver_execution_mode) {
    notes.push(
      `expected execution_mode=${entry.expected_resolver_execution_mode} got ${resolved.executionMode}`,
    );
  }
  return { entry, ok: notes.length === 0, notes };
}

function printDryRunInstructions(args: LabRunnerArgs): void {
  console.log("Stage 0B Activity Skill Lab — DRY RUN");
  console.log("");
  console.log("This script does not launch a browser. To execute the lab:");
  console.log("");
  console.log("  1. Confirm Browser Harness CLI is installed OUTSIDE this repo.");
  console.log("     (Onegent does not vendor Browser Harness.)");
  console.log("  2. Confirm you are using a fresh anonymous browser profile.");
  console.log("     No production cookies, no Onegent OAuth, no user PII.");
  console.log("  3. Confirm the .stage0b-evidence/ directory exists and is gitignored.");
  console.log("  4. For each test-plan URL below, invoke Browser Harness with:");
  console.log("       browser-harness run --url <URL> \\");
  console.log("         --evidence-dir .stage0b-evidence/<run_id>/ \\");
  console.log("         --hard-stops onegent-stage0b.yaml \\");
  console.log("         --no-login --no-payment --no-final-confirm");
  console.log("  5. The harness wrapper emits LabEvent JSONL to events.jsonl");
  console.log("     and result.json (L2RecoveryResult) to the same directory.");
  console.log("");
  console.log("Hard stops the wrapper MUST enforce (see STAGE0B_TM_SEATGEEK_LAB.md § 2):");
  console.log("  login_or_signin_wall · captcha_or_challenge · otp_or_phone_verification");
  console.log("  seat_selection_required · payment_form_visible · final_confirm_button");
  console.log("  cookie_consent_blocking_render · harness_error_or_disconnect");
  console.log("");
  console.log("=== Plan ===");
  console.log("");
  const entries = filterPlan(args);
  for (const entry of entries) {
    console.log(formatPlanEntry(entry));
    console.log("");
  }
}

function filterPlan(args: Pick<LabRunnerArgs, "providerFilter" | "plan">): LabTestPlanEntry[] {
  const base = args.plan === "ticketmaster-forge"
    ? TICKETMASTER_SKILL_FORGE_PLAN
    : args.plan === "stubhub-forge"
      ? STUBHUB_SKILL_FORGE_PLAN
      : STAGE0B_TEST_PLAN;
  return args.providerFilter
    ? base.filter((e) => e.provider === args.providerFilter)
    : [...base];
}

function printCheckResult(results: ReadonlyArray<PreflightResult>): boolean {
  const failures = results.filter((r) => !r.ok);
  console.log("Stage 0B Activity Skill Lab — PRE-FLIGHT CHECK");
  console.log("");
  console.log(`Baseline plan size: ${STAGE0B_PLAN_COUNTS.total} (TM=${STAGE0B_PLAN_COUNTS.ticketmaster}, SG=${STAGE0B_PLAN_COUNTS.seatgeek})`);
  console.log(`Checked: ${results.length}`);
  console.log(`Pass: ${results.length - failures.length}`);
  console.log(`Fail: ${failures.length}`);
  console.log("");
  for (const r of results) {
    const tag = r.ok ? "OK  " : "FAIL";
    console.log(`  [${tag}] ${r.entry.id} ${r.entry.provider}/${r.entry.intended_class}`);
    for (const note of r.notes) {
      console.log(`         - ${note}`);
    }
  }
  console.log("");
  return failures.length === 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Operator-facing safety banner. The script is read-only.
  console.log("============================================================");
  console.log("Stage 0B lab runner — DOES NOT launch a browser.");
  console.log("Browser Harness invocation is operator-driven, out of repo.");
  console.log("Read docs/30-provider-debug/STAGE0B_TM_SEATGEEK_LAB.md first.");
  console.log("============================================================");
  console.log("");

  if (args.dryRun) {
    printDryRunInstructions(args);
  }

  if (args.check) {
    const entries = filterPlan(args);
    const results = entries.map(preflight);
    const ok = printCheckResult(results);
    if (!ok) {
      process.exitCode = 1;
    }
  }
}

void main();
