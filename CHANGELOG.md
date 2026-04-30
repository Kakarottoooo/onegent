# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.59.0] - 2026-04-30

### Added
- **OpenTable detail-page (`/r/<slug>`) booking flow** — Tao Downtown and other OT detail-URL venues now drive the right-side reservation widget programmatically: navigate with `?dateTime=YYYY-MM-DDTHH:MM&covers=N` query params (forces OT SSR to render the widget with case context), drive the `<select data-test="time-picker">` via Playwright `selectOption`, wait up to 8s for the AJAX-rendered `<ul data-test="time-slots">`, then click the closest matching anchor. Verified end-to-end: Tao Downtown reaches `payment_stop` at OT `/booking/details` (dry-run boundary fires on the deposit-hold credit-card section).

### Fixed
- **OT detail-page widget time-slot selector** — anchors render as `<a>` with strict `H:MM AM/PM` text, no `href`, no `role="button"`. Previous listing-card selector required `role="button"` and missed all of them. Replaced with multi-source candidate collection: `[data-test="time-slots"]` container OR strict-text `<a>` (regex `^\d{1,2}:\d{2}\s*(AM|PM)$` + length<12) OR strict-text `<button>`. (commits `f62ce8d` → `4017a3f`)
- **OT/Resy detail URLs sometimes RPA-classified as `unknown` stage** when AI confidence sat between 0.65–0.74 (below the 0.75 acceptance gate). The OT branch would never run, the time-picker driver never fired, and the case fell to executor_error after 30s+. Added URL-based RPA fallback in `stage-assessment.ts`: `/opentable.com/r/<slug>` and `/resy.com/cities/<city>/venues/<slug>` are pinned to `listing` stage when `!visibleCheckoutFields && !hitPaymentUrl`. (commit `aa5e920`)
- **OpenTable provider's `if (ccRequired)` early-return path didn't emit the dry-run boundary marker**, so high-end deposit-hold venues (Tao Downtown, etc.) reached `/booking/details`, filled the diner form, hit "Payment page is open" handoff — and the benchmark classifier silently bucketed them as `executor_error` because no marker was in `step.decisionLog`. Added the marker emission on the cc-section path; production cc-handoff behavior is unchanged. (commit `61993ab`)

### Verified end-to-end
- **Tao Downtown (OT, deposit-hold) reaches `payment_stop` in 1m 50s** on master `61993ab`. dev.log confirms the full path: navigate w/ params (`dateTime=2026-05-14T19:30&covers=2`) → time-picker drive picked 7:30 PM (diff=0) → time-slot anchor match "7:30 PM" → CDP click → stage assessment 2 = checkout_form on `/booking/specials` → seating-options auto-select Standard → `/booking/details` → diner form filled (Benchmark User / phone / email) → cc-section detected → dry-run boundary fires. User screenshot confirms widget shows "Thu, May 14, 7:30 PM, 2 people (Standard seating)".
- **5/5 benchmark on master `61993ab`**: L'Artusi 17s no_availability ✓ · **Tao Downtown 1m 50s payment_stop ✓** · Carbone 17s no_availability ✓ · Lilia 30s executor_error (independent Resy backlog) · Cosme 59s payment_stop ✓. 4 of 5 reach the expected outcome bucket; the Tao Downtown breakthrough closes out the cont. 1 backlog item.

### Known issues / backlog
- **Lilia (Resy) click-after-slot instability** — `[resy] time slot diag: BUTTON "8:45 PM Dining Room"` clicks but next stage assessment still sees `listing`. Suspected Resy popup-modal timing race; needs dedicated investigation.
- **5/5 concurrent CDP target race** — when 5 stagehand sessions spin up simultaneously, 1–2 cases occasionally hit `No Page found for target closed before CDP response`. Consider stagehand startup throttling or concurrency cap of 3.
- Dashboard `duration_seconds` cosmetic display bug from 0.2.58.0 still present; DB rows are accurate.
- AI stage assessment latency (30–60s/call) on bookable paths still saved only by pre-AI fast path for not-bookable.

## [0.2.58.0] - 2026-04-30

### Added
- **Restaurant Benchmark Phase 0–4 closeout** — schema + dry_run boundary + runner + dashboard + mutable task state + DeepLink fallback + thin executor interface + MCP v2 task protocol + site skill registry. Lets us run a 5-case NYC restaurant matrix from `/internal/benchmark`, classify each outcome against a canonical failure taxonomy, and aggregate provider success rates over time. Cosme (Resy) now reproducibly runs end-to-end through the full RPA flow (listing → click time slot → checkout modal) and stops at the dry_run payment boundary.
- **Pre-AI fast path for not-bookable pages** — before the first `assessBookingStage` call (which costs 30–60s of Anthropic vision API), `stagehand-executor` runs a cheap `page.evaluate(() => document.body.innerText)` scan against `NO_AVAILABILITY_SIGNALS`. Hits short-circuit to `no_availability` in ~3–5s. Catches OpenTable's "Not available on OpenTable" / "Permanently Closed" panels, OT/Resy 404 pages, and Resy's "no online availability for Today" listing-full state.
- **Synthetic benchmark guest profile** — `caseToBookingStep` now inlines `BENCHMARK_PROFILE` (RFC 2606 `.test` TLD + 555-prefix phone). Without this, anonymous benchmark booking jobs hit the OpenTable guest form with no fields to fill and the executor's default-success guard tripped after 30s+. Card fields are intentionally omitted — dry_run stops before payment, and pre-validation by the venue would reject a fake number anyway.
- **Phase 2 `buildDeepLinkEnrichmentForStep` wired into `no_availability` return paths** in `app/api/booking-jobs/[id]/start/route.ts` (previously only on the error branch). Restaurant `no_availability` outcomes now include a `handoff_url` with `?covers=N&dateTime=...` pre-filled.
- **`BookingStage` union gains `"no_availability"`** in `lib/booking-autopilot/core/stages.ts`. The AI stage detector emits this when it sees pages it can't reason about (e.g. permanently-closed venue panels), and `mapAIStageToRPA` now forwards it through. `stagehand-executor` early-exits at this stage with `status=no_availability` instead of running the 20-step continuation agent.

