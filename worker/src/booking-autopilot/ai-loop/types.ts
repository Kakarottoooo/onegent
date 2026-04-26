/**
 * AI Loop types — perception → reasoning → execution architecture.
 * Phase 1 of the migration from hardcoded Playwright RPA to generalized AI-driven automation.
 * See: docs/ai-loop-migration-plan.md
 */

/** Which "page" the browser is currently on during a booking flow. */
export type BookingStage =
  | "listing"          // Search results list
  | "hotel_detail"     // Hotel detail page with room list
  | "room_selection"   // Rate/room selection page
  | "guest_form"       // Contact info form
  | "payment_form"     // Card details form
  | "paused_payment"   // CVV field visible — stop, wait for user
  | "confirmation"     // Booking confirmed
  | "no_availability"  // No rooms available
  | "captcha"          // Blocked by CAPTCHA / bot detection
  | "unknown";

/** The type of action the LLM wants to execute next. */
export type ActionType =
  | "act"              // Natural language instruction → Stagehand page.act()
  | "fill_form"        // Batch fill form fields
  | "scroll_down"
  | "scroll_up"
  | "wait"
  | "done";            // Terminal — loop exits

/** A single structured action returned by the LLM. */
export interface NextAction {
  type: ActionType;
  /** For "act": natural language describing what to do, e.g. "click the cheapest room" */
  instruction?: string;
  /** For "fill_form": map of field label → value */
  fields?: Record<string, string>;
  /** For "done": why the loop should end */
  outcome?: "paused_payment" | "completed" | "no_availability" | "captcha";
  /** LLM's reasoning — logged to trace for debugging */
  reasoning: string;
  /** 0–1 confidence; below 0.5 triggers cautious fallback */
  confidence: number;
}

/** Full structured response from the LLM per step. */
export interface PerceptionResult {
  stage: BookingStage;
  /** One-sentence description of what the LLM sees on screen */
  pageDescription: string;
  nextAction: NextAction;
}

/** Record of one step in the loop, persisted in AILoopResult.steps for debugging. */
export interface LoopStepRecord {
  stepIndex: number;
  url: string;
  stage: BookingStage;
  action: NextAction;
  /** Wall-clock time for perceive + execute combined */
  durationMs: number;
}

/** Final result returned by runAIBookingLoop. */
export interface AILoopResult {
  outcome: "paused_payment" | "completed" | "no_availability" | "captcha" | "failed";
  finalUrl: string;
  steps: LoopStepRecord[];
  /** Human-readable summary from the last LLM perception */
  summary: string;
}
