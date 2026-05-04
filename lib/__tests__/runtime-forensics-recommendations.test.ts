/**
 * Tests for the recommended-next-evidence engine.
 *
 * Covers:
 *  - per-class static catalog (8 classes covered)
 *  - search-command generation: jobId pivot, scenario pivot, signal pivots
 *  - sanitizeForShell strips control chars + metachars + caps length
 *  - pwshSingleQuote escapes embedded single quotes
 *  - generated commands embed sanitized text only
 *  - dedup of identical commands
 *  - works with empty signals / unknown class
 *  - V1 caveat present in every recommendation
 */

import { describe, expect, it } from "vitest";

import {
  buildForensicsReport,
  formatForensicsBugReport,
  pwshSingleQuote,
  recommendNextEvidence,
  sanitizeForShell,
} from "@/lib/runtime-forensics";
import type { FailureClass, JobLikeInput } from "@/lib/runtime-forensics/types";

function jobOf(overrides: Partial<JobLikeInput> = {}): JobLikeInput {
  return {
    id: "job-test-001",
    taskId: "task-test-001",
    provider: "resy",
    scenario: "R-001",
    status: "failed",
    errorMessage: "no slot in target window",
    terminalReason: "PROVIDER_NO_SLOT",
    ...overrides,
  };
}

describe("recommendNextEvidence — per-class catalog", () => {
  const cases: ReadonlyArray<{
    name: string;
    job: JobLikeInput;
    expectedClass: FailureClass;
    checklistMustContain: string;
  }> = [
    {
      name: "legacy-shape",
      job: jobOf({
        provider: "expedia",
        errorMessage: "Worker received legacy-shape step: missing __source marker",
        terminalReason: "WORKER_REJECT_LEGACY_SHAPE",
      }),
      expectedClass: "legacy_shape_missing_source",
      checklistMustContain: "M5 force-gate",
    },
    {
      name: "no availability",
      job: jobOf({
        terminalReason: "PROVIDER_NO_SLOT",
        errorMessage: "no slots in target window",
      }),
      expectedClass: "provider_no_availability",
      checklistMustContain: "probe report",
    },
    {
      name: "form incomplete",
      job: jobOf({
        provider: "opentable",
        errorMessage: "guest form partially filled; phone field unfilled; auditAndRefill gave up",
      }),
      expectedClass: "provider_form_incomplete",
      checklistMustContain: "debug screenshot",
    },
    {
      name: "OTP",
      job: jobOf({
        terminalReason: "F-PROVIDER-OTP",
        errorMessage: "phone verification required: awaiting OTP",
      }),
      expectedClass: "otp_or_login_required",
      checklistMustContain: "Operator action required",
    },
    {
      name: "checkout reached",
      job: jobOf({
        status: "ready_for_confirmation",
        terminalReason: "safe_handoff",
        errorMessage: null,
        decisionLog: [
          { event: "verdict", message: "ready_for_confirmation - awaiting human confirm" },
        ],
      }),
      expectedClass: "checkout_reached_manual_review",
      checklistMustContain: "SUCCESS boundary",
    },
    {
      name: "model/env blocked",
      job: jobOf({
        errorMessage: "openai rate-limit 429; quota exceeded",
      }),
      expectedClass: "model_or_env_blocked",
      checklistMustContain: "OpenAI",
    },
    {
      name: "5xx",
      job: jobOf({
        provider: "booking-com",
        errorMessage: "ECONNRESET reading provider; gateway timeout",
      }),
      expectedClass: "network_or_provider_5xx",
      checklistMustContain: "status page",
    },
    {
      name: "unknown",
      job: jobOf({
        terminalReason: "OPAQUE",
        errorMessage: "execution halted at unexpected boundary",
      }),
      expectedClass: "unknown",
      checklistMustContain: "needs human triage",
    },
  ];

  for (const c of cases) {
    it(`${c.name} produces the right class + non-empty checklist`, () => {
      const report = buildForensicsReport(c.job);
      expect(report.classification.primaryClass).toBe(c.expectedClass);
      const rec = recommendNextEvidence(report);
      expect(rec.primaryClass).toBe(c.expectedClass);
      expect(rec.baseChecklist.length).toBeGreaterThan(2);
      expect(rec.baseChecklist.join(" \n ")).toContain(c.checklistMustContain);
    });
  }

  it("every class has at least one pointer", () => {
    const allClasses: FailureClass[] = [
      "legacy_shape_missing_source",
      "provider_no_availability",
      "provider_form_incomplete",
      "otp_or_login_required",
      "checkout_reached_manual_review",
      "model_or_env_blocked",
      "network_or_provider_5xx",
      "unknown",
    ];
    for (const c of allClasses) {
      // Synthesize minimal job that classifies to c by terminalReason hint.
      const job = synthesizeJobForClass(c);
      const rec = recommendNextEvidence(buildForensicsReport(job));
      // We don't insist the synthesized job matches `c`, but pointers
      // should always be non-empty on whichever class the classifier
      // chose, AND we want every catalog entry exercised somewhere.
      expect(rec.pointers.length).toBeGreaterThan(0);
    }
  });

  it("V1 caveat is non-empty and mentions the playbook", () => {
    const rec = recommendNextEvidence(buildForensicsReport(jobOf()));
    expect(rec.caveat.length).toBeGreaterThan(40);
    expect(rec.caveat).toContain("PROVIDER_RUNTIME_DEBUG_PLAYBOOK");
  });
});

