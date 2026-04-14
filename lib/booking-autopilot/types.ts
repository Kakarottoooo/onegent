export interface BookingProfile {
  // Contact
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  // Billing address
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  // Payment card — CVV is intentionally never stored
  card_name?: string;    // name on card
  card_number?: string;  // full number, stored locally only
  card_expiry?: string;  // MM/YY
  // Hotel preferences — learned from conversation history
  room_preference?: string;  // e.g. "king bed", "double queen", "suite", "twin"
  breakfast_preference?: boolean; // true = user prefers breakfast included
  bed_type?: string; // explicit bed type if different from room_preference
}

export interface RestaurantAutopilotRequest {
  restaurant_name: string;
  city: string;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM (24h)
  covers: number;
  user_profile?: BookingProfile;
}

export interface HotelAutopilotRequest {
  hotel_name: string;
  city: string;
  checkin: string;  // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  adults: number;
  user_profile?: BookingProfile;
}

/** @deprecated — kept for backwards compat; use BrowserTaskStatus */
export type AutopilotStatus =
  | "ready"           // screenshot taken, handoff_url works
  | "no_availability" // no slots found near requested time
  | "error";          // automation failed

/** @deprecated — kept for backwards compat; use BrowserTaskResult */
export interface AutopilotResult {
  status: AutopilotStatus;
  screenshot_base64?: string;
  handoff_url: string;
  selected_time?: string;
  error?: string;
}

// ── New browser-use types ────────────────────────────────────────────────────

/** Which LLM the browser agent should use. */
export interface AgentModelConfig {
  /** Stagehand provider/model string, e.g. "google/gemini-2.0-flash" */
  model: string;
  /** User-supplied API key for the chosen provider. */
  apiKey: string;
}

export interface BrowserTaskInput {
  /** Starting URL (search page or direct booking URL). */
  startUrl: string;
  /** Natural-language goal for the agent, e.g. "Book a table for 2 at Nobu on March 15 at 7pm". */
  task: string;
  /** User profile for form pre-filling. */
  profile: BookingProfile;
  /** For logging / job association. */
  jobId: string;
  stepIndex: number;
  /** Which LLM to use for browser vision. Defaults to Gemini 2.0 Flash if omitted. */
  agentModel?: AgentModelConfig;
  /** DB profile ID — server fetches and decrypts card data. Preferred over inline profile. */
  profileId?: number;
  /**
   * Fallback URL to use if the startUrl fails (e.g. booking.com returns no results).
   * The executor will navigate here automatically instead of relying on the agent to detect errors.
   */
  fallbackUrl?: string;
}

export type BrowserTaskStatus =
  | "completed"             // fully done (agent confirmed booking without payment gate)
  | "paused_payment"        // reached payment page — waiting for user to pay
  | "needs_login"           // site requires account login the agent can't bypass
  | "captcha"               // hard-blocked by CAPTCHA
  | "no_availability"       // agent confirmed no slots/rooms available
  | "error";                // unexpected failure

export interface BrowserTaskResult {
  status: BrowserTaskStatus;
  /** Base64 PNG of what the agent sees at the pause/completion point. */
  screenshotBase64?: string;
  /** URL for the user to continue (warm session or deep link). */
  handoffUrl: string;
  /** Browserbase live-view URL for debugging (only in production mode). */
  sessionUrl?: string;
  /** Human-readable summary of what the agent did. */
  summary: string;
  /** Error detail when status === "error". */
  error?: string;
  /** Structured trace of automatic fallback decisions taken by the executor. */
  debugTrace?: string[];
  /**
   * For restaurant no_availability: list of time slots found on the page
   * (e.g. ["7:15 PM", "7:30 PM", "8:00 PM"]) so the UI can offer alternatives.
   */
  availableSlots?: string[];
}
