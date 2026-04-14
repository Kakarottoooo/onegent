# PRD: OpenTable Restaurant Booking

## Introduction

The app already supports hotel booking (Booking.com, Expedia, Hotels.com). This PRD adds restaurant booking via OpenTable — the largest US restaurant reservation platform (~55,000 restaurants).

The booking architecture (provider registry, executor, booking-jobs API) is already in place. We need to add:
1. An OpenTable provider with programmatic (non-AI) navigation
2. A frontend UI so users can add restaurant reservations just like hotel steps

## Goals

- User can add a restaurant booking step (name, date, time, party size) from the app UI
- The executor navigates OpenTable, selects the closest available time slot, fills guest info
- Job reaches `done` (confirmed) or surfaces a handoff URL if manual action is needed
- No credit card required — OpenTable standard reservations are free
- Works without OpenAI quota (programmatic DOM flow, AI is fallback only)

## OpenTable Booking Flow

```
Search page (opentable.com/s?term=...) 
  → Time slot buttons visible on search results
  → Click time slot → Reservation form (name / email / phone / occasion)
  → Submit → Confirmation page
```

Key difference from hotels: **time slots are clickable directly from search results** — no separate "room selection" stage.

---

## User Stories

---

### US-001: OpenTable provider — URL matching and stage signals

**Description:** As a developer, I need an OpenTable provider registered in the provider registry so the executor knows it's on OpenTable and can detect which stage it's in.

