import { describe, expect, it } from "vitest";
import {
  FAILURE_CATEGORIES,
  FAILURE_CATEGORY_KEYS,
  WORKED_EXAMPLES,
  getFailureCategory,
  listFailureCategories,
  listWorkedExamples,
  type FailureCategoryKey,
} from "@/lib/operator-failure-taxonomy";

describe("operator-failure-taxonomy categories", () => {
  it("exposes exactly the four required categories in the locked order", () => {
    expect(FAILURE_CATEGORIES.map((c) => c.key)).toEqual([
      "model_env_transient",
      "provider_network_degraded",
      "provider_logic_failure",
      "safe_boundary_reached",
    ]);
  });

  it("exports the same keys via FAILURE_CATEGORY_KEYS", () => {
    expect([...FAILURE_CATEGORY_KEYS]).toEqual([
      "model_env_transient",
      "provider_network_degraded",
      "provider_logic_failure",
      "safe_boundary_reached",
    ]);
  });

  it("each category is fully populated and ASCII-only", () => {
    for (const category of FAILURE_CATEGORIES) {
      expect(category.label.length, category.key).toBeGreaterThan(0);
      expect(category.oneLine.length, category.key).toBeGreaterThan(0);
      expect(category.signals.length, category.key).toBeGreaterThanOrEqual(3);
      expect(category.nextActions.length, category.key).toBeGreaterThanOrEqual(
        2,
      );
      expect(category.doNot.length, category.key).toBeGreaterThanOrEqual(2);
      expect(
        category.relatedClasses.length,
        category.key,
      ).toBeGreaterThanOrEqual(1);

      const allText = [
        category.label,
        category.oneLine,
        ...category.signals,
        ...category.nextActions,
        ...category.doNot,
        ...category.relatedClasses,
      ].join("\n");
      expect(allText, `${category.key} must be ASCII-only`).not.toMatch(
        /[^\x00-\x7F]/,
      );
    }
  });

  it("severity values are constrained to wait | patchable | info", () => {
    const allowed: Array<"wait" | "patchable" | "info"> = [
      "wait",
      "patchable",
      "info",
    ];
    for (const category of FAILURE_CATEGORIES) {
      expect(allowed, category.key).toContain(category.severity);
    }
  });

  it("model_env_transient signals must mention OpenAI 5xx-style failure", () => {
    const cat = getFailureCategory("model_env_transient");
    expect(cat).not.toBeNull();
    const haystack = cat!.signals.join("\n").toLowerCase();
    expect(haystack).toMatch(/openai/);
    expect(haystack).toMatch(/500|server_error|rate-limit|429|timeout|unavailable/);
  });

  it("model_env_transient must explicitly forbid patching provider code", () => {
    const cat = getFailureCategory("model_env_transient");
    expect(cat).not.toBeNull();
    const haystack = cat!.doNot.join("\n").toLowerCase();
    expect(haystack).toMatch(/(?:resy|opentable|expedia|provider).*selector|patch/);
  });

  it("provider_network_degraded must list provider domains and net::ERR signals", () => {
    const cat = getFailureCategory("provider_network_degraded");
    expect(cat).not.toBeNull();
    const haystack = cat!.signals.join("\n").toLowerCase();
    expect(haystack).toMatch(/resy\.com|opentable\.com|expedia\.com|booking\.com|hotels\.com/);
    expect(haystack).toContain("net::err_");
  });

  it("provider_logic_failure must include legacy_shape and form_incomplete related classes", () => {
    const cat = getFailureCategory("provider_logic_failure");
    expect(cat).not.toBeNull();
    expect(cat!.relatedClasses).toContain("legacy_shape_missing_source");
    expect(cat!.relatedClasses).toContain("provider_form_incomplete");
  });

  it("safe_boundary_reached must include OTP / login / payment-review classes", () => {
    const cat = getFailureCategory("safe_boundary_reached");
    expect(cat).not.toBeNull();
    expect(cat!.relatedClasses).toContain("otp_or_login_required");
    expect(cat!.relatedClasses).toContain("checkout_reached_manual_review");
    expect(cat!.relatedClasses).toContain("paused_payment");
  });

  it("safe_boundary_reached doNot must explicitly forbid bypassing safety boundaries", () => {
    const cat = getFailureCategory("safe_boundary_reached");
    expect(cat).not.toBeNull();
    const haystack = cat!.doNot.join("\n").toLowerCase();
    expect(haystack).toMatch(/cvv|payment/);
    expect(haystack).toMatch(/otp|captcha|login/);
    expect(haystack).toMatch(/final/);
  });

  it("listFailureCategories returns defensive copies (does not leak frozen arrays)", () => {
    const copy = listFailureCategories();
    copy[0].signals.push("MUTATED");
    expect(FAILURE_CATEGORIES[0].signals).not.toContain("MUTATED");
    copy[0].doNot.push("MUTATED");
    expect(FAILURE_CATEGORIES[0].doNot).not.toContain("MUTATED");
  });

  it("getFailureCategory returns null for unknown keys", () => {
    expect(getFailureCategory("nope" as FailureCategoryKey)).toBeNull();
  });
});

describe("operator-failure-taxonomy worked examples", () => {
  it("preserves the R-030 OpenAI 500 worked example as model_env_transient", () => {
    expect(WORKED_EXAMPLES.length).toBeGreaterThanOrEqual(1);
    const r030 = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("r030-openai-responses-500"),
    );
    expect(r030, "R-030 worked example must be present").toBeDefined();
    expect(r030!.category).toBe("model_env_transient");
  });

  it("R-030 worked example carries the canonical evidence ids", () => {
    const r030 = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("r030-openai-responses-500"),
    );
    expect(r030).toBeDefined();
    const evidenceMap = new Map(r030!.evidence.map((e) => [e.label, e.value]));
    expect(evidenceMap.get("Task id")).toBe(
      "9ca2a595-09cd-4f03-bb19-2b59c474089b",
    );
    expect(evidenceMap.get("Job id")).toBe(
      "77f70121-4460-4bcd-974d-999360221cde",
    );
    expect(evidenceMap.get("OpenAI request id")).toBe(
      "req_ce42a48137424a938a7893b131416d28",
    );
    expect(evidenceMap.get("Benchmark report")).toBe(
      "benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json",
    );
  });

  it("R-030 takeaway must explicitly say it is NOT a Resy regression", () => {
    const r030 = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("r030-openai-responses-500"),
    );
    expect(r030).toBeDefined();
    expect(r030!.takeaway.toLowerCase()).toMatch(
      /not a resy provider regression|inconclusive/,
    );
  });

  it("listWorkedExamples returns defensive copies", () => {
    const copy = listWorkedExamples();
    copy[0].evidence.push({ label: "MUT", value: "MUT" });
    const original = WORKED_EXAMPLES[0];
    const labels = original.evidence.map((e) => e.label);
    expect(labels).not.toContain("MUT");
  });
});
