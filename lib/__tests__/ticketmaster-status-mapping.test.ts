import { describe, expect, it } from "vitest";

import {
  classifyTicketmasterTaskState,
  type TicketmasterTaskInput,
  type TicketmasterTaskState,
} from "@/lib/booking-autopilot/providers/ticketmaster-status";
import { mapBrowserStatus } from "@/lib/booking-autopilot/executors/stagehand-adapter";
import { mapExecutionStatusToTaskState } from "@/lib/api-v1/run-travel-task-attempt";

// Test scope: walk the full status chain end-to-end for every Ticketmaster
// task state, so a refactor that breaks any link in the chain fails loudly:
//
//   TicketmasterTaskState (classifier)
//     -> TicketmasterTaskExecutorStatus
//     -> BrowserTaskStatus (via stagehand-executor return)
//     -> ExecutorStatus (via mapBrowserStatus)
//     -> ExecutionJobStatus
//     -> TravelTaskState (via mapExecutionStatusToTaskState)
//
// The contract under test:
//   - Successful Ticketmaster dogfood path (checkout reached) keeps the
//     existing fall-through-to-form-fill behavior. The terminal
//     TravelTaskState eventually emitted by the form-fill pipeline stays
//     intact (we only assert the executorStatus is "running" here, which
//     is what the executor returns BEFORE the form-fill pipeline runs).
//   - Seat selection checkpoint -> "ready_for_confirmation" (user action
//     needed / ready to review). Never "executing" / "running" indefinitely,
//     never "failed".
//   - Account / session checkpoint -> "awaiting_login" (user action needed,
//     not running forever, not generic "ready_for_confirmation").
//   - External ad tab -> "failed" with a non-generic summary.
//   - Local browser disconnect -> "failed" (cannot remain "executing"
//     forever after the browser drops).
//   - Unknown failure -> "failed", never "completed".
//
// These map values come from the existing
//   - BrowserTaskStatus              (lib/booking-autopilot/types.ts)
//   - ExecutionJobStatus / TaskState (lib/core/execution/types.ts +
//                                     lib/api-v1/run-travel-task-attempt.ts)
// and we assert against them by string literal so any rename forces a
// deliberate test update.

const baseInput: TicketmasterTaskInput = {
  reachedCheckout: false,
  needsLogin: false,
  handoffReady: false,
  currentUrl: "",
  localBrowserDisconnected: false,
};

interface ChainExpectation {
  executorStatus: "running" | "paused_payment" | "needs_login" | "error";
  browserTaskStatus:
    | "completed"
    | "paused_payment"
    | "needs_login"
    | "captcha"
    | "no_availability"
    | "error";
  executorAdapterStatus:
    | "completed"
    | "paused_payment"
    | "needs_login"
    | "captcha"
    | "no_availability"
    | "error";
  travelTaskState:
    | "completed"
    | "ready_for_confirmation"
    | "awaiting_login"
    | "awaiting_otp"
    | "awaiting_profile"
    | "executing"
    | "failed";
}

interface Scenario {
  state: TicketmasterTaskState;
  rpa: Partial<TicketmasterTaskInput>;
  /**
   * The BrowserTaskStatus the executor returns for a non-checkout decision.
   * For checkout_reached, the executor falls through and the eventual
   * BrowserTaskStatus is decided by the form-fill pipeline; we don't assert
   * on it here.
   */
  expected: ChainExpectation;
}

// The mapping the executor uses today (post-wire-in) when surfacing a
// non-checkout decision. Mirrors the explicit branching in stagehand-executor.ts
// after the classifier returns:
//
//   decision.executorStatus === "paused_payment" -> BrowserTaskStatus "paused_payment"
//   decision.executorStatus === "needs_login"    -> BrowserTaskStatus "needs_login"
//   decision.executorStatus === "error"          -> BrowserTaskStatus "error"
function browserStatusFromDecision(
  exec: ChainExpectation["executorStatus"],
): ChainExpectation["browserTaskStatus"] {
  if (exec === "paused_payment") return "paused_payment";
  if (exec === "needs_login") return "needs_login";
  if (exec === "error") return "error";
  // exec === "running" only happens for checkout_reached — caller does not
  // hit this branch in the test scenarios below.
  return "error";
}

