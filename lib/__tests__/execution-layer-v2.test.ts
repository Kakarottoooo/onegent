import { describe, expect, it } from "vitest";

import {
  assertBrowserHarnessPatchProposalSafe,
  createBrowserHarnessPatchProposal,
  executionEventsToEvidenceRecords,
  runNoLiveLayerOrchestrator,
  type ExecutionEvent,
  type ExecutionEvidence,
} from "@/lib/execution-layer";

const identity = {
  taskId: "task-v2-1",
  jobId: "job-v2-1",
  attemptId: "attempt-v2-1",
  planVersion: 7,
  provider: "booking-com",
};

const evidence: ExecutionEvidence[] = [
  {
    kind: "screenshot",
    label: "Search results page shows target card but click missed",
    path: "worker/.debug-screenshots/no-live/page.png",
    confidence: "high",
  },
];

const fixedNow = () => "2026-05-06T12:00:00.000Z";

describe("Execution Layer V2 no-live orchestrator", () => {
  it("stops after L1 success without escalation", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "success",
          message: "Provider adapter reached the manual review checkpoint.",
          evidence,
        },
      ],
    });

    expect(run.finalResult.terminalOutcome).toBe("success");
    expect(run.invokedLayers).toEqual(["provider_adapter"]);
    expect(run.escalations).toEqual([]);
    expect(run.events.some((event) => event.stage === "layer_escalated")).toBe(false);
  });

  it("does not escalate true no availability when evidence supports it", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "no_availability",
          escalationReason: "true_no_availability",
          message: "Provider page showed no target-window availability.",
          evidence: [
            {
              kind: "provider_signal",
              label: "No available times banner",
              value: "No availability for 2026-05-14 at 20:00.",
              confidence: "high",
            },
          ],
        },
      ],
    });

    expect(run.finalResult.terminalOutcome).toBe("no_availability");
    expect(run.invokedLayers).toEqual(["provider_adapter"]);
    expect(run.events.map((event) => event.nextLayer).filter(Boolean)).toEqual([]);
  });

  it("escalates selector drift from L1 to L2 when evidence exists", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "runtime_drift",
          escalationReason: "selector_drift",
          message: "Target card is visible but the provider selector missed it.",
          evidence,
        },
        {
          terminalOutcome: "success",
          message: "Browser Harness mock selected the visible target card.",
          evidence,
        },
      ],
    });

    expect(run.invokedLayers).toEqual(["provider_adapter", "browser_harness"]);
    expect(run.escalations).toEqual([
      {
        fromLayer: "provider_adapter",
        toLayer: "browser_harness",
        reason: "selector_drift",
        message: "Escalating provider adapter drift to Browser Harness: selector_drift.",
      },
    ]);
    expect(run.finalResult.terminalOutcome).toBe("success");
  });

  it("preserves task and job identity on L2 success and emits layer_escalated", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "runtime_drift",
          escalationReason: "field_fill_miss",
          message: "Provider adapter could not verify a filled field.",
          evidence,
        },
        {
          terminalOutcome: "success",
          message: "Browser Harness mock verified the filled field.",
          evidence,
        },
      ],
    });

    const l2Events = run.events.filter((event) => event.layer === "browser_harness");
    expect(l2Events.length).toBeGreaterThan(0);
    for (const event of l2Events) {
      expect(event.taskId).toBe(identity.taskId);
      expect(event.jobId).toBe(identity.jobId);
      expect(event.attemptId).toBe(identity.attemptId);
      expect(event.planVersion).toBe(identity.planVersion);
      expect(event.provider).toBe(identity.provider);
    }

    expect(run.events).toContainEqual(
      expect.objectContaining({
        stage: "layer_escalated",
        layer: "provider_adapter",
        nextLayer: "browser_harness",
        escalationReason: "field_fill_miss",
      }),
    );
  });

  it("classifies provider degraded without blind L2 escalation", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "provider_degraded",
          escalationReason: "provider_degraded",
          message: "Provider returned repeated 5xx responses before selectors ran.",
          evidence: [
            {
              kind: "network_trace",
              label: "Provider 503 response",
              excerpt: "booking provider returned HTTP 503",
              confidence: "high",
            },
          ],
        },
        {
          terminalOutcome: "success",
          message: "This result must not be consumed.",
        },
      ],
    });

    expect(run.finalResult.terminalOutcome).toBe("provider_degraded");
    expect(run.invokedLayers).toEqual(["provider_adapter"]);
    expect(run.escalations).toEqual([]);
  });

  it("keeps Browser Harness patch proposals advisory and non-mutating", () => {
    const proposal = createBrowserHarnessPatchProposal({
      provider: "booking-com",
      targetStage: "hotel-result-card",
      driftClass: "selector_drift",
      discoveredSelectors: [
        {
          name: "reserve button",
          selector: "button:has-text('Reserve')",
          strategy: "text",
          confidence: "medium",
          evidenceRefs: ["jsonl:event-12", "screenshot:page.png"],
        },
      ],
      strategy: "Prefer role/text selector, then frame-aware locator fallback.",
      evidence,
      suggestedTests: [
        {
          name: "booking result card selector drift",
          fileHint: "lib/__tests__/booking-com-hotel-runtime.test.ts",
          assertion: "visible reserve controls are matched without clicking final confirmation",
        },
      ],
      rationale: "The proposal documents selector evidence for a human patch.",
    });

    expect(proposal.canAutoApply).toBe(false);
    expect(proposal.productionMutation).toBe("forbidden");
    expect(() => assertBrowserHarnessPatchProposalSafe(proposal)).not.toThrow();

    expect(() =>
      assertBrowserHarnessPatchProposalSafe({
        ...proposal,
        canAutoApply: true,
      } as typeof proposal),
    ).toThrow(/must never auto-apply/i);
  });

  it("represents future L3 Computer Use but does not invoke it in the no-live skeleton", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "runtime_drift",
          escalationReason: "progress_stall",
          message: "L1 stalled after search results loaded.",
          evidence,
        },
        {
          terminalOutcome: "runtime_drift",
          escalationReason: "unknown_page_mutation",
          message: "L2 observed an unknown page mutation.",
          evidence,
        },
      ],
    });

    expect(run.plannedLayers).toEqual([
      "provider_adapter",
      "browser_harness",
      "computer_use",
    ]);
    expect(run.invokedLayers).toEqual(["provider_adapter", "browser_harness"]);
    expect(run.invokedLayers).not.toContain("computer_use");
    expect(run.events).toContainEqual(
      expect.objectContaining({
        stage: "layer_blocked",
        layer: "browser_harness",
        nextLayer: "computer_use",
      }),
    );
  });

  it("emits normalized identity and message fields on every event", () => {
    const run = runNoLiveLayerOrchestrator({
      identity,
      now: fixedNow,
      results: [
        {
          terminalOutcome: "runtime_drift",
          escalationReason: "click_miss",
          message: "Click target was visible but action landed elsewhere.",
          evidence,
        },
        {
          terminalOutcome: "success",
          message: "Browser Harness mock recovered the click target.",
          evidence,
        },
      ],
    });

    for (const event of run.events) {
      assertNormalizedEvent(event);
    }

    const records = executionEventsToEvidenceRecords(run.events);
    expect(records.length).toBe(run.events.length);
    expect(records.some((record) => record.screenshotRequired)).toBe(true);
    expect(records.map((record) => record.decisionLogEntry.message).join("\n")).toContain(
      "[provider_adapter]",
    );
  });
});

function assertNormalizedEvent(event: ExecutionEvent): void {
  expect(event.taskId).toBe(identity.taskId);
  expect(event.jobId).toBe(identity.jobId);
  expect(event.attemptId).toBe(identity.attemptId);
  expect(event.planVersion).toBe(identity.planVersion);
  expect(event.provider).toBe(identity.provider);
  expect(event.layer).toMatch(/^(provider_adapter|browser_harness|computer_use)$/);
  expect(event.stage.length).toBeGreaterThan(0);
  expect(event.severity).toMatch(/^(debug|info|warning|error)$/);
  expect(event.message.length).toBeGreaterThan(0);
}