**Acceptance Criteria:**
- Create `lib/booking-autopilot/providers/opentable-com.ts` implementing `BrowserProvider`
- `id`: `"opentable-com"`
- `matchesUrl`: returns true for any `opentable.com` URL
- `getStageSignals` returns:
  - `searchResults: true` when URL contains `/s?` and has `term=`
  - `hotelDetail: true` when URL contains `/r/` (restaurant slug page) OR `/restaurant/profile/`
  - `guestDetailsStep: true` when page has visible first-name input (reservation form)
  - `paymentStep: false` always (OpenTable doesn't collect payment for standard reservations)
- `getBotPatterns`: `[]` (no known bot-block patterns for OpenTable)
- Register `openTableProvider` in `lib/booking-autopilot/providers/registry.ts`
- Import in `lib/booking-autopilot/providers/index.ts`
- Typecheck passes

---

### US-002: OpenTable programmatic listing — find and click time slot

**Description:** As a user, I want the executor to find my restaurant on OpenTable and click the closest available time slot automatically, without needing AI.

**Acceptance Criteria:**
- In `stagehand-executor.ts`, add OpenTable-specific listing handler triggered when `startProvider?.id === "opentable-com"` and stage is `listing`
- Handler reads `requestedTime` from the task string (format `HH:MM`)
- On search results page, finds all visible time-slot buttons (OpenTable renders them as `<button>` or `<a>` with text like "7:00 PM", "7:15 PM")
- Selects the button whose time is closest to `requestedTime` (within ±90 minutes)
- Clicks it using `page.evaluate()` DOM click (no `stagehand.act()`)
- If no time slots found on the page, falls back to clicking the restaurant card to navigate to its detail page, then looks for time slots there
- Logs the selected time: `[opentable] clicked time slot "7:15 PM" (requested: 19:00)`
- If no slots found at all within ±90 min, returns `no_availability`
- Typecheck passes

---

### US-003: OpenTable guest form fill

**Description:** As a user, I want the executor to fill in my name, email, and phone on the OpenTable reservation form so I don't have to type anything.

**Acceptance Criteria:**
- Add `fillGuestForm` to `openTableProvider` in `opentable-com.ts`
- Uses `page.evaluate()` with native HTMLInputElement setter (same React-compatible pattern as `fillExpediaGuestForm`)
- Fills in order:
  1. First name — find by placeholder containing "First" or aria-label "First name"
  2. Last name — find by placeholder containing "Last" or aria-label "Last name"
  3. Email — find by `type="email"`
  4. Phone — find by `type="tel"`, digits only
- Skips "Occasion" dropdown (optional field, leave as default)
- After filling, clicks the "Complete reservation" or "Confirm" submit button via DOM
- Logs fill result: `[opentable] guest form filled: firstName=true lastName=true email=true phone=true`
- Does NOT click any "Sign in" links — works as guest checkout
- Typecheck passes

---

### US-004: Wire restaurant booking to OpenTable startUrl

**Description:** As a developer, I need the booking-jobs start route to build the correct OpenTable search URL from restaurant booking params so the executor lands on the right page.

**Acceptance Criteria:**
- In `app/api/booking-jobs/[id]/start/route.ts`, when `step.type === "restaurant"` and no `startUrl` is in the body, build:
  ```
  https://www.opentable.com/s?term={restaurantName}&covers={partySize}&dateTime={date}T{time}:00
  ```
  where `restaurantName`, `partySize`, `date`, `time` come from `step.body`
- `step.body` for restaurant steps must include: `restaurantName: string`, `date: string` (YYYY-MM-DD), `time: string` (HH:MM), `covers: number`
- If `startUrl` is already in `step.body`, use it as-is (backwards compatibility)
- Also call `buildRestaurantTask` to generate the `task` string if `task` is not already in body
- Typecheck passes

---

### US-005: Frontend — Add Restaurant booking card to trip planner UI

**Description:** As a user, I want to add a restaurant reservation to my trip just like I add a hotel, with a simple form: restaurant name, date, time, party size.

**Acceptance Criteria:**
- Create component `components/booking/RestaurantStepCard.tsx`
- Form fields:
  - Restaurant name (text input, required)
  - Date (date picker or `<input type="date">`, required)
  - Time (select dropdown with 30-min increments from 11:00 AM to 10:00 PM, required)
  - Party size (select 1–10, default 2, required)
- "Add restaurant" submit button creates a `BookingJobStep` with `type: "restaurant"`
- Step body structure:
  ```json
  {
    "restaurantName": "Nobu Fifty Seven",
    "date": "2026-05-26",
    "time": "19:00",
    "covers": 2,
    "city": "New York"
  }
  ```
- Card displays in the trip steps list with 🍽️ emoji and restaurant name as label
- Typecheck passes
- Verify in browser using dev-browser skill

---

### US-006: End-to-end OpenTable booking test

**Description:** As a developer, I need to verify the full OpenTable flow works before shipping.

**Acceptance Criteria:**
- Run a booking job targeting a real OpenTable restaurant in New York (e.g. "Nobu Fifty Seven", 2026-05-26, 7:00 PM, 2 people)
- Flow completes all stages: listing (time slot selected) → guestDetailsStep (form filled) → confirmed or handoff URL
- Agent log shows: `[opentable] clicked time slot` and `[opentable] guest form filled`
- No `stagehand.act()` quota errors block the flow (all critical steps use DOM)
- Job status reaches `done` (confirmed) or `awaiting_confirmation` with a handoff URL
- Typecheck passes

---

## Technical Notes

- **No payment form**: OpenTable free reservations don't require a credit card. `fillPaymentForm` is not needed.
- **Time slot format**: OpenTable renders times as `"7:00 PM"` (12h with AM/PM). Parse to 24h for comparison.
- **React forms**: OpenTable uses React. Use native HTMLInputElement setter + `dispatchEvent("input")` — same pattern as Expedia.
- **Guest checkout**: OpenTable allows booking without an account. Do NOT attempt to sign in.
- **Confirmation**: After submit, OpenTable shows a confirmation page with booking details. The executor should detect this and set status to `completed`.
- **Anti-bot**: OpenTable is generally permissive for headless automation. No cookie injection needed unlike Booking.com.

## File Map After Completion

```
lib/booking-autopilot/providers/
  opentable-com.ts     ← new

app/api/booking-jobs/[id]/start/
  route.ts             ← updated: build OpenTable startUrl for restaurant steps

components/booking/
  RestaurantStepCard.tsx  ← new
```