const SCENARIOS: Scenario[] = [
  {
    // 1. Successful Ticketmaster dogfood path — checkout reached.
    //    Executor falls through to the form-fill pipeline; we assert the
    //    classifier returns "running" so the early-return branches in the
    //    executor are skipped. The eventual TravelTaskState ("completed",
    //    "awaiting_otp", etc.) is decided downstream by form-fill +
    //    payment gate logic and is OUT OF SCOPE for this classifier test.
    state: "checkout_reached",
    rpa: {
      reachedCheckout: true,
      currentUrl: "https://checkout.ticketmaster.com/cart/abc123",
    },
    expected: {
      executorStatus: "running",
      // browserTaskStatus / executorAdapterStatus / travelTaskState are NOT
      // asserted because the executor does NOT return after this state.
      // We use sentinel "completed" values just to satisfy the shape.
      browserTaskStatus: "completed",
      executorAdapterStatus: "completed",
      travelTaskState: "completed",
    },
  },
  {
    // 2. Seat selection checkpoint — event page reached, Reserve disabled,
    //    user must pick a seat. Must be "ready_for_confirmation" not "failed".
    state: "user_seat_selection_required",
    rpa: {
      handoffReady: true,
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    },
    expected: {
      executorStatus: "paused_payment",
      browserTaskStatus: "paused_payment",
      executorAdapterStatus: "paused_payment",
      travelTaskState: "ready_for_confirmation",
    },
  },
  {
    // 3. Account / session checkpoint — auth boundary reached, user must
    //    sign in. Must be "awaiting_login" (not the more generic
    //    "ready_for_confirmation"). Never "executing".
    state: "user_login_required",
    rpa: {
      needsLogin: true,
      handoffReady: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    },
    expected: {
      executorStatus: "needs_login",
      browserTaskStatus: "needs_login",
      executorAdapterStatus: "needs_login",
      travelTaskState: "awaiting_login",
    },
  },
  {
    // 4. External ad tab detected — wrong tab. Must be "failed" with a
    //    non-generic summary, not "ready_for_confirmation" or "executing".
    state: "external_ad_tab_detected",
    rpa: {
      handoffReady: true,
      currentUrl: "https://promo.example.com/landing/abc",
    },
    expected: {
      executorStatus: "error",
      browserTaskStatus: "error",
      executorAdapterStatus: "error",
      travelTaskState: "failed",
    },
  },
  {
    // 5. Local browser disconnected — CDP target dropped. Must be "failed",
    //    NEVER "executing" / "running" — that would leave the task looking
    //    live forever in the Tasks workspace bucket.
    state: "local_browser_disconnected",
    rpa: {
      localBrowserDisconnected: true,
      handoffReady: true,
      // The disconnect signal beats currentUrl, but we still pass a TM URL to
      // prove the precedence works.
      currentUrl: "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
    },
    expected: {
      executorStatus: "error",
      browserTaskStatus: "error",
      executorAdapterStatus: "error",
      travelTaskState: "failed",
    },
  },
  {
    // 6. Unknown failure — RPA returned without checkout / handoff / login,
    //    no disconnect, empty URL. Must be "failed", never "completed",
    //    never "executing".
    state: "unknown_failure",
    rpa: {
      currentUrl: "",
    },
    expected: {
      executorStatus: "error",
      browserTaskStatus: "error",
      executorAdapterStatus: "error",
      travelTaskState: "failed",
    },
  },
];

describe("Ticketmaster task state -> task workspace bucket (full chain)", () => {
  for (const sc of SCENARIOS) {
    it(`${sc.state} routes through the chain to ${sc.expected.travelTaskState}`, () => {
      const decision = classifyTicketmasterTaskState({
        ...baseInput,
        ...sc.rpa,
      });
      // Step 1: classifier state is what we expect.
      expect(decision.state, `state for ${sc.state}`).toBe(sc.state);
      // Step 2: executor status from classifier.
      expect(
        decision.executorStatus,
        `executorStatus for ${sc.state}`,
      ).toBe(sc.expected.executorStatus);

      if (sc.state === "checkout_reached") {
        // Checkout falls through; the chain test ends here.
        expect(decision.holdBrowserOpen).toBe(false);
        return;
      }

      // Step 3: BrowserTaskStatus the executor returns for non-checkout
      // decisions (mirrors the explicit branching in stagehand-executor.ts).
      const browserStatus = browserStatusFromDecision(decision.executorStatus);
      expect(browserStatus, `BrowserTaskStatus for ${sc.state}`).toBe(
        sc.expected.browserTaskStatus,
      );

      // Step 4: ExecutorStatus via mapBrowserStatus (used when the booking
      // adapter wraps the BrowserTaskResult into the BookingExecutor shape).
      const executorAdapterStatus = mapBrowserStatus(browserStatus);
      expect(
        executorAdapterStatus,
        `ExecutorStatus (adapter) for ${sc.state}`,
      ).toBe(sc.expected.executorAdapterStatus);

      // Step 5: TravelTaskState — the user-visible bucket in the Tasks
      // workspace. The chain stops here.
      const travelTaskState = mapExecutionStatusToTaskState(executorAdapterStatus);
      expect(
        travelTaskState,
        `TravelTaskState for ${sc.state}`,
      ).toBe(sc.expected.travelTaskState);
    });
  }
});