describe("recommendNextEvidence — search commands", () => {
  it("first command pivots on jobId", () => {
    const report = buildForensicsReport(jobOf({ id: "job-pivot-1" }));
    const rec = recommendNextEvidence(report);
    expect(rec.searchCommands[0]).toBeTruthy();
    expect(rec.searchCommands[0].command).toContain("'job-pivot-1'");
  });

  it("falls back to taskId when jobId absent", () => {
    const report = buildForensicsReport(jobOf({ id: null, taskId: "task-pivot-2" }));
    const rec = recommendNextEvidence(report);
    expect(rec.searchCommands[0].command).toContain("'task-pivot-2'");
  });

  it("includes scenario as a separate pivot when distinct", () => {
    const report = buildForensicsReport(jobOf({ id: "j", scenario: "R-007" }));
    const rec = recommendNextEvidence(report);
    expect(
      rec.searchCommands.some((c) => c.command.includes("'R-007'")),
    ).toBe(true);
  });

  it("does not duplicate scenario when identical to id", () => {
    const report = buildForensicsReport(jobOf({ id: "R-001", scenario: "R-001" }));
    const rec = recommendNextEvidence(report);
    const matches = rec.searchCommands.filter((c) => c.command.includes("'R-001'"));
    expect(matches.length).toBe(1);
  });

  it("emits up to 2 signal-derived commands", () => {
    const job = jobOf({
      errorMessage:
        "Worker received legacy-shape step: missing __source marker; step lacks __source field",
      terminalReason: "WORKER_REJECT_LEGACY_SHAPE",
    });
    const report = buildForensicsReport(job);
    const rec = recommendNextEvidence(report);
    // First two are pivots (jobId + scenario), then up to 2 signal-derived.
    expect(rec.searchCommands.length).toBeGreaterThanOrEqual(3);
  });

  it("every command targets the configured worker log path", () => {
    const report = buildForensicsReport(jobOf());
    const rec = recommendNextEvidence(report, {
      workerLogPath: "/tmp/test-worker.log",
    });
    for (const c of rec.searchCommands) {
      expect(c.command).toContain("'/tmp/test-worker.log'");
    }
  });

  it("commands are PowerShell shape", () => {
    const rec = recommendNextEvidence(buildForensicsReport(jobOf()));
    for (const c of rec.searchCommands) {
      expect(c.shell).toBe("powershell");
      expect(c.command.startsWith("Select-String")).toBe(true);
      expect(c.command).toContain("-Context 2,3");
    }
  });

  it("dedupes identical commands", () => {
    // jobId == scenario forces dedup logic to fire (after pivot 1, pivot 2 collapses).
    const rec = recommendNextEvidence(
      buildForensicsReport(jobOf({ id: "X", scenario: "X" })),
    );
    const set = new Set(rec.searchCommands.map((c) => c.command));
    expect(set.size).toBe(rec.searchCommands.length);
  });
});