### Fixed
- **`runUniversalStep` crashed with "Cannot read properties of undefined (reading 'match')"** when callers (e.g. the benchmark runner) provided `step.body.startUrl` but no `step.body.task`. Task synthesis was nested inside the startUrl-build branch and so was skipped. Restructured the conditional so startUrl and task are built independently. (commit `22bdf85`)
- **`NO_AVAILABILITY_SIGNALS` had no restaurant-side keywords** — only hotel-side ("sold out", "fully booked"). Added 11 phrases covering OpenTable's "Not available on OpenTable" / "Permanently Closed" / "Find similar restaurants" CTAs, OT/Resy 404 octopus pages ("well, this is embarrassing", "we weren't able to find the page", "we can't find that page"), and Resy's date-full listing state ("no online availability for", "next availability for", "there's no online availability"). (commits `445bfa4` + `e6a4ec2`)
- **`mapAIStageToRPA` dropped `no_availability` to `unknown`** because the RPA-side `BookingStage` enum didn't have that member. `[stage-detect] AI=no_availability(conf=0.99) → mapped=unknown` from real benchmark dev.log proved this. Added the enum member and the mapping case; added a stagehand-executor early-exit branch so we don't waste 20s on a continuation pass for pages the AI already classified definitively. (commit `574daaa`)
- **Three benchmark seeds pointed to OpenTable URLs that 404** — Boucherie West Village (`r/boucherie-west-village-new-york`) and Buddakan (`r/buddakan-new-york`) returned the OT 404 page. Could not HTTP-verify candidate URLs from sandbox (OpenTable's reverse-proxy blocks non-browser clients with constant TLS renegotiation). Swapped to URLs the user independently confirmed exist: L'Artusi (`r/lartusi-new-york`, not-on-network) and Carbone (`r/carbone-new-york`, permanently closed). Also serves as a regression test for the new `NO_AVAILABILITY_SIGNALS` keywords. (commits `a44b129` + `3e2bebd`)

### Verified end-to-end
- **Cosme (Resy) reaches `payment_stop` reproducibly** across **4** separate benchmark runs on different code revisions and different dev-server processes. dev.log shows the full flow: redirect from `cities/ny/cosme` → `cities/new-york-ny/venues/cosme` → listing → click 7:30 PM → checkout_form (3–5 reassessments) → dry_run boundary fires. Confirms the Phase 0 boundary helper works on a real Resy production checkout modal.
- **Final 5/5 benchmark on master `e6a4ec2`** (after mock profile + Resy keywords landed): L'Artusi 3s no_availability ✓ · Tao Downtown 37s error (OT widget selector backlog) · Carbone 14s no_availability ✓ · Lilia 14s no_availability ✓ · Cosme 53s payment_stop ✓. 4 of 5 cases short-circuit in ≤14s; the dry-run boundary fires on the bookable Resy case. The one remaining failure is a specific OT booking-widget variant the time-slot selector doesn't cover yet — out of scope for this release.

### Known issues / backlog
- Dashboard `duration_seconds` for the benchmark cases sometimes shows 0s / 1s when the underlying `step.status` is correct (`no_availability`, etc.) and the actual POST took 18s+. Suspected race in `resolveBenchmarkCase` finalising before stagehand writes `step.completed_at`. Cosmetic — DB rows are accurate. Will fix after the next batch of stagehand work.
- OpenTable's anti-scrape blocks all HTTP-client based slug verification from the dev sandbox. Adding new OT venues to the benchmark requires manual visual verification by the user, or a dev-server-internal fetch endpoint.
- AI stage assessment costs 30–60s per call when 5 cases run concurrently and contend on the Anthropic rate limit. The pre-AI fast path saved the not-bookable cases; bookable-but-busy cases still pay this.

## [0.2.23.0] - 2026-03-23

### Added
- **Rebrand: Folio → Onegent** — product renamed to Onegent across all copy, metadata, and the public URL (`onegent.one`). The name reflects the agent-first positioning.
- **Phase 3.3a — Session preference extraction**: after each restaurant query, MiniMax extracts preference signals (noise tolerance, budget, chain preference, excluded cuisines) from the user's message and accumulates them in-session. Injected into all subsequent ranking prompts so the second query "remembers" everything from the first.
- **Phase 3.3b — Persistent preference profile**: session preferences promote into a `UserPreferenceProfile` stored in localStorage and synced to the cloud for signed-in users. Survives across sessions — "no chains" doesn't need repeating.
- **Phase 3.3c — Inline feedback loop**: thumbs-up/down on any recommendation card triggers `POST /api/feedback/inline`, which maps structured issues (too noisy → `noise_sensitivity:high`, too expensive → `budget_sensitivity:high`, slow service → `wait_sensitivity:high`) to per-session `user_preferences` updates. Next query automatically reflects the feedback.
- **OpenTable Reserve button**: "Reserve" on date_night cards now uses `card.opentable_url` (direct OpenTable page) when available, falling back to Google Maps — eliminating the extra search step.
- **G-1 — Flight time-of-day filtering**: `FlightIntent` gains `avoid_red_eye?`, `earliest_departure?`, `latest_departure?`. NLU detects "no red-eye / 不要凌晨 / not after 9pm" and maps to these fields. `runFlightPipeline` post-filters SerpAPI results by departure window. Falls back to unfiltered set when all flights would be excluded so results are never empty.
- **G-2 — Credit card portfolio gap analysis**: "I have CSP and Amex Gold, what's missing?" triggers `optimization_mode: "portfolio_review"`. Pipeline computes effective earn rates per spending category across the user's existing cards, identifies uncovered categories (<2×), scores remaining cards by gap-fill potential, and annotates each with a `portfolio_gap_note` explaining the specific gap it fills.
- **G-3 — Module-level refine**: "keep the flights, just find a different hotel" sets `refine_module` + `pinned_plan_id`. `runAgent` loads the existing plan from DB, re-runs only the swapped module (hotel or flight), pins the rest from the stored plan, and saves the result as a new plan with `parent_plan_id` lineage. Eliminates the full re-run on targeted refinements.
- **G-4 — Venue quality degradation alert**: `venue_baselines` table records Google Places rating at plan-save time for `date_night` plans with future event dates. Weekly cron (`/api/cron/venue-health-check`) re-queries Google Places for each baseline; when rating drops ≥0.3★, a `venue_quality_alert` outcome is recorded. `SharedPlanView` shows an amber warning banner on the share page when this alert is present.
- **S-1 — Fast-service restaurant mode**: `service_pace_required: "fast"` added to `UserRequirements`. Detected from "quick lunch / in and out / 15 minutes / 快速 / 不想等". `rankAndExplain` prompt injects a FAST SERVICE MODE block that heavily boosts low-wait venues and penalises slow-service ones.
- **S-2 — Honeymoon / anniversary hotel mode**: `special_occasion?: "honeymoon" | "anniversary" | "birthday"` added to `HotelIntent`. Detected from "蜜月 / anniversary / 结婚周年 / 纪念日". Hotel ranking prompt boosts spa, ocean-view rooms, suites, couples packages, and romantic reputation. `why_recommended` includes a tip to call ahead for a room upgrade.
- **S-3 — Family travel hotel mode**: `has_children?: boolean; children_count?: number` added to `HotelIntent`. Detected from "带孩子 / with kids / children / toddler". Ranking prompt prioritises pool, kids club, connecting rooms, family dining, and proximity to family attractions; penalises adult-only properties.
- **S-4 — Credit card signup bonus ranking**: `optimization_mode: "signup_bonus"` added. Detected from "best welcome offer / 开卡奖励 / SUB". Pipeline scores cards by `sub_value × spend_feasibility_factor` (1.0 if feasible, 0.6 if tight, 0.2 if unreachable), returns top 3 with bonus details in `portfolio_gap_note`.
- **S-5 — Single-constraint refinement**: NLU detects "cheaper / 便宜点 / quieter / 安静点 / closer / 近一点 / faster service" as refinement constraints and injects them into `constraints_hint`. Last 4 conversation turns are passed to `parseRestaurantIntent` and `parseHotelIntent` so MiniMax can resolve "cheaper than what you showed me" without the user re-specifying location, cuisine, and party size.

### Fixed
- **Flight query misrouted to concert_event**: `\btickets?\b` in the concert_event NLU regex was matching "find cheapest ticket" for flight queries. Fixed by only triggering concert_event when no transport category is already detected (`!categoryHint` guard).
- **Concert venues not shown on map**: Ticketmaster venue lat/lng was parsed but not propagated through the `TicketmasterEvent → PlanOption` type chain. Extended `TmVenue`, `TicketmasterEvent`, and `PlanOption` types with `venue_lat`/`venue_lng`. `page.tsx` builds `concertVenuePins` from concert plan options and shows a map/list toggle.
- **`decision_plans` table missing before JOIN**: `GET /api/feedback-prompts` ran a JOIN against `decision_plans` without first calling `ensureDecisionPlansTable()`, causing a "relation does not exist" error in cold-start environments. Fixed by adding the ensure call before the JOIN.

## [0.2.22.0] - 2026-03-22

### Added
- **Phase 3.1 — Review semantic signal extraction**: `fetchReviewSignals()` in `lib/tools.ts` fetches structured signals from real user reviews for each restaurant candidate. For restaurants with Google reviews already attached, it skips the Tavily network call and uses them directly. For others, fetches Yelp/Reddit/TripAdvisor via Tavily (`search_depth: "advanced"`). MiniMax extracts `noise_level`, `wait_time`, `date_suitability` (1–10), `service_pace`, `notable_dishes`, `red_flags`, `best_for`, and `review_confidence`. Signals are injected into restaurant objects before `rankAndExplain`, making recommendation reasoning evidence-based.
- **Phase 3.2 — Structured scoring framework**: `computeWeightedScore()` in `lib/agent/composer/scoring.ts` replaces free-form AI scores with deterministic 5-dimension weighted scoring: scene_match (30%), budget_match (25%), review_quality (20%), location_convenience (15%), preference_match (10%), minus red_flag_penalty (0–5). AI fills raw dimension scores; system computes `weighted_total` and re-sorts candidates. Custom weights injectable per request. Fallback path (`buildFallbackRestaurantCards`) also uses the same scorer. `RecommendationCard` shows a collapsible "综合评分" breakdown panel with gold progress bars per dimension.
- **Test coverage for 3.1 and 3.2**: 28 new tests in `lib/__tests__/scoring-and-signals.test.ts` covering `computeWeightedScore` (edge cases, weight math, clamping, penalty), `ReviewSignalsSchema`, `ScoringDimensionsSchema`, `RankedItemArraySchema` with optional scoring, and `fetchReviewSignals` (empty list, JSON parse failure, valid signals, MiniMax error, Google reviews short-circuit).

## [0.2.21.0] - 2026-03-22

### Added
- **Fitness/wellness OS (5a-3)**: New `fitness` scenario — "find me a vinyasa yoga class in Brooklyn on Saturday morning under $25" routes through the full intent→plan pipeline. Parses 12 activity types (yoga with 8 style modifiers, pilates, spin, HIIT, CrossFit, boxing, dance, meditation, barre, swimming, running, martial arts), day/time/skill/budget preferences, and neighborhood. Google Places search returns up to 9 studios, ranked into three tiers: **Top rated** (highest ★), **Most popular** (most reviews), and **Best value** (good rating + lowest price). Each option gets a ClassPass booking deep link as the primary CTA, plus Mindbody and Google Maps secondary links. Budget filtering drops $$$ studios when budget < $20/class. Full bilingual (EN/ZH) support via `pickLanguageCopy`.

### Fixed
- City center bias in fitness Google Places search: resolved city coordinates from `CITIES` config and pass as `cityCenter` to prevent Places API from defaulting to San Francisco bias for out-of-area requests (Codex P1).
- No-result fitness responses now show a localized "no studios found" message (EN/ZH) instead of falling through to restaurant copy (Codex P2).
- MiniMax NLU schema now includes `concert_event`, `gift`, and `fitness` in `scenario_hint`, and `fitness` in `category_hint`, so non-English fitness queries correctly route to the fitness planner (Codex P2).

## [0.2.20.0] - 2026-03-22

### Added
- **Gift recommendation OS (5a-1)**: New `gift` scenario powered by SerpAPI Google Shopping. Ask "find a birthday gift for my girlfriend who loves hiking under $80" — the agent parses recipient, relationship, occasion, interests, and budget, then runs three parallel Google Shopping searches to return a `DecisionPlan` with three gift angles: **Safe pick** (crowd-pleasing, well-reviewed), **Most thoughtful** (personalised to their interests), and **Most creative** (unique surprise they wouldn't buy themselves). Each option includes a direct buy link, price, retailer, and rating. Falls back to a Google Shopping search URL when no direct product link is available. Full bilingual (EN/ZH) support with appropriate copy for all three tiers.
- **`lib/serpapi-shopping.ts`**: SerpAPI Google Shopping client — queries `engine=google_shopping`, parses product titles, prices, sources, links, images, ratings, and review counts. API key read inside the function (not at module level) for `vi.stubEnv` compatibility in tests.
- **`lib/agent/parse/gift.ts`**: Gift intent parser — detects occasion (birthday, anniversary, Christmas, Valentine's, Mother's Day, etc.), relationship (partner, parent, sibling, friend, colleague, boss, child), interests (cooking, hiking, gaming, fitness, reading, music, etc.), and budget via regex. Marks missing fields for `needs_clarification`.
- **`lib/agent/planners/gift.ts`**: Custom gift planner — builds three search queries (safe/thoughtful/creative) in parallel, maps the top result from each to a `PlanOption`, and assembles a `DecisionPlan` with tier-specific copy and refine actions.

### Fixed
- **Security: user_id trust boundary** (`app/api/chat/route.ts`): The `/api/chat` endpoint now derives `userId` from Clerk's server-side `auth()` instead of accepting it from the client JSON body, preventing privilege escalation via a spoofed user ID.
- **GPS city placeholder filtering** (`lib/agent/parse/concert-event.ts`): "your current location" (the GPS fallback display label) was being passed as a literal city name to Ticketmaster. It's now treated as missing — the planner falls back to a safe default city instead.
- **Date expression fallback for English queries** (`lib/agent/parse/concert-event.ts`): English fast-path queries skip MiniMax, leaving `date_text_hint` unpopulated. Expressions like "this weekend" or "tonight" now resolve correctly via a direct scan of the raw user message.

## [0.2.19.0] - 2026-03-22

### Added
- **Concert & event ticket OS (5a-2)**: New `concert_event` scenario powered by the Ticketmaster Discovery API. Ask "find me a Taylor Swift concert in NYC" or "jazz shows this weekend in Chicago" — the agent parses the intent (artist, genre, city, date, event type), queries Ticketmaster, and returns up to 3 events as a `DecisionPlan` with direct buy-ticket links, venue info, price ranges, and Google Maps venue links. Supports concerts, festivals, theater, sports, and comedy. Gracefully degrades to a follow-up prompt when no events are found. Full bilingual (EN/ZH) support.
- **`lib/ticketmaster.ts`**: Ticketmaster Discovery API client — searches by keyword, city, date range, and classification. Parses venues, price ranges, genres, and images from the API response. Handles API errors and network failures silently.
- **`lib/agent/parse/concert-event.ts`**: Regex + NLU-based intent parser — extracts artist names via proper-noun patterns, falls back to genre keywords (jazz, rock, indie, hip-hop, etc.), detects event type, resolves "this weekend" to a real date.
- **`lib/agent/planners/concert-event.ts`**: Custom planner that builds a `DecisionPlan` directly from Ticketmaster events — deduplicates by name, assigns tier labels (Top pick / Most exciting / Hidden gem), formats prices and datetimes, builds buy-ticket and venue map actions.

## [0.2.18.0] - 2026-03-22

### Added
- **User accounts + cross-device preference sync (4b-2)**: Sign in with Clerk and your learned preferences (noise sensitivity, budget, distance) follow you across devices. On sign-in, session preferences are merged server-side into your account via `POST /api/user/preferences/merge` (server-side Clerk auth only — the API never trusts a client-supplied `user_id`). Subsequent requests read preferences by `user_id` first so logged-in users always get personalized results.
- **Active push notifications (4b-3)**: You can now get a push notification when a watched price drops — even when the app is closed. Tapping "Watch prices" requests browser notification permission and stores a Web Push subscription server-side. The daily price-check cron fires a push to all subscribed sessions on confirmed drops. The service worker handles `push` events (shows the notification) and `notificationclick` events (focuses or opens the plan). Gracefully no-ops if VAPID keys are not configured or the subscription has expired.

### Fixed
- **`mergeSessionPreferences` unique constraint safety**: Signing in from two sessions that had the same preference key could violate the `(user_id, preference_key) WHERE user_id IS NOT NULL` unique index. Fixed by skipping keys the user already owns during the merge.

## [0.2.17.1] - 2026-03-22

### Fixed
- **After-dinner venue type filtering** (Codex P2): `searchAfterDinnerVenue()` now accepts a `venueType` param (`"cocktail"` | `"dessert"` | `"open"`) and narrows the Places API query accordingly. `lib/agent.ts` maps `follow_up_preference` to the correct type — users asking for dessert get dessert spots, not bars.
- **After-dinner search skips when no restaurant coords** (Codex P2): `searchAfterDinnerVenue()` returns `null` immediately when `nearCoords` is undefined, avoiding a hardcoded SF location bias and fabricated walk times for restaurants without coordinates.
- **CHANGELOG/TODOS accuracy**: corrected `after_dinner_option` field location (on `PlanOption`, not `DecisionPlan`) and documented `"walk"` skip condition.

## [0.2.17.0] - 2026-03-22

### Added
- **Date Night multi-venue chaining** (3b-3b): `searchAfterDinnerVenue()` in `lib/tools.ts` queries Google Places for a cocktail bar / wine bar / dessert café within 1km of the primary restaurant. Walk time is calculated via haversine at 80 m/min. `PlanOption` gains an optional `after_dinner_option?: AfterDinnerVenue` field (stored on the option so it travels correctly during backup promotion). `runScenarioPlanner` accepts and attaches the result to the primary plan; backup plans get no venue. `lib/agent.ts` searches before planning and skips when `follow_up_preference` is `"none"` or `"walk"`.
- **After-dinner venue rendering** in `PrimaryPlanCard`: a "Then →" section below the tradeoffs block shows the venue name, walk time, vibe description, and a Google Maps link. Supports English and Chinese (`然后 →`, `分钟步行`).
- **Decision language upgrade** (4a-1): `PrimaryPlanCard` detects `confidence === "high"` and switches to green border + "✓ Selected for you" label. `ScenarioBrief` shows "Your plan" (gold) vs "Scenario plan" for high-confidence plans. Confidence badge: green with checkmark for high, amber for medium, grey for low.
- **Collapsible backups** (4a-1): `ScenarioPlanView` starts with backups collapsed for high-confidence plans (`useState(plan.confidence !== "high")`). A toggle row shows "Show alternatives (N)" / "Hide alternatives (N)" with animated chevron.
- **3 new tests** in `scenario2.test.ts` covering `after_dinner_option` attachment, omission when absent, and omission when null.

## [0.2.16.0] - 2026-03-22

### Added
- **Add to Calendar — ICS route** (3b-2): `GET /api/plan/[id]/calendar` returns a RFC 5545–compliant `.ics` file with `VEVENT` populated from `DecisionPlan.event_datetime`, `event_location`, and the primary plan title. Returns 422 when `event_datetime` is missing.
- **Add to Calendar — Google Calendar deep links** (3b-2): `buildPlanOptionFromPackage` in the modular planner engine now appends a Google Calendar "Add to calendar" secondary action for trip packages when `startDate` is known. Computes check-in/check-out dates from `startDate + nights`.
- **15 tests** in `plan-calendar.test.ts` and `scenario2.test.ts` covering ICS content, error states, and event_datetime/event_location field population across planners.
- **Preference weight correction from negative feedback** (3d-1): `user_preferences` table (`session_id, preference_key, preference_value, confidence`) with `upsertUserPreference` and `getUserPreferences` helpers. `POST /api/feedback-prompts` maps structured feedback issues to preference keys: `too_noisy → noise_sensitivity:high`, `too_expensive → budget_sensitivity:high`, `too_far → distance_tolerance:low`.
- **Preference injection into NLU** (3d-1): `analyzeMultilingualQuery` accepts an optional `userPreferences` map. For English queries (fast-path, no MiniMax), learned preferences are injected directly into `constraints_hint`. For non-English queries, they are appended to the merged `constraints_hint` after MiniMax parsing. Constraints flow through to restaurant scoring via `UserRequirements.constraints`.
- **Session ID plumbing** (3d-1): `ChatRequestSchema` now accepts `session_id`; `app/api/chat/route.ts` extracts and passes it to `runAgent`; `runAgent` loads `getUserPreferences(sessionId)` from DB (graceful no-op on error) and passes preferences to NLU.
- **Unique index on `feedback_prompts(plan_id)`** prevents duplicate prompts from concurrent cron runs.
- **7 new tests** in `nlu.test.ts` covering preference injection for all three keys, multiple preferences, empty preferences, and the non-English (MiniMax) path.

## [0.2.15.0] - 2026-03-22

### Added
- **Restaurant availability deep links** (3c-2): date_night plans now include a "Check availability on OpenTable" secondary action on each option when no direct `opentable_url` is known. The link is a pre-filled OpenTable search for the restaurant by name with the party size from the intent (`covers=N`). When `opentable_url` is already present as the primary "Reserve" action, the secondary is omitted to avoid duplication.
- **3 new tests** in `scenario2.test.ts`: availability action present when no opentable_url, covers pre-filled from party_size, action absent when opentable_url already exists.

## [0.2.14.0] - 2026-03-22

### Added
- **Price drop alerts** (`price_watches` DB table + `POST /api/plan/[id]/price-watch` + `GET /api/cron/price-check`): "Watch prices" ActionRail button (weekend_trip and city_trip) saves the plan and registers the primary option's price as a watch. Daily cron re-queries SerpAPI for each watch and records a `price_drop_alert` in `plan_outcomes` when price drops ≥10%, then updates `last_known_price`. One watch per `item_key` per plan; upsert-on-change.
- **`watch_price` action type** (`PlanAction`): added to `lib/types.ts`, weekend trip and city_trip planner actions, and handled in `page.tsx` (fire-and-forget registration, optimistic toast).
- **`price_drop_alert`** added to `PlanOutcomeType`; validated in `/api/plan/[id]/outcome` allowlist.
- **12 new tests** in `price-watch.test.ts`: POST missing fields (×3), POST zero price, POST creates watch, POST skips existing; GET empty/populated; cron 401 (×2), cron no watches, cron skips null search_params.

## [0.2.13.0] - 2026-03-22

### Added
- **Group voting** (`plan_votes` DB table + `POST /api/plan/[id]/vote` + `GET /api/plan/[id]/vote`): share a plan in vote mode — friends visit `/plan/[id]?vote=true` and tap "Vote for this" on any option. Votes are tallied live with a progress bar per option (shows % and count). One vote per browser session, change-of-mind upserts update the tally. Share URL is generated by the new `send_for_vote` ActionRail action.
- **`send_for_vote` action type** (`PlanAction`): all 4 planners now include a "Send to friends" pill — saves the plan, sets `vote_mode: true` on the saved JSON, and copies a `?vote=true` share URL to clipboard.
- **`vote_mode?: boolean`** on `DecisionPlan`: persisted in `decision_plans.plan_json` so the share page knows to render vote UI instead of the single-partner approval flow.
- **`ensurePlanVotesTable`** (`lib/db.ts`): idempotent CREATE TABLE with unique index on `(plan_id, voter_session)` — one vote per session enforced at DB level.
- **7 new tests** in `plan-votes.test.ts`: GET empty tally, GET aggregated tally, POST missing fields (×2), POST records vote + tally, POST upsert (change of mind), POST invalid JSON.

## [0.2.12.0] - 2026-03-22

### Added
- **`show_more_available` flag** (`DecisionPlan`): all 4 planners now set `show_more_available: boolean` — `true` when more than 2 backup options were found but capped for display. `ScenarioPlanView` renders a soft hint below the backup section when `true` — "More options available — tell me your preferences and I can surface more" — inviting refinement instead of overwhelming with options.
- **2 new tests** covering `show_more_available` true/false in `runScenarioPlanner` (date night) and `runBigPurchasePlanner`

## [0.2.11.0] - 2026-03-22

### Added
- **Post-experience feedback capture** (`feedback_prompts` table + cron + in-app card): 24h after a plan's event date, users see a dismissible card — "How was your dinner at X?" — with quick-tap options (✅ Great / ⚠️ OK but… / ❌ Didn't go). "OK" expands to structured issue tags (too noisy, too expensive, too far, bad service). Responses are stored in `plan_outcomes` with `outcome_type: "post_experience_feedback"` and structured metadata for the learning loop.
- **`feedback_prompts` DB table** (`ensureFeedbackPromptsTable` in `lib/db.ts`): tracks scheduled, sent, and responded state per plan per session — prevents duplicate prompts
- **`GET /api/cron/feedback-prompts`**: CRON_SECRET-protected route that finds `decision_plans` with `event_datetime` 20–28h ago and inserts `feedback_prompts` rows for plans that haven't been prompted yet
- **`GET /api/feedback-prompts`** + **`POST /api/feedback-prompts`**: in-app endpoints for fetching pending prompts by session and recording responses (marks prompt as responded + inserts `plan_outcomes` row)
- **`FeedbackPromptCard` component** (`components/FeedbackPromptCard.tsx`): two-step dismissible card — rating step (3 buttons) → optional issues step (tag pills) → auto-dismisses on response
- **`post_experience_feedback`** added to `PlanOutcomeType`; also added `FeedbackRating`, `FeedbackIssue`, `PostExperienceFeedback` types to `lib/types.ts`
- **14 new tests** covering cron route (401/created/skipped), GET prompts (400/empty/venue_name/fallback), POST response (400-invalid/great/ok+issues/did_not_go)

## [0.2.10.0] - 2026-03-22

### Added
- **Trip brief export** (`export_brief` action + `GET /api/plan/[id]/brief`): saves the plan then serves a clean `.md` download containing the primary plan details, estimated total, location, when, highlights, key risks, backup options, and optional card callout — renders in any markdown viewer and is mobile-readable
- **`buildPlanBrief`** (`lib/agent/planners/plan-brief.ts`): pure function that assembles the markdown from any `DecisionPlan` (date_night, weekend_trip, city_trip, big_purchase) — no external API calls
- **`export_brief` action type** added to `PlanAction` type union; added as first action in `buildWeekendTripActions` (weekend_trip) and `buildDefaultActions` (city_trip modular planner)
- **`export_brief` handler** in `page.tsx`: saves the plan then opens the brief URL in a new tab
- **18 new tests**: 13 unit tests for `buildPlanBrief` (all scenarios, optional fields) + 5 route tests for `GET /api/plan/[id]/brief` (400/404/200, content-type, content-disposition, body)

## [0.2.9.0] - 2026-03-22

### Added
- **Credit card trip callout** (`trip_card_callout` on `DecisionPlan`): weekend_trip and city_trip plans now surface a one-line credit card recommendation — "Pay with Chase Sapphire Preferred ($95/yr) — earns 3x on travel and dining · sign-up bonus worth ~$750" — surfaced as a subtle strip below the primary plan card in `ScenarioPlanView`
- **`getBestCardForTrip`** + **`buildTripCardCallout`** (`lib/agent/planners/trip-card.ts`): new helpers that build a travel spending profile from trip costs (flight + hotel spread over 3 months), call `recommendCreditCards` with travel reward preference, and format a concise callout string in English or Chinese
- **14 new tests**: 10 unit tests for `getBestCardForTrip`/`buildTripCardCallout` in `trip-card.test.ts` + 4 integration tests in `scenario2.test.ts` verifying `trip_card_callout` presence and language on `weekend_trip` and `city_trip` plans

## [0.2.8.0] - 2026-03-22

### Added
- **Add to Calendar action** (`event_datetime`, `event_location` on `DecisionPlan`): all three planners (date_night, weekend_trip, city_trip) now populate a structured event datetime and location when date is known — enabling `.ics` export and calendar deep links
- **ICS calendar route** (`GET /api/plan/[id]/calendar`): returns a standards-compliant RFC 5545 `.ics` file with floating local time — works with Google Calendar, Apple Calendar, and Outlook
- **Share page calendar download** (`SharedPlanView.tsx`): "Add to Calendar (.ics)" download button appears on the share page when `event_datetime` is set, letting plan recipients save the event to any calendar app
- **City trip Google Calendar link**: `buildPlanOptionFromPackage` now adds a "Add to calendar" secondary action (Google Calendar deep link) for each city_trip option when `startDate` is known — links to hotel check-in event
- **15 new tests**: 8 tests in `scenario2.test.ts` covering `event_datetime`/`event_location` for all three scenario types + 7 tests in `plan-calendar.test.ts` covering the ICS route (404, 422, content-type, body structure, DTSTART, Content-Disposition)

## [0.2.7.0] - 2026-03-22

### Added
- **Pre-filled booking deep links** (`lib/agent/planners/booking-links.ts`): new URL builders for Google Hotels, Booking.com, Google Flights, and OpenTable — all landing on filtered results pages with dates, guests, and city pre-filled. Weekend trip planner now generates a Booking.com hotel URL and Google Flights deep link (`#flt=JFK.ORD.YYYY-MM-DD`) from parsed intent data; falls back to existing `booking_link` when intent lacks dates
- **Check-in gap feasibility** (`buildWeekendTripTimingNote`, `buildWeekendTripRisks`): `arrival_time` is now parsed (HH:MM) and compared against the standard 15:00 hotel check-in time — timing notes now read "5h before check-in" or "room should be ready on landing"; risk flags added for early arrival (>3h gap), tight window (<2h gap), and late-night (≥22:00) arrivals
- **29 new tests**: 14 unit tests for `booking-links.ts` URL builders + 15 integration tests covering check-in gap timing notes, risk flags, and pre-filled URL generation in `runWeekendTripPlanner`

## [0.2.6.0] - 2026-03-22

### Added
- **Comparative tradeoff summary** (`tradeoff_summary`): all 4 scenario planners (date_night, weekend_trip, city_trip, big_purchase) now generate a 1–2 sentence plan-level summary explaining why the primary is the default pick and what each backup trades off — rendered between the primary card and the backup section in `ScenarioPlanView`
- **Phase 3 TODOS**: added comprehensive Phase 3 implementation backlog (3a Decision Compression → 3b Execution Layer → 3c Monitoring → 3d Learning Loop) to TODOS.md

### Fixed
- **Planner-engine `tradeoff_summary` passthrough** (`lib/agent/planner-engine`): added `tradeoff_summary` to `EngineConfig` so city_trip config can supply its own comparative text

## [0.2.5.0] - 2026-03-22

### Added
- **ActionRail mobile scroll**: pill row now scrolls horizontally on mobile with a right-edge fade gradient hint — all actions stay reachable without wrapping
- **SSE stream timeout**: agent requests now time out after 45 seconds server-side; a client-side 50-second stall watchdog cancels hung streams with a clear retry message

### Fixed
- Fixed test fixtures for `MultilingualQueryContext` and `LaptopRecommendationCard` to match their interface shapes

## [0.2.4.0] - 2026-03-22

### Added
- **Big Purchase OS** (`big_purchase` scenario): routes laptop, headphone, and smartphone queries through a new decision planner that produces one clear primary recommendation + up to 2 backup alternatives — no more comparing specs across 10 cards
- **Execution Deep Links** (`open_link` PlanAction type): surfaces Amazon purchase links and other secondary actions (Maps, Calendar, hotel/flight booking) from all scenario planners into the ActionRail as clickable buttons — first link gets solid gold background, others get gold outline
- **`parseBigPurchaseIntent`** + **`runBigPurchasePlanner`**: new planners in `lib/agent/planners/big-purchase.ts` that extract product category, budget, OS preference, and use case from natural language, then build a `DecisionPlan` reusing existing laptop/headphone/smartphone pipelines
- **`mapLinksToOpenLinkActions`** utility (`lib/agent/planners/utils.ts`): shared helper that converts `PlanLinkAction[]` to `PlanAction[type="open_link"][]` with outcome tracking
- **BackupPlanCard tradeoff rendering**: when `tradeoff_reason` is set, it replaces the label; `tradeoff_detail` replaces the summary — backup cards now explain the trade-off instead of showing a generic "Backup 1" label
- **20 new tests** covering `detectScenarioFromMessage` big_purchase detection, `parseBigPurchaseIntent`, and `runBigPurchasePlanner` across null/valid/budget/category/language/tradeoff scenarios

### Changed
- **ActionRail** now owns execution deep links exclusively — `PrimaryPlanCard` no longer renders `secondary_actions`, preventing duplicate link rendering
- `detectScenarioFromMessage`: big_purchase detection added at lowest priority (after city_trip, weekend_trip, date_night), triggered by product category keyword + budget signal or purchase intent verb

## [0.2.3.0] - 2026-03-22

### Added
- **Share page** (`/plan/[id]`): read-only plan view for sharing with a partner — renders primary plan, backup options, and a "This works for me" approval button
- **Partner approval API** (`POST /api/plan/[id]/outcome`): records `partner_approved` outcome to `plan_outcomes` table; GET variant supports calendar deep-link outcomes (`?type=went`)
- **Plan save/fetch API** (`POST /api/plan/save`, `GET /api/plan/[id]`): persists `DecisionPlan` to `decision_plans` table; share action in the main UI saves plan and copies shareable URL
- **Refinement lineage** (`parent_plan_id`): when you refine a plan, Onegent now tracks which plan it came from — enabling full refinement chains and future analysis of whether refining led to better outcomes
- **Venue intelligence** (`getScoreAdjustments`): real user outcomes now power a recency-weighted venue ranking model (30-day decay); activate with `ENABLE_SCORE_ADJUSTMENTS=true` once ≥30 days + ≥100 outcomes have been recorded

### Fixed
- **Test type errors**: fixed pre-existing TypeScript errors in `getScoreAdjustments.test.ts` (`"group_dinner"` → `"big_purchase"`), `scenario2.test.ts` (`"vibrant"` → `"mixed"`, missing `scenario_goal`), and `plan-outcome.test.ts` (QueryResult mock types)

## [0.2.2.0] - 2026-03-22

### Added
- **City trip scenario** (`city_trip`): new scenario that builds 3 tiered packages (Upscale / Trendy / Local vibe) combining hotel + restaurant + bar recommendations for multi-night city visits — ask things like "3 nights in Tokyo, want great food and nightlife"
- **Modular planner engine** (`lib/agent/planner-engine/`): generic tiered-package engine that can power any trip scenario; replaces per-scenario boilerplate with configuration — new scenarios now only need an `EngineConfig` factory instead of 400+ lines of custom code
- **City trip NLU detection**: `detectScenarioFromMessage` now recognizes city trip queries (destination + hotel + activities) and routes to the `city_trip` planner; includes priority logic to prefer `weekend_trip` when flight signals are present
- **City trip clarification flow**: when the agent needs more info (missing destination, dates, etc.), users now see a clear "I need one or two more details" message instead of silent fallthrough
- **City Trip analytics filter tab**: internal analytics dashboard now has a City Trip filter alongside Date Night, Weekend Trip, and Big Purchase

### Fixed
- **Analytics scenario filter** (`lib/scenarioEvents.ts`): `city_trip` was missing from `VALID_SCENARIOS` set — analytics queries filtered by city_trip scenario returned nothing silently; now included

## [0.2.1.1] - 2026-03-21

### Fixed
- **Telemetry scenario validation** (`app/api/telemetry/route.ts`): scenario events were written to DB without server-side validation of the `scenario` field — any client could insert arbitrary strings, silently corrupting `GROUP BY scenario` analytics queries; now validated against `VALID_SCENARIO_TYPES` allowlist before insert

## [0.2.1.0] - 2026-03-21

### Added
- **Agent sub-module split** (`lib/agent/`): extracted parsers, pipelines, and planners into 21 focused modules (`parse/`, `pipelines/`, `planners/`, `composer/`) — `lib/agent.ts` is now a thin orchestrator
- **ScenarioPlanView component** (`components/ScenarioPlanView.tsx`): consolidated scenario plan rendering (ScenarioBrief + PrimaryPlanCard + BackupPlanCard + ActionRail + ScenarioEvidencePanel) into one composable component

### Fixed
- **DB singleton reset on transient failure** (`lib/db.ts`): `ensureScenarioEventsTable` cached rejected Promises permanently — now resets on failure so the next call retries
- **Weekend trip detection false positive** (`lib/scenario2.ts`): hotel-only or flight-only queries ("find a hotel this weekend") no longer trigger the trip-package flow — requires BOTH flight AND hotel signals
- **Near Me mode departure city** (`lib/agent.ts`): passed `"your current location"` as flight departure instead of the real city name — weekend trip flight search now uses `city.fullName`
- **Stale scenario brief after backup promotion** (`app/hooks/useChat.ts`): `swapDecisionPlanOption` spread stale `scenario_brief`, `risks`, and `evidence_items` from the original primary plan — now reset on swap
- **SW navigation caching** (`public/sw.js`): all navigation responses were cached under `"/"`, overwriting the app shell with any page response — now only caches root navigations
- **Duplicate trip packages in limited inventory** (`lib/scenario2.ts`): `runWeekendTripPlanner` deduplicated flight+hotel combos before building backup plans — no more identical packages with different labels
- **Analytics access control** (`lib/scenarioEvents.ts`): when `INTERNAL_ANALYTICS_USER_IDS` env var was unset, any signed-in user could access raw analytics — now denies all access when allowlist is empty
- **Vitest picking up .claude/ worktrees** (`vitest.config.ts`): added exclude for `**/.claude/**` to prevent gstack internal tests and worktree snapshots from being included in test runs

### Changed
- **app/page.tsx**: replaced 5 individual scenario component imports with `ScenarioPlanView`

## [0.2.0.0] - 2026-03-21

### Added
- **Scenario decision engine** (`lib/scenario2.ts`, 1439L): `detectScenario`, `detectScenarioFromMessage`, `parseScenarioIntent`, `runScenarioPlanner` (date_night), `runWeekendTripPlanner` — full SSE-streaming scenario pipeline
- **Weekend trip planner**: 3-option DecisionPlan (stable/value/experience) from parallel hotel + flight searches
- **Date night planner**: `DecisionPlan` with backup options from restaurant search + scoring
- **NLU layer** (`lib/nlu.ts`): `analyzeMultilingualQuery` with MiniMax-backed multilingual support and English fast-path (skips API for pure English queries)
- **MiniMax client** (`lib/minimax.ts`): shared chat helper with configurable timeout (30s default, 60s for hotel ranking)
- **Internal analytics** (`app/api/internal/scenario-events/`, `lib/scenarioEvents.ts`): `GET /api/internal/scenario-events` with query parsing, days/limit clamping, Clerk-gated access
- **Internal analytics UI** (`app/internal/scenario-events/`): Clerk-gated analytics dashboard page
- **Scenario components**: `ActionRail`, `PrimaryPlanCard`, `BackupPlanCard`, `ScenarioBrief`, `ScenarioEvidencePanel`
- **Telemetry** (`app/api/telemetry/`): `plan_approved`, `option_swap`, `action_rail_click` events with DB persistence
- **TODOS.md**: P2 backlog items for `lib/agent.ts` split and `ScenarioPlanView` extraction
- **90 tests** across 5 test files covering all new code paths

### Changed
- `app/api/chat/route.ts`: SSE pipeline branches on `resultMode` — `scenario_plan` routes to scenario engine, `category_cards` preserves existing pipeline
- `app/page.tsx`: renders `ScenarioBrief + PrimaryPlanCard + ActionRail` for scenario_plan mode alongside existing card list
- `lib/agent.ts`: `parseIntent` now respects `scenario_hint` from NLU context; `detectCategory` uses `category_hint` fast-path
- `lib/types.ts`: added `DecisionPlan`, `PlanOption`, `ActionItem`, `ScenarioContext`, `WeekendTripIntent`, `DateNightIntent`, `FlightRecommendationCard`, `HotelRecommendationCard`

### Fixed
- **MiniMax timeout** (`lib/minimax.ts`): global timeout raised 8s→30s; hotel ranking uses 60s to prevent pipeline hangs
- **False weekend_trip detection** (`lib/scenario2.ts`): "round trip flights" and "business trip hotel" queries now correctly route as `flight`/`hotel`, not `weekend_trip` (regression ISSUE-002)
- **Open analytics in production** (`lib/scenarioEvents.ts`): `requireInternalAnalyticsAccess` now returns 403 in production when Clerk is not configured (security fix, ISSUE-002-security)
- **English NLU latency** (`lib/nlu.ts`): English queries skip MiniMax call entirely — ~300ms saved per query (ISSUE-004)
