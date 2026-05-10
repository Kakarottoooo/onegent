/**
 * Recommended-next-evidence engine.
 *
 * For a classified ForensicsReport, returns:
 *   - a static base checklist per failure class (what to inspect next)
 *   - static pointers (file/doc/screenshot/db refs)
 *   - dynamically generated worker-log search commands derived from
 *     the top matched signals
 *   - a V1 caveat reminder (the dashboard is a triage helper, not the
 *     source of truth)
 *
 * Sanitization rules for signal-derived shell commands:
 *   - strip control chars (codes < 0x20 except space)
 *   - strip shell metacharacters: ` $ ( ) ; & | > < \n \r \t " backslash
 *   - reduce runs of whitespace to a single space
 *   - cap at `signalMaxLen` characters (default 80)
 *   - escape PowerShell single-quote literal (`'` becomes `''`)
 *
 * Pure module — does not touch the filesystem at evaluation time.
 * Callers pass the worker-log path as an option so the loader's lazy
 * resolver stays the single source of truth.
 */

import {
  type FailureClass,
  type ForensicsReport,
  type ForensicsSeverity,
} from "./types";

/* ─── Public types ────────────────────────────────────────────────── */

export interface Pointer {
  /** Display label, e.g. "M5 force-gate". */
  label: string;
  /** File path (`file:line` form), doc path (`docs/...`), screenshot
   *  rel path, or DB pointer (`booking_jobs.steps[0].body.__source`). */
  ref: string;
  /** Hint for icon / styling; matches the V1 caveat groups. */
  kind: "file" | "doc" | "screenshot" | "db";
}

export interface SearchCommand {
  /** What this command surfaces if it returns hits. */
  description: string;
  /** Shell flavour the command targets. V1 is PowerShell only. */
  shell: "powershell";
  /** The full ready-to-paste command line. */
  command: string;
}

export interface Recommendation {
  primaryClass: FailureClass;
  severity: ForensicsSeverity;
  /**
   * Ordered checklist of human steps to investigate next. Static per
   * class — does not depend on which signals matched.
   */
  baseChecklist: string[];
  /**
   * Static pointers (file/doc/screenshot/db). Depend on class +
   * provider but not on matched signals.
   */
  pointers: Pointer[];
  /**
   * Generated search commands. The first command is always a `jobId`
   * / `scenario` pivot; the rest are derived from top matched signals
   * (sanitized).
   */
  searchCommands: SearchCommand[];
  /**
   * V1 caveat block — copied verbatim into markdown output. Reminds
   * the operator the workbench is a triage helper, NOT the source of
   * truth.
   */
  caveat: string;
}

export interface RecommendOptions {
  /**
   * Absolute worker-log path. The recommendation embeds this verbatim
   * into the search commands. Default
   * `C:\\Users\\Gzw19\\onegent-e2e-20260503\\codex-worker.log` (codex's
   * convention) — callers should pass `getWorkerLogPath()` from the
   * loader for env-correct behaviour.
   */
  workerLogPath?: string;
  /** Cap on signal text inserted into shell commands. Default 80. */
  signalMaxLen?: number;
}

/* ─── Constants ───────────────────────────────────────────────────── */

const DEFAULT_SIGNAL_MAX_LEN = 80;
const DEFAULT_WORKER_LOG_PATH =
  "C:\\Users\\Gzw19\\onegent-e2e-20260503\\codex-worker.log";

const V1_CAVEAT =
  "V1 is artifact-based: this dashboard is a TRIAGE HELPER, not the " +
  "source of truth. Source of truth is still the DB + worker log + " +
  "screenshots. Confirm against `booking_jobs` rows, " +
  "`codex-worker.log`, and `worker/.debug-screenshots/<provider>/<run>/` " +
  "before filing or fixing. DB live lookup is a future enhancement " +
  "(codex domain). See " +
  "`docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.";

/* ─── Per-class static catalog ────────────────────────────────────── */

const STATIC_CATALOG: Record<
  FailureClass,
  { checklist: string[]; pointers: Pointer[] }