describe("Ticketmaster task state -> task workspace bucket (UX guarantees)", () => {
  it("seat selection checkpoint NEVER bucketizes as 'failed' or 'executing'", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      handoffReady: true,
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    });
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).not.toBe("failed");
    expect(bucket).not.toBe("executing");
    expect(bucket).toBe("ready_for_confirmation");
  });

  it("account / session checkpoint bucketizes as 'awaiting_login' (not 'ready_for_confirmation')", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      needsLogin: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    });
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("awaiting_login");
    expect(bucket).not.toBe("ready_for_confirmation");
    expect(bucket).not.toBe("executing");
    expect(bucket).not.toBe("failed");
  });

  it("external ad tab bucketizes as 'failed' with a non-generic summary", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      handoffReady: true,
      currentUrl: "https://promo.example.com/landing/abc",
    });
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("failed");
    const lower = decision.summary.toLowerCase();
    expect(lower).toMatch(/ad tab|external/);
    expect(lower).not.toMatch(/^couldn'?t reach ticketmaster checkout/);
  });

  it("local browser disconnect bucketizes as 'failed' (NEVER 'executing')", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      localBrowserDisconnected: true,
    });
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("failed");
    expect(bucket).not.toBe("executing");
    expect(bucket).not.toBe("ready_for_confirmation");
  });

  it("unknown failure bucketizes as 'failed' (never 'completed' / 'executing')", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      currentUrl: "",
    });
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("failed");
    expect(bucket).not.toBe("completed");
    expect(bucket).not.toBe("executing");
  });

  it("successful dogfood (checkout reached) keeps falling through; classifier holds browser shut", () => {
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      reachedCheckout: true,
      currentUrl: "https://checkout.ticketmaster.com/cart/abc123",
    });
    expect(decision.state).toBe("checkout_reached");
    expect(decision.executorStatus).toBe("running");
    // checkout_reached must NOT hold the browser open by itself — the
    // form-fill pipeline owns that decision once it takes over.
    expect(decision.holdBrowserOpen).toBe(false);
  });

  it("login signal observed against an external ad tab does NOT bucketize as 'awaiting_login'", () => {
    // Defense-in-depth: an ad-tab page with a /login path could fool the
    // raw `needsLogin` boolean. The full chain must still flag it as 'failed'
    // because the classifier's ad-tab branch outranks the login branch.
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      needsLogin: true,
      handoffReady: true,
      currentUrl: "https://example-ad-network.com/login",
    });
    expect(decision.state).toBe("external_ad_tab_detected");
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("failed");
    expect(bucket).not.toBe("awaiting_login");
  });

  it("disconnect signal observed alongside a needsLogin signal does NOT bucketize as 'awaiting_login'", () => {
    // Defense-in-depth: if the page dropped after the login boundary, we
    // cannot trust the login signal — the user can no longer interact with
    // a dead browser. Disconnect must dominate.
    const decision = classifyTicketmasterTaskState({
      ...baseInput,
      localBrowserDisconnected: true,
      needsLogin: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    });
    expect(decision.state).toBe("local_browser_disconnected");
    const bucket = mapExecutionStatusToTaskState(
      mapBrowserStatus(browserStatusFromDecision(decision.executorStatus)),
    );
    expect(bucket).toBe("failed");
    expect(bucket).not.toBe("awaiting_login");
    expect(bucket).not.toBe("executing");
  });
});
