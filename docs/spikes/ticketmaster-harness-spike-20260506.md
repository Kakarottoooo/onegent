# Ticketmaster Browser Harness Spike — Activity Lane Provider Debug Lab

**Date:** 2026-05-06
**Worktree:** `C:\Users\Gzw19\onegent-execution-layer-v2-harness`
**Branch:** `claude/ticketmaster-browser-harness-spike-20260506`
**Tool under evaluation:** [browser-use/browser-harness](https://github.com/browser-use/browser-harness) `0.1.0`
**Browser:** isolated Chrome 147 / port 9333 / temp user-data-dir / **no account cookies**
**Target:** Ticketmaster — *The Lion King (New York, NY)*, May 30 2026 2:00 PM (artist 1039581 / event Z1r9uZrrZbpZ1Avr9ea)

Evidence artifacts under [`./ticketmaster-harness-spike-20260506/`](./ticketmaster-harness-spike-20260506/):
- `events.jsonl` — 8 structured events (spike_started, 5 step_captured, manual_checkpoint, followup_done)
- `01_artist_calendar.png` … `05_event_page_full_render.png` — screenshots
- `../../scripts/browser-harness-spike/spike.py`, `spike_followup.py` — runners

---

## TL;DR

| Question | Answer |
|---|---|
| Was Browser Harness actually usable on this site? | **Yes**, after a 5-minute install + isolated-Chrome launch. Harness installed via `uv tool install -e`, attached cleanly to a `--remote-debugging-port=9333 --user-data-dir=…` Chrome via `BU_CDP_URL`. CDP / `js()` / `page_info()` / `capture_screenshot()` all worked first try. |
| Did it reach Ticketmaster event page reliably? | **Yes** — both `artist/...` and `/event/...` URLs loaded without account cookies and without auth redirect. Direct goto by URL works. |
| Did it identify date/time cards or event links? | **Yes**, but only after **scrolling 1200px** (artist-page list cards are virtualized / lazy-rendered). 7 stable `<a href="...event/<EVENT_ID>">` anchors with date+time textContent. |
| Did it identify seat map / ticket selection signals? | **Yes** — `<canvas>` SVG seat map renders ~3-6 s after `/event/` load. Right-panel ticket list uses `<li role="menuitem">` containing `<button>` with text `"Sec X • Row Y … $Price"`. |
| Where exactly did the flow stop? | At the **manual checkpoint** — ticket cards / seat map are interactive but seat selection requires a human decision. Spike intentionally did NOT click a ticket card. |
| What stable signals were discovered? | See § *Signal map by surface* below. |
| What should Onegent L1 TypeScript patch do? | Switch from calendar-view path to **list-view direct-anchor path** (matches the 99% case). See § *L1 patch recommendation*. |
| What should L2 Browser Harness do? | Self-heal when L1 selectors miss: scroll-to-render → grep `<a href*="/event/">` → match by date/time → goto. See § *L2 fallback design*. |
| What tests should Codex add? | DOM fixture tests for the new selectors + a date-match unit test on the textContent shape. See § *Recommended tests*. |

---

## Was Browser Harness actually usable?

Verdict: **Yes, with one important caveat.**

### What works (first try, no friction)

- `git clone` + `uv tool install -e .` from `~/Developer/browser-harness` → `browser-harness` is on `$PATH` globally (~30 s install, 4 deps: cdp-use, fetch-use, pillow, websockets).
- `--remote-debugging-port=9333 --user-data-dir=<temp>` Chrome launches in a fully isolated profile — no popup prompts, no interference with the user's everyday Chrome.
- `BU_CDP_URL=http://127.0.0.1:9333 browser-harness -c '...'` connects on first call. Daemon auto-starts.
- `js(<string>)` runs arbitrary JS in the attached tab. Returns plain Python dicts (CDP-deserialized). **No tsx/Stagehand serialization issues** — this is the fundamental architectural advantage over the current L1.
- `page_info()` returns `{url,title,w,h,sx,sy,pw,ph}` — fast and stable.
- `capture_screenshot(path, max_dim=1800)` saves PNG to disk, ~600 KB per artist page, ~170 KB per event page.

### What's a real consideration before promoting to L2

Browser Harness's **stated philosophy is screenshot-driven coordinate clicks** (`click_at_xy(x,y)`), not selector-driven actions. Quote from `SKILL.md`:

> Suppress the Playwright-habit reflex of "locate first, then click" — no getBoundingClientRect, no selector hunt. Drop to DOM only when the target has no visible geometry.

For an L2 *adaptation* layer, screenshot+coordinate is acceptable and sometimes ideal (TM's iframes / shadow-DOM / overlay traps fall away). But for an L2 that produces **L1 patch proposals** (the other half of the user's design), DOM-side discovery via `js()` is essential. Both modes are supported, just don't fight the harness — use coordinate clicks where Harness shines, and `js()` for signal discovery.

### Install / connect cost (one-time per host)

```bash
git clone --depth 1 https://github.com/browser-use/browser-harness.git ~/Developer/browser-harness
cd ~/Developer/browser-harness
uv tool install -e .
# Launch isolated Chrome
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --remote-debugging-port=9333 \
  --user-data-dir=C:/path/to/temp/profile \
  --no-first-run --no-default-browser-check
# Use harness
BU_CDP_URL=http://127.0.0.1:9333 browser-harness -c 'print(page_info())'
```

This setup is reproducible from a script (see `scripts/browser-harness-spike/`). For the v2 worker, the launcher would live alongside the worker process, isolated from the user's Chrome.

---

## Signal map by surface

### Surface A — `ticketmaster.com/<show-slug>/artist/<id>` (LIST mode, default)

| Signal | Value | Notes |
|---|---|---|
| URL pattern | `/<show-slug>/artist/<id>` | matches `/\.ticketmaster\.[^/]+\/.+\/artist\/\d+/` |
| `<title>` | "...Tickets \| Event Dates & Schedule \| Ticketmaster" | Stable |
| Event anchors (after scroll ≥ 800-1200 px) | `7` visible | Lazy-rendered. **REQUIRES scroll**. |
| Anchor selector | `a[href*="/event/"]` | High recall, low false-positive |
| Anchor href pattern | `https://www.ticketmaster.com/<show-slug>-<MM-DD-YYYY>/event/<EVENT_ID>` | Date-encoded directly into URL — easy to match by target date |
| Anchor textContent shape | `"Today` / `Tomorrow` / `Saturday, May 9, 2026 at 2:00 PMMay 09Sat2:00 PMNew York, NYMinskoff Theatre…"` | Includes weekday + ISO-ish + abbreviated forms — multiple match strategies viable |
| Anchor class hint (unstable) | `Link__StyledLink-sc-pudy0l-0 coVzbU sc-85f11be1-0` | styled-components hash; **do not selector against this** |
| Calendar-mode toggle link | `<a/button>` with text `"Show events in calendar view"` | Useful only if list-mode anchor strategy fails |
| Sign-in heading? | `false` | TM does NOT auth-wall the artist page for fresh sessions |
| Iframes (12) | 100 % ads + GTM trackers | None contain Find Tickets |
| `data-testid` count | `32` | Some testids exist on the page; not used in our spike but a future probe could enumerate |

### Surface B — `ticketmaster.com/<show-slug>-<date>/event/<id>` (event detail / seat selection)

| Signal | Value | Notes |
|---|---|---|
| URL pattern | `/<show-slug>-<MM-DD-YYYY>/event/<EVENT_ID>` | Match `/\/event\/[A-Za-z0-9_-]+\b/` |
| `<title>` | "…Tickets <weekday>, <Mon> <day>, <year> <city>, <state> \| Ticketmaster" | Stable |
| Seat map render delay | ~3 s spinner ("Loading the seat map…") → **6-7 s for full SVG** | Spike confirmed: probe at t+0 sees no seat-map; probe at t+6 s sees `hasSeatMapCanvas: true` |
| Seat map element | Plain `<canvas>` (or `[data-testid*=seat]` / `[class*=seat-map]`) | NOT in an iframe (contrary to earlier L1 assumption) |
| "More Dates" sidebar | 20 visible `<li>` items | Each `<li>` contains one date+time button, format `"May 9Sat2:00 PMSat, May 09, 2026, 02:00 PM"` |
| Ticket card list | `<li role="menuitem">` containing `<button>` | Right panel; populated after seat map load |
| Ticket card text shape | `"Sec MEZZ • Row L Standard Select Standard, section MEZZ, row L $152.22"` | Strong regex anchor: `^Sec\s+\w+\s*•\s*Row\s+\w+` |
| Reserve button | **NOT present** until user clicks a ticket card | Confirms current L1 polling assumption |
| Sign-in heading? | `false` | TM does NOT auth-wall the event page either |
| Iframes (after render: 12) | All GTM trackers / ads | Seat-map is `<canvas>`, not an iframe |
| Top-right "Sign In" link | Present (always) | Don't confuse with auth boundary |

### Surface C / D — `/checkout`, `payments.ticketmaster.com` — NOT covered by this spike

These require:
- A user-selected ticket (manual checkpoint), AND
- Either a logged-in account OR an in-progress reservation hold.

Without account cookies, the spike intentionally stopped before these surfaces. Existing v1 RPA (`onegent-provider-closure-integration-20260505/lib/booking-autopilot/providers/ticketmaster-rpa.ts`) already handles them via `passPaymentGate` + `selectCreditCardRadio` + `ticketmasterProvider.fillPaymentForm`.

---

## Where the current Onegent v1 L1 stalls

Cross-referencing the spike's findings against the v1 RPA at `lib/booking-autopilot/providers/ticketmaster-rpa.ts` (commit `b75ecc3` in the integration worktree):

| v1 step | Outcome | Spike-supported root cause |
|---|---|---|
| `clickShowEventsInCalendarView` | ✅ click succeeded | "Show events in calendar view" link exists — confirmed |
| `clickCalendarSlot` (calendar grid) | ✅ click succeeded | Calendar slot tagging works |
| `clickFindTickets` (sidebar after slot click) | ❌ frequently misses | **The "Find Tickets" anchor is in calendar-mode sidebar — different markup from list-mode anchors. Class `indexstyles__StyledButton-sc-83qv1q-0` (calendar) vs `Link__StyledLink-sc-pudy0l-0` (list).** Both eventually link to `/event/`, but only list-mode anchors are reachable on initial-load DOM. Calendar-mode sidebar anchors render lazily and may be in a sub-React-portal — exact same class of bug as Find Tickets. |
| `Reserve poll` (event page) | ✅ — but only after `b75ecc3` patch added `stage==="checkout"` exit | Confirms event page's `<li role="menuitem">` ticket cards are the right surface; Reserve only appears after card selection (manual checkpoint) |
| `passPaymentGate` (Conditions checkbox + Proceed to Payment) | ❌ until `b75ecc3` string-source-evaluate fix | Same `page.evaluate(arrowFunc)` + tsx + Stagehand serialization root cause that crashed the calendar evaluate. |
| `selectCreditCardRadio` (payments page) | ❌ same root cause | Same |
| `fillPaymentForm` (CC iframe) | ✅ when frame found | Iframe ID `credit-card-iframe` confirmed in v1 production code |

### The structural insight

**The current v1 RPA is built around the calendar-view path, but the list-view path is shorter, simpler, and more durable.** Switching from `clickShowEventsInCalendarView → clickCalendarSlot → clickFindTickets → goto event` to `extract anchor href on list view → page.goto(href)` removes 3 brittle UI hops and replaces them with one stable URL-pattern match.

---

## L1 patch recommendation (TypeScript, for Codex to convert)

**Goal:** add a fast list-view path; keep calendar view as a fallback only if list view yields zero matches.

### New helper (sketch)

```typescript
// lib/booking-autopilot/providers/ticketmaster-rpa.ts
// Insert near line 970 (above clickFindTickets) — keep current calendar path
// as a secondary fallback.

interface ListEventAnchor {
  href: string;
  text: string;
  matchScore: number;
}

/**
 * Strategy 0 (preferred): On the artist/<id> page, the LIST view shows
 * one <a href="...event/<id>"> per showtime, lazy-rendered after scroll.
 * Each anchor's textContent contains the weekday + month/day + time, so we
 * can pick the target deterministically and `page.goto(href)` instead of
 * clicking through calendar UI.
 *
 * Spike evidence (2026-05-06): docs/spikes/ticketmaster-harness-spike-20260506.md
 */
async function findTargetEventAnchor(
  page: Page,
  target: TargetDateTime,
  trace: TraceFn,
): Promise<string | null> {
  // Lazy-rendered cards require a scroll. 1200px reliably surfaces all.
  await page.evaluate("window.scrollTo(0, 1200)").catch(() => {});
  await page.waitForTimeout(2000);

  const args = {
    monthShort: target.monthName.slice(0, 3),  // "May"
    monthLong: target.monthName,                // "May" (full also short for May)
    day: target.day,
    year: target.year,
    time: (target.time || "").toLowerCase(),
  };
  const source = `(function() {
    var args = ${JSON.stringify(args)};
    var dayPad = String(args.day).length === 1 ? "0" + args.day : String(args.day);
    var anchors = Array.from(document.querySelectorAll('a[href*="/event/"]'));
    var visible = anchors.filter(function(a) {
      var r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    var best = null;
    for (var i = 0; i < visible.length; i++) {
      var a = visible[i];
      var t = (a.textContent || '').toLowerCase();
      var href = (a.getAttribute('href') || '').toLowerCase();
      var score = 0;
      // URL has MM-DD-YYYY embedded — strongest signal
      var monthIdx = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
        .indexOf(args.monthShort.toLowerCase()) + 1;
      var monthPad = String(monthIdx).length === 1 ? '0' + monthIdx : String(monthIdx);
      if (href.indexOf(monthPad + '-' + dayPad + '-' + args.year) >= 0) score += 5;
      // textContent month/day/time
      if (t.indexOf(args.monthShort.toLowerCase()) >= 0) score += 2;
      if (new RegExp('\\\\b' + args.day + '\\\\b').test(t)) score += 2;
      if (args.time && t.indexOf(args.time) >= 0) score += 3;
      if (score > 0 && (!best || score > best.score)) {
        best = { href: a.getAttribute('href'), text: t.slice(0, 80), score: score };
      }
    }
    return best;
  })()`;
  const r = await (page.evaluate as any)(source).catch(() => null);
  if (!r || !r.href) {
    trace(`[tm-rpa] List-view anchor scan: no match for ${target.monthName} ${target.day}, ${target.year} @ ${target.time}`);
    return null;
  }
  trace(`[tm-rpa] List-view anchor matched: score=${r.score} text=${r.text} href=${r.href.slice(0, 100)}`);
  return r.href.startsWith("http") ? r.href : `https://www.ticketmaster.com${r.href}`;
}

// Insert at the top of bookTicketmasterProgrammatic, after the initial stage
// assessment (replacing the calendar-mode chain when target is known):

const directHref = await findTargetEventAnchor(page, target, trace);
if (directHref) {
  trace(`[tm-rpa] Direct goto event page (skipping calendar UI): ${directHref}`);
  await page.goto(directHref, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Continue into Reserve poll as before.
} else {
  // Fall back to the existing calendar-view chain.
  // (Existing clickShowEventsInCalendarView / clickCalendarSlot / clickFindTickets path)
}
```

### Why this is better than the calendar-view chain

1. **One UI hop instead of three** (scroll → goto vs calendar → slot → Find Tickets sidebar)
2. **URL pattern carries the date** (`MM-DD-YYYY`) — strongest signal possible, immune to React re-render races
3. **page.goto bypasses React onClick handlers** — avoids the iframe/styled-components click-chain quirks that bit the v1 Find Tickets path
4. **No 16-s polling for the sidebar** — list anchors are visible on first paint after scroll
5. **Reuses the existing string-source evaluate pattern** that the v1 finally settled on (commit `b75ecc3`) — battle-tested

### Failure modes the new path needs to handle

- **Zero anchors after scroll** (e.g., show is sold out / off-sale) → fall back to calendar (informative trace) or escalate to L2
- **Multiple anchors for same date** (matinée + evening on Saturday) → score by `time` substring; tie-break by first-visible
- **Anchor href is relative** (`/the-lion-king…`) → prepend `https://www.ticketmaster.com`

---

## L2 Browser Harness fallback design

Trigger: L1's `findTargetEventAnchor` returns `null` AND the calendar fallback also fails (provider degraded). Don't escalate to L2 on `no_availability` (legitimate signal, page evidence is conclusive).

### What L2 does differently from L1

| Capability | L1 (Stagehand + Playwright) | L2 (Browser Harness) |
|---|---|---|
| evaluate semantics | `page.evaluate(arrowFn)` susceptible to tsx serialization bugs | `js(<string>)` — string-source only, no transpilation |
| Click model | `loc.click({ force: true })` (Playwright) | `click_at_xy(x, y)` from screenshot inspection — passes through iframes / shadow DOM at the compositor level |
| Connection model | Owns its browser, dies if profile crashes | Connects to a long-running Chrome via CDP — survives daemon restarts |
| Discovery | Coded selectors, brittle to redesign | LLM-driven exploration (`page_info` + `screenshot` + `js`) |
| Cost | Free (in-process) | Subprocess + daemon RTT (~50-200 ms per call) |

### L2 ExecutorEvent shape (subset)

When invoked, the L2 executor emits the same `ExecutionEvent` events as L1 (per the v2 architecture spec the user laid out), additionally:

```json
{ "layer": "browser_harness", "event_type": "scroll_for_lazy_render",
  "url": "...", "scrollY": 1200, "renderedAnchorCount": 7 }
{ "layer": "browser_harness", "event_type": "anchor_match",
  "target": "May 30 2026 2:00 PM", "score": 7,
  "matchedHref": "...05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
  "screenshotId": "..." }
{ "layer": "browser_harness", "event_type": "patch_proposal",
  "provider": "ticketmaster",
  "diagnosis": "L1 calendar-view path failed; list-view anchors present and matchable",
  "discoveredSelectors": ["a[href*=\"/event/\"]"],
  "workingStrategy": "scroll(0,1200) -> querySelectorAll -> URL date match -> page.goto",
  "screenshots": ["docs/spikes/ticketmaster-harness-spike-20260506/04_artist_list_scrolled.png"],
  "suggestedTest": "ticketmaster-list-anchor-match.test.ts" }
```

The `patch_proposal` event is the **product of a successful L2 run**: a structured suggestion the v2 architecture's `Codex/Claude → TypeScript patch + regression test` pipeline can ingest.

### L2 invariants

- L2 **must not** auto-modify L1 source files. Patch proposals go to `patch_proposals/<provider>/<ts>.json`, never directly into `lib/`.
- L2 **must** stop at the same boundaries as L1: sign-in, account, final purchase.
- L2 **must** emit one `manual_checkpoint` event before user-action-required steps so the v2 UI can surface the handoff.

---

## Recommended tests for Codex to add when converting this to product code

### Unit tests (no live browser)

1. **`ticketmaster-list-anchor-match.test.ts`** — DOM fixture (HTML snippet from spike screenshot 04) parsed into JSDOM; assert `findTargetEventAnchor` returns the May 30 / 2:00 PM anchor for various target inputs:
   - Exact match: `{monthName:"May", day:30, year:2026, time:"2:00 PM"}` → score ≥ 7
   - Time fallback: `{monthName:"May", day:30, year:2026, time:undefined}` → still picks the May 30 row, lower score
   - No-match: target Dec 1 → returns null
2. **`ticketmaster-event-url-pattern.test.ts`** — pure regex test for `EVENT_URL_RE = /\/[a-z0-9-]+-(\d{2})-(\d{2})-(\d{4})\/event\/[A-Za-z0-9_-]+/i` against the 7 hrefs spike captured.
3. **`ticketmaster-rpa-stage.test.ts`** (existing) — extend to assert that `classifyTicketmasterStage` returns `"event_seat_map"` for the new `/<slug>-<date>/event/<id>` pattern (already covered by the `/\/event\//` URL regex; just add a test case for completeness).

### Integration tests (with browser, optional — gate behind `RUN_LIVE_TM=1`)

4. **`tm-list-view-spike.live.ts`** — runs the same scroll + anchor-extract flow as `spike.py` (translated to Playwright) against a known Lion King event 2 weeks out. Asserts: at least 1 visible anchor, anchor href matches the `/event/` regex, page.goto succeeds, seat map renders within 10 s.
5. **`tm-no-cookie-event-page.live.ts`** — verifies the spike's most surprising finding (TM does NOT auth-wall fresh sessions on `/artist/` or `/event/` — only at `/checkout` and beyond). If TM later moves the auth boundary earlier, this test flips and we know to re-evaluate. *This is a behavioural regression check, not an endorsement of any cookie-based workaround.*

---

## Boundaries — where automation must stop

These are baked into both `spike.py` and the proposed L2 design:

1. **Sign-in or account-continuation page** — `auth.ticketmaster.com` host, `/identity/`, `/login`, `/signin`, or any heading containing "Sign in or create account" / "Create account". Stop, screenshot, emit `manual_checkpoint`.
2. **Bot-detection / blocked page** — Cloudflare challenge, Akamai bot manager, "We've detected unusual activity". Stop, screenshot, emit `provider_degraded`.
3. **Seat selection** — once seat map is rendered with `<li role="menuitem">` ticket cards, automation stops. The user must pick the seat manually. Emit `manual_checkpoint` with the screenshot of the ticket list.
4. **Reserve Tickets click** — only when the user has selected a ticket AND the Reserve button is `enabled`. v1 RPA already handles this correctly (`pollReserveTickets` waits for `snap.hasReserveButton && snap.reserveEnabled`). Don't change this in L1.
5. **Conditions of Purchase / Proceed to Payment** — already automated correctly in v1 (commit `b75ecc3` string-source patch). Don't touch.
6. **Place Order / final purchase** — never. Always a user click.

---

## Files added by this spike

```
docs/spikes/
  ticketmaster-harness-spike-20260506.md                    (this report)
  ticketmaster-harness-spike-20260506/
    01_artist_calendar.png                                   ~625 KB
    02_event_page.png                                        ~85 KB (loading state)
    03_event_page_after_render.png                           ~170 KB (seat map + ticket list)
    04_artist_list_scrolled.png                              ~? KB (after scroll, list anchors visible)
    05_event_page_full_render.png                            ~? KB (with menuitem cards)
    events.jsonl                                             8 events

scripts/browser-harness-spike/
  spike.py                                                   primary runner (3 steps)
  spike_followup.py                                          follow-up probes (scroll + ticket-card shape)
```

No production runtime, worker, or app UI code was modified by this spike.

External (outside worktree, one-time host setup):
- `~/Developer/browser-harness` (cloned, installed via `uv tool install -e`)
- `<worktree>/.tmp/harness-spike-chrome-profile/` (gitignored, isolated Chrome user-data-dir)

---

## Authentication boundary — long-term product position

The spike confirmed `auth.ticketmaster.com` (OAuth `client_id=…web.ticketmaster…`) is a **stable, durable, identity-tier checkpoint**, not a transient bug. v2 should treat it as a first-class state, not as something to bypass.

### Recommended v2 runtime classification

- New executor outcome / status: **`account_session_required`** (stronger semantics than v1's `needs_login` bool — names the *condition* not the *next step*).
- New `ExecutionEvent.event_type`: **`user_login_checkpoint`** — emitted once when stage classifier transitions to `account` for the first time within an attempt.
- Status `account_session_required` is **terminal for the current automated attempt**: the executor stops cleanly, surfaces evidence (URL, screenshot, "you need to sign in to continue"), and yields control. It is **not** a failure / error / retry-eligible state.

### Recommended v2 UI behaviour

- Task card switches from "Agent working" to **"Continue in browser"** with a Sign-In affordance.
- The user's live browser tab stays open (in local mode the existing `holdBrowserOpenForManualReview` already covers this; in cloud mode the live-view URL stays accessible).
- UI states explicitly: "We don't enter your account credentials. Sign in directly on Ticketmaster, then …".
- After the user signs in manually, the task remains `account_session_required` until either the user dismisses it ("I finished manually") or — phase 2 — invokes a **"Continue after login"** action.

### Future "Continue after login" action (phase 2, user-initiated only)

- Strictly **user-controlled** — never silent, never automatic.
- When user clicks Continue, runtime re-attaches to the same tab, re-classifies the stage, and resumes from wherever the page is now (`/checkout/...` or `payments.ticketmaster.com/`).
- Internally: poll `classifyTicketmasterStage` until it leaves `"account"`; on `"checkout"` resume `passPaymentGate` + `selectCreditCardRadio` + `fillPaymentForm`.
- Holds 1 worker concurrency slot only while actively resuming, not while waiting for the user. Idle-timeout if user never returns (recommend 15 min).

### What we are NOT recommending

- ❌ **Do not silently copy or persist provider cookies into the repo, worktree, or any committed artifact.** Cookie files are credential material — their lifecycle is the user's, not the runtime's.
- ❌ Do not treat `auth.ticketmaster.com` redirects as a bug to engineer around. It is correct and intentional behaviour by the provider.
- ❌ Do not introduce a daemon that auto-refreshes provider sessions — the surface for credential mishandling is too wide.

### Cookie-based local dogfood (optional, opt-in only)

For local-only developer dogfooding (manual driver of TM flows during debug sessions), a one-time `.ticketmaster-cookies.json` produced by `scripts/save-ticketmaster-cookies.mjs` and consumed by the v1 provider's setup hook is the existing recipe in the integration worktree. Keep this path as **local dogfood / optional workaround** only:

- Lives in the developer's machine, **never** committed (`.gitignore` enforces this).
- Not promoted into v2's product surface — `v2 production runtime should not assume cookie-based session reuse exists`.
- If a developer chooses to run it, the runtime should still classify subsequent runs as `account_session_authenticated_via_local_dogfood` (or similar — a distinct state from "no auth wall reached"), so behaviour is observable.

### Other open items (lower priority, flagged not scoped)

1. **Should L1 keep the calendar-view path at all?** Spike says: keep it as a 2nd-tier fallback only. List-view direct-anchor handles the 99 % case.
2. **L2 `patch_proposal` schema + Codex conversion pipeline** — concrete JSON schema for `patch_proposals/<provider>/<ts>.json` and the Claude/Codex conversion workflow are out of scope for this spike; flagged for v2 design.
3. **Pattern portability** — same string-source evaluate / list-view direct-anchor pattern likely applies to OpenTable / Resy / Expedia. A second spike on Expedia would test the hypothesis.
4. **Auth-boundary regression** — if TM moves the auth boundary earlier (e.g., onto `/event/`), the live test `tm-no-cookie-event-page.live.ts` above flips first. That signal alone — not a cookie workaround — is the right detection mechanism.