> = {
  legacy_shape_missing_source: {
    checklist: [
      "Confirm the M5 force-gate at " +
        "`app/api/booking-jobs/[id]/start/route.ts` ran for this scenario " +
        "and stamped `__source` on every step's body. If status was 202 " +
        "but worker rejected, the gate logic missed.",
      "Check `booking_jobs.steps[0].body.__source` in the DB; if absent, " +
        "either the gate skipped this scenario or the row was inserted " +
        "directly without going through `/start`.",
      "Read `lib/core/execution/executor.ts` to see where `__source` is " +
        "assigned. Do NOT modify executor code from Track B.",
      "Search the worker log for the legacy-shape rejection line and " +
        "trace upstream — every push of an unstamped step is a bug.",
      "If a new scenario was added recently, verify the gate's " +
        "`USE_WORKER_FOR` allowlist includes it.",
    ],
    pointers: [
      {
        label: "M5 force-gate",
        ref: "app/api/booking-jobs/[id]/start/route.ts",
        kind: "file",
      },
      {
        label: "Executor (Track A)",
        ref: "lib/core/execution/executor.ts",
        kind: "file",
      },
      {
        label: "Step __source field",
        ref: "booking_jobs.steps[0].body.__source",
        kind: "db",
      },
      {
        label: "Provider runtime playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
    ],
  },
  provider_no_availability: {
    checklist: [
      "This is usually NOT a code bug — the provider had no slots in " +
        "the requested window.",
      "Cross-reference the latest probe report " +
        "(`benchmark/runs/resy-availability-probe-*.json`) to confirm the " +
        "absence is real.",
      "If a retry would change the answer, do it through the probe " +
        "runbook, not by re-running a live booking job.",
      "Do NOT burn tokens on a live retry without a fresh probe.",
      "If the user's window is unrealistic, surface that back via the " +
        "task UI rather than treating as a runtime failure.",
    ],
    pointers: [
      {
        label: "Resy probe runbook",
        ref: "docs/90-archive/phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md",
        kind: "doc",
      },
      {
        label: "Live smoke runbook",
        ref: "docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
        kind: "doc",
      },
    ],
  },
  provider_form_incomplete: {
    checklist: [
      "Open the latest debug screenshot for this provider/run and " +
        "check WHICH form field stayed empty.",
      "Inspect the provider's selector definitions in " +
        "`lib/booking-autopilot/providers/<provider>.ts` (Track A) — " +
        "selectors drift when providers re-skin their forms.",
      "Look for `auditAndRefill gave up` lines in the worker log to " +
        "see how many retry passes happened.",
      "Compare the form's HTML against what the provider snapshot " +
        "test expects (Track A).",
      "If selector drift, file the bug under Track A; do NOT modify " +
        "provider code from Track B.",
    ],
    pointers: [
      {
        label: "Debug screenshots dir",
        ref: "worker/.debug-screenshots/<provider>/<run>/",
        kind: "screenshot",
      },
      {
        label: "Provider runtime playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
    ],
  },
  otp_or_login_required: {
    checklist: [
      "Expected boundary — provider auth wall reached. NOT a runtime bug.",
      "Operator action required: paste OTP into the open browser " +
        "session within the warm-session window.",
      "Do NOT retry the job from scratch — that re-triggers OTP " +
        "and burns the new code immediately.",
      "If this is happening more than once per session, consider " +
        "warm-session strategy or the Gmail OTP receiver per " +
        "`docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md`.",
    ],
    pointers: [
      {
        label: "Warm session strategy",
        ref: "docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md",
        kind: "doc",
      },
      {
        label: "Resy live debug playbook",
        ref: "docs/90-archive/phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
    ],
  },
  checkout_reached_manual_review: {
    checklist: [
      "SUCCESS boundary — automation reached the safe handoff.",
      "Operator must manually click the final confirm/pay button.",
      "Verify the auto-filled fields (name, email, phone, traveler " +
        "details) before submitting.",
      "After confirm, capture the provider confirmation number into " +
        "the task UI.",
      "Do NOT auto-confirm from the workbench under any circumstance.",
    ],
    pointers: [
      {
        label: "Provider runtime playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
    ],
  },
  model_or_env_blocked: {
    checklist: [
      "Likely environment issue — OpenAI quota/rate-limit, missing " +
        "env var, or chromium not installed.",
      "Check `.env.local` for the relevant key (OPENAI_API_KEY, " +
        "BROWSERBASE_*).",
      "If 429: rotate or wait; do NOT retry tight loop.",
      "If chromium missing: `npx playwright install` once, then " +
        "re-run a single canary scenario before broad re-run.",
      "Token-guard / `--confirm-suite` gates are intentional — DON'T " +
        "bypass without explicit founder approval.",
    ],
    pointers: [
      {
        label: "Phase 1 quality gate",
        ref: "docs/90-archive/phase1-demo/PHASE_1_QUALITY_GATE.md",
        kind: "doc",
      },
    ],
  },
  network_or_provider_5xx: {
    checklist: [
      "Provider site may be partially down — try its public status " +
        "page first.",
      "Test the same URL from mobile data vs desktop Wi-Fi to rule " +
        "out local network issues.",
      "If transient, allow 1-2 backoff retries before raising a bug.",
      "If persistent across networks, raise with provider support and " +
        "consider documenting in the runbook.",
      "Do NOT auto-retry from the workbench; manual decision on retry.",
    ],
    pointers: [
      {
        label: "Provider runtime playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
    ],
  },
  unknown: {
    checklist: [
      "Classifier matched NO known signals — needs human triage.",
      "Re-read the full worker log around this jobId; look for " +
        "novel error phrases.",
      "Look at the debug screenshots dir for visual evidence.",
      "If a new failure mode is discovered, propose a regex rule " +
        "addition to `lib/runtime-forensics/classifier.ts` (Track B).",
      "File a coord ticket BEFORE silently classifying as one of " +
        "the existing classes.",
    ],
    pointers: [
      {
        label: "Provider runtime playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "doc",
      },
      {
        label: "Forensics classifier (Track B)",
        ref: "lib/runtime-forensics/classifier.ts",
        kind: "file",
      },
    ],
  },
};

/* ─── Public API ──────────────────────────────────────────────────── */

/**
 * Build a Recommendation for a forensics report. Pure.
 *
 * Combines the static per-class catalog with dynamically generated
 * search commands derived from the report's top signals + jobId /
 * scenario / provider pivots.
 */
export function recommendNextEvidence(
  report: ForensicsReport,
  options: RecommendOptions = {},
): Recommendation {
  const cls = report.classification.primaryClass;
  const severity = report.classification.severity;
  const catalog = STATIC_CATALOG[cls];

  const workerLogPath = stringOr(options.workerLogPath, DEFAULT_WORKER_LOG_PATH);
  const signalMaxLen = clampInt(
    typeof options.signalMaxLen === "number" ? options.signalMaxLen : DEFAULT_SIGNAL_MAX_LEN,
    16,
    256,
  );

  const searchCommands = buildSearchCommands(report, {
    workerLogPath,
    signalMaxLen,
  });

  return {
    primaryClass: cls,
    severity,
    baseChecklist: catalog.checklist,
    pointers: catalog.pointers,
    searchCommands,
    caveat: V1_CAVEAT,
  };
}

/* ─── Search command builder ──────────────────────────────────────── */

interface SearchCommandOpts {
  workerLogPath: string;
  signalMaxLen: number;
}

function buildSearchCommands(
  report: ForensicsReport,
  opts: SearchCommandOpts,
): SearchCommand[] {
  const cmds: SearchCommand[] = [];

  // Pivot 1: jobId search (most specific).
  const pivot = report.jobId ?? report.taskId ?? null;
  if (pivot) {
    cmds.push(buildPwshCommand(opts.workerLogPath, pivot, opts.signalMaxLen, {
      description: `Tail worker log for jobId/taskId pivot "${truncateForLabel(pivot, 32)}"`,
    }));
  }

  // Pivot 2: scenario, if distinct from pivot.
  if (report.scenario && report.scenario !== "unknown" && report.scenario !== pivot) {
    cmds.push(buildPwshCommand(opts.workerLogPath, report.scenario, opts.signalMaxLen, {
      description: `Tail worker log for scenario "${truncateForLabel(report.scenario, 32)}"`,
    }));
  }

  // Top up to 2 signal-derived commands.
  const topSignals = report.classification.signals.slice(0, 2);
  for (const sig of topSignals) {
    const seed = sig.excerpt && sig.excerpt.length >= 6 ? sig.excerpt : sig.label;
    if (!seed) continue;
    cmds.push(
      buildPwshCommand(opts.workerLogPath, seed, opts.signalMaxLen, {
        description: `Match signal: ${truncateForLabel(sig.label, 50)}`,
      }),
    );
  }

  return dedupeCommands(cmds);
}

interface PwshOpts {
  description: string;
}

function buildPwshCommand(
  workerLogPath: string,
  rawSeed: string,
  signalMaxLen: number,
  pwshOpts: PwshOpts,
): SearchCommand {
  const sanitizedPattern = sanitizeForShell(rawSeed, signalMaxLen);
  const pathLiteral = pwshSingleQuote(workerLogPath);
  const patternLiteral = pwshSingleQuote(sanitizedPattern);
  const command =
    `Select-String -Path ${pathLiteral} ` +
    `-Pattern ${patternLiteral} ` +
    `-Context 2,3 | Select-Object -Last 40`;
  return {
    description: pwshOpts.description,
    shell: "powershell",
    command,
  };
}

/* ─── Sanitization ────────────────────────────────────────────────── */

/**
 * Sanitize a candidate signal string before embedding it into a shell
 * command. Strips control characters, shell metacharacters, and caps
 * the length. Returns at least an empty string (never throws).
 */
export function sanitizeForShell(raw: string, maxLen: number): string {
  if (typeof raw !== "string") return "";
  let s = raw;
  // 1. Strip control chars (keep simple space).
  s = s.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, " ");
  // 2. Strip shell metacharacters that could break out of single
  //    quotes if the quoting later fails.
  s = s.replace(/[`$();&|<>\\\"\t\r\n]/g, " ");
  // 3. Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  // 4. Cap.
  const cap = Math.max(8, Math.min(256, maxLen));
  if (s.length > cap) {
    s = s.slice(0, cap).trimEnd();
  }
  return s;
}

/**
 * Wrap a string in PowerShell single-quotes. PowerShell single-quote
 * literals do not interpolate; the only escape needed is `'` -> `''`.
 */
export function pwshSingleQuote(s: string): string {
  const escaped = s.replace(/'/g, "''");
  return `'${escaped}'`;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function stringOr(v: string | undefined | null, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function truncateForLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return s.slice(0, max - 3) + "...";
}

function dedupeCommands(cmds: SearchCommand[]): SearchCommand[] {
  const seen = new Set<string>();
  const out: SearchCommand[] = [];
  for (const c of cmds) {
    if (seen.has(c.command)) continue;
    seen.add(c.command);
    out.push(c);
  }
  return out;
}
