# Resy availability probe protocol

> **For**: founder + codex + Claude — read **before** running another live R-003 / R-030 / etc.
> **Author**: Claude (Track B)
> **Last updated**: 2026-05-04 (v2 — aligned to codex's actual probe runner output schema)

This doc captures the *probe-first* protocol that came out of the
2026-05-04 R-003 live retry (`phase0-resy-2026-05-04T01-03-14-028Z.json`).
That run was a **safe failure** — Computer Use repaired `buvette → buvette-nyc`
correctly, then Resy returned no slots for the requested date/time, and
the runner returned `Unable to complete due to the venue page not returning
availability slots`. The taxonomy was misclassified as `F-PROVIDER-UNKNOWN`
when the correct mapping was `F-AVAIL-NONE` / `no_availability_correct`
(per Q11(a) explicit broadening).

**The bigger problem the run revealed** isn't the misclassification —
codex fixed that in the same patch. The bigger problem is:

> **A no-slots case can never validate Resy fill / OTP closure.** No matter
> how good the agent is, you can't fill a form Resy never serves. So
> burning a live token on a no-slots case proves only that the
> "no_availability_correct" path works. **It does not prove fill/OTP
> closure**, which is what Phase 0A is gated on.

Probe-first protocol is the fix.

---

## Protocol

### Step 1 — Run the probe (cheap, no-token, no-browser)

> Codex domain. Don't reimplement on Claude side.

```
npm run probe:resy                     # whole suite (slow but exhaustive)
npm run probe:resy -- --case R-030     # single case (fast, ~10s)
```

Hits Resy's public availability JSON endpoint (`POST
/3/venuesearch/search`) for each Phase 0 fixture case, exact-slug-matches
the result against the fixture's `resySlug`, then writes one report to:

```
benchmark/runs/resy-availability-probe-<ISO-timestamp>.json
```

Schema lives in codex's runner (`scripts/probe-resy-availability.ts`)
and is mirrored in `lib/benchmark/resy-probe-report.ts` (Track B —
Claude reflects whatever the runner emits).

Optional flags codex's runner accepts:
- `--browser` — also do a headless DOM scrape (slower; useful when API
  result is suspicious)
- `--visible` — non-headless Chromium so a human can observe
- `--screenshot` — write `benchmark/runs/resy-availability-screens/<caseId>.png`
- `--limit N` — only probe the first N cases
- `--case <id>` — single case

### Step 2 — Read the dashboard

```
http://localhost:3000/dev/resy-probe-runs
```

Single screen answer to "which case can I run live next?":
- **Recommended case card** — the top live-OK case with copy-paste live
  command (`npx tsx scripts\run-phase0-resy-benchmark.ts --case <id>
  --live-openai --allow-failures`)
- **Summary strip** — Live OK / No matching slot / Blocked counts
- **Per-case table** — slot total + matching count + exact venue match
  status + verdict
- **Detail drawer** (click "Detail →") — date / time / covers / API
  venue slug match / blocker signals / matching-slots table / live
  command for that specific case + safety hint

**Verdict labels** (mirrors codex's runner `recommendation` field
verbatim):
- `use_for_live_fill_test` — has matching slots; safe to spend
- `no_matching_slot` — empty/window-miss; do not spend
- `blocked_or_unknown` — captcha or transport error; rerun probe

**Founder should not read the JSON in terminal anymore.** This dashboard is
the single source.

### How to choose the next Resy live case

1. Run `npm run probe:resy` (or single case with `--case R-XXX`).
2. Open `/dev/resy-probe-runs`, pick the newest run from sidebar.
3. If recommended-case card has a live-OK case, copy its command and
   ship to codex with founder approval.
4. If multiple cases qualify, prefer the one with the highest
   matching-slots count and `diffMinutes === 0` for at least one slot
   — that means the fixture's exact requested time is bookable, which
   is the cleanest fill-flow validator.
5. Verify exact venue match (`apiVenueSlug` === fixture's `resySlug`).
   Mismatch = the runner's slug repair will fight Resy's API; not a
   clean test.
6. If everything is `no_matching_slot`, the date/time fixtures want
   isn't realistic for this booking window. Wait or update fixtures
   (codex's domain) — don't burn a token to re-confirm
   `no_availability_correct`.

### Step 3 — Spend a live token only on a `live_ok` case

If the dashboard says R-001 has 6 matching slots and verdict `live_ok`,
the recommended command pre-fills the right `--case`. Copy → paste →
spend. The next live token has a chance of validating fill/OTP because
slots actually exist.

### Step 4 — If no case has `live_ok`

Three real scenarios:

| Probe state | What to do |
|---|---|
| All cases `live_no_slots_correct` | Date/time the fixtures ask for isn't realistic for the upcoming weekend. Wait or update fixtures (codex). Don't burn live token. |
| Some cases `skip` (blockerSignals like captcha) | Probe got rate-limited. Retry probe in 30 min. Don't burn live token. |
| Mix `live_ok` + others | Pick the highest-confidence `live_ok`. Dashboard already orders. |

---

## Why this also matters for Phase 0A gate

Phase 0A's 4-metric gate (≥80% booking-ready / ≥95% safe-outcome /
=0 severe / 100% taxonomy) **cannot be validated on no-slot cases**:

- **Booking-ready rate**: a no-slots case correctly returns
  `no_availability_correct` and counts as *safe* but **not booking-ready**.
  Running the suite against a fixture with mostly no-slots cases trivially
  fails the booking-ready threshold even if the agent is perfect.
- **Safe-outcome rate**: no-slots → safe. Fine here.
- **Severe-error rate**: no-slots is not severe. Fine here.
- **Taxonomy coverage**: no-slots → `F-AVAIL-NONE`. Single bucket; doesn't
  exercise the rest of the taxonomy.

**Conclusion**: Phase 0A gate decisions about "Computer Use can technically
book Resy" require running the suite against cases with *real* matching
slots. The probe is the gate-keeper for that selection.

---

## Glossary (mapped to dashboard fields)

- `slots` — every slot Resy returned, regardless of time
- `matchingSlots` — slots whose `diffMinutes ≤ allowedWindowMinutes`
  (default ±60 min) and dateIso matches the fixture's request
- `noAvailabilitySignals` — DOM-scrape signals like `notify`,
  `nothing available`, `sold out` (only populated when `--browser`
  flag is passed)
- `blockerSignals` — DOM-scrape signals like `captcha`,
  `verify you are human`, `access denied`. **Non-empty = result is
  UNTRUSTED.**
- `apiVenueSlug` — the slug Resy actually returned for our fixture's
  exact-slug-match query. If it doesn't equal the fixture's `resySlug`,
  the dashboard surfaces a "mismatch" warning.
- `apiError` — short reason when API exact match failed (e.g.
  `Exact venue slug X not returned. Top hits: …`)
- `recommendation`:
  - `use_for_live_fill_test` — has matching slots, safe to spend tokens
  - `no_matching_slot` — no matching slots, would map to
    `no_availability_correct`. Useful for taxonomy testing **but NOT for
    validating fill/OTP closure**
  - `blocked_or_unknown` — blocker signals or transport error; rerun probe later

---

## Hold rules

- **Probe runner** (`scripts/probe-resy-availability.ts`) — codex domain
- **Probe report types + dashboard loader** (`lib/benchmark/resy-probe-report.ts`)
  — Track B / Claude
- **Dashboard pages** (`/dev/resy-probe-runs`, `/dev/benchmark-runs`) — Track B
- **Live runner** (`scripts/run-phase0-resy-benchmark.ts`) — codex domain
  (not modified here)

If the probe schema needs to change, **Claude updates `resy-probe-report.ts`
in the same commit as codex updates the runner**, otherwise dashboards
break.

---

## Related docs

- `PHASE_STATUS.md` — Phase 0A status (R-003 outcome explanation)
- `R003_LIVE_SMOKE_RUNBOOK.md` — full live-runner checklist; this doc is
  the *Step 0* added in front
- `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row + § 7.5 OTP transitional
- `lib/benchmark/resy-probe-report.ts` — schema + loader source of truth
- `app/dev/resy-probe-runs/page.tsx` — dashboard