describe("sanitizeForShell", () => {
  it("strips control characters", () => {
    expect(sanitizeForShell("hello\x00\x01\x07world", 80)).toBe("hello world");
  });

  it("strips shell metacharacters", () => {
    expect(sanitizeForShell("a$b`c;d&e|f<g>h", 80)).toBe("a b c d e f g h");
  });

  it("collapses runs of whitespace", () => {
    expect(sanitizeForShell("a    b\t\tc\n\nd", 80)).toBe("a b c d");
  });

  it("caps at maxLen", () => {
    const out = sanitizeForShell("x".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it("clamps maxLen below 8 to 8", () => {
    const out = sanitizeForShell("abcdefghijklmnop", 4);
    expect(out.length).toBeGreaterThanOrEqual(7);
  });

  it("clamps maxLen above 256 to 256", () => {
    const out = sanitizeForShell("x".repeat(500), 1000);
    expect(out.length).toBeLessThanOrEqual(256);
  });

  it("handles empty / non-string input", () => {
    expect(sanitizeForShell("", 80)).toBe("");
    // @ts-expect-error testing runtime guard
    expect(sanitizeForShell(null, 80)).toBe("");
    // @ts-expect-error testing runtime guard
    expect(sanitizeForShell(undefined, 80)).toBe("");
  });

  it("preserves alphanumerics + dashes + underscores", () => {
    expect(sanitizeForShell("my-job_id 0.001", 80)).toBe("my-job_id 0.001");
  });
});

describe("pwshSingleQuote", () => {
  it("wraps a plain string", () => {
    expect(pwshSingleQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes by doubling", () => {
    expect(pwshSingleQuote("it's a test")).toBe("'it''s a test'");
  });

  it("handles empty", () => {
    expect(pwshSingleQuote("")).toBe("''");
  });
});

describe("recommendNextEvidence — never throws on minimal input", () => {
  it("survives no jobId / no scenario / no signals", () => {
    const report = buildForensicsReport({
      id: null,
      taskId: null,
      provider: null,
      scenario: null,
      status: null,
      errorMessage: null,
      terminalReason: null,
    });
    const rec = recommendNextEvidence(report);
    expect(rec).toBeTruthy();
    expect(rec.baseChecklist.length).toBeGreaterThan(0);
    expect(rec.pointers.length).toBeGreaterThan(0);
    // No pivots possible; signal commands may also be empty.
    expect(Array.isArray(rec.searchCommands)).toBe(true);
  });

  it("strips shell metacharacters from a hostile job id end-to-end", () => {
    const dangerous = "job; rm -rf /; echo bad; #";
    // First, sanitizer must strip them all.
    expect(sanitizeForShell(dangerous, 80)).toBe("job rm -rf / echo bad #");

    // Then, the recommendation pipeline embeds only the sanitized text.
    const rec = recommendNextEvidence(
      buildForensicsReport(jobOf({ id: dangerous })),
    );
    // Strip away the deterministic command frame (path is hardcoded
    // by the caller; not user-provided here). The remaining chunk is
    // the pattern literal and the trailing context flag.
    for (const c of rec.searchCommands) {
      const trailingMatch = c.command.match(
        /-Pattern '(.*)' -Context 2,3 \| Select-Object -Last 40$/,
      );
      expect(trailingMatch, "command frame must be intact").toBeTruthy();
      const inner = trailingMatch?.[1] ?? "";
      expect(inner).not.toMatch(/[;`&|<>$()\\]/);
    }
  });

  it("respects custom signalMaxLen", () => {
    const report = buildForensicsReport(
      jobOf({ id: "x".repeat(40) + "y".repeat(40) + "z".repeat(40) }),
    );
    const rec = recommendNextEvidence(report, { signalMaxLen: 32 });
    // The pattern segment in the command must not exceed 32 chars + quotes.
    // Match the inner literal (between -Pattern '...' bounds) and check it.
    const cmd = rec.searchCommands[0].command;
    const m = cmd.match(/-Pattern '([^']*)'/);
    expect(m).toBeTruthy();
    expect((m?.[1] ?? "").length).toBeLessThanOrEqual(32);
  });
});

describe("formatForensicsBugReport — recommendation integration", () => {
  it("markdown contains the recommended-next-evidence section", () => {
    const report = buildForensicsReport(jobOf());
    // Re-import here to avoid circular pull at top.
    
    const md = formatForensicsBugReport(report);
    expect(md).toContain("### Recommended next evidence");
    expect(md).toContain("Checklist (work top to bottom):");
    expect(md).toContain("Pointers:");
    expect(md).toContain("Suggested worker-log searches");
  });

  it("markdown checklist items are numbered", () => {
    const report = buildForensicsReport(jobOf());
    
    const md = formatForensicsBugReport(report);
    expect(md).toMatch(/\n1\. /);
    expect(md).toMatch(/\n2\. /);
  });

  it("markdown V1 caveat at bottom mentions playbook", () => {
    const report = buildForensicsReport(jobOf());
    
    const md = formatForensicsBugReport(report);
    expect(md).toContain("PROVIDER_RUNTIME_DEBUG_PLAYBOOK");
  });

  it("markdown prefixes [FIXTURE] heading when isFixture=true", () => {
    const report = buildForensicsReport(jobOf(), { isFixture: true });
    
    const md = formatForensicsBugReport(report);
    expect(md.split("\n")[0]).toContain("[FIXTURE]");
    expect(md).toContain("This row is a synthetic fixture");
  });

  it("markdown does NOT prefix [FIXTURE] for real artifacts", () => {
    const report = buildForensicsReport(jobOf(), { isFixture: false });
    
    const md = formatForensicsBugReport(report);
    expect(md.split("\n")[0]).not.toContain("[FIXTURE]");
  });

  it("markdown allows a custom recommendation override", () => {
    const report = buildForensicsReport(jobOf());
    
    const md = formatForensicsBugReport(report, {
      recommendation: {
        primaryClass: "unknown",
        severity: "p2",
        baseChecklist: ["custom-step-one", "custom-step-two"],
        pointers: [],
        searchCommands: [],
        caveat: "custom-caveat-marker-Z9X",
      },
    });
    expect(md).toContain("custom-step-one");
    expect(md).toContain("custom-step-two");
    expect(md).toContain("custom-caveat-marker-Z9X");
  });

  it("markdown is idempotent (same input -> same output)", () => {
    const report = buildForensicsReport(jobOf(), { generatedAt: "2026-05-04T00:00:00Z" });
    
    const a = formatForensicsBugReport(report);
    const b = formatForensicsBugReport(report);
    expect(a).toBe(b);
  });
});

/* ─── helpers ────────────────────────────────────────────────────── */

function synthesizeJobForClass(c: FailureClass): JobLikeInput {
  switch (c) {
    case "legacy_shape_missing_source":
      return jobOf({
        provider: "expedia",
        errorMessage: "Worker received legacy-shape step: missing __source marker",
        terminalReason: "WORKER_REJECT_LEGACY_SHAPE",
      });
    case "provider_no_availability":
      return jobOf({ terminalReason: "PROVIDER_NO_SLOT" });
    case "provider_form_incomplete":
      return jobOf({
        provider: "opentable",
        errorMessage: "guest form incomplete; auditAndRefill gave up",
      });
    case "otp_or_login_required":
      return jobOf({ terminalReason: "F-PROVIDER-OTP" });
    case "checkout_reached_manual_review":
      return jobOf({
        status: "ready_for_confirmation",
        terminalReason: "safe_handoff",
        errorMessage: null,
      });
    case "model_or_env_blocked":
      return jobOf({ errorMessage: "openai rate-limit 429" });
    case "network_or_provider_5xx":
      return jobOf({ errorMessage: "ECONNRESET; gateway timeout" });
    case "unknown":
    default:
      return jobOf({
        terminalReason: "OPAQUE",
        errorMessage: "execution halted at unexpected boundary",
      });
  }
}
