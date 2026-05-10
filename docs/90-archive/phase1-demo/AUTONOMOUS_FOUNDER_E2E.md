# Autonomous Founder E2E runner

> **For**: founder + Claude + codex.
> **Author**: Claude (Track B).
> **Last updated**: 2026-05-04.

This doc covers the **autonomous** runner that turns
`PHASE_1_FOUNDER_E2E.md` into a one-command verdict on whether
Phase 1 is currently shippable. No founder clicks required, no
OpenAI tokens, no live booking provider.

It complements the **manual** workbench at `/dev/founder-e2e` —
together they form Phase 1.5's QA story:

- Autonomous run = "today's build doesn't crash, contracts hold,
  security boundaries intact" (1-2 minutes).
- Manual workbench = "I (founder) walked the experience like a
  customer would" (10 min Quick / 60-90 min Full).

The autonomous runner targets a separate `pathId = "auto"` checklist
of 15 probes that can be verified without auth, payments, OTP, or
real provider calls. The remaining manual-only steps (cookie auth,
real chat → ProfileGapCard, Decision Room multi-user) stay on the
Quick / Full paths.

---

## How to run it

```bash
# Terminal A — start dev server
npm run dev > ./dev.log 2>&1
#   or:  npx next dev --webpack > ./dev.log 2>&1   (if Turbopack panics)

# Terminal B — run the suite
npm run e2e:founder              # headless, exit 0 on pass / needs_polish
npm run e2e:founder:headed       # visible chromium window
npm run e2e:founder:json         # machine-readable JSON to stdout
```

**Optional flags**:

```bash
npx tsx scripts/run-founder-e2e.ts \
  --base-url=http://localhost:3000 \
  --label=ci-pr-42 \
  --output-dir=benchmark/runs \
  --save-to-api          # optional POST to /api/dev/founder-e2e-runs
```

`--start-server` is reserved for a future iteration; today the
runner refuses to start a dev server itself because that would
fight codex's local worker / Next dev.

The runner writes:

- `benchmark/runs/<runId>-auto.json` — full QaRun (machine-readable)
- `benchmark/runs/<runId>-auto.md` — bug-report-shaped Markdown
- `benchmark/runs/founder-e2e-assets/<runId>/*.png` — failure
  screenshots (gitignored)

When `--save-to-api` is set, the run is also POSTed to
`/api/dev/founder-e2e-runs`, but the local file lands first either
way — API failure never aborts the run.

---

## Success criteria

The runner emits a verdict tier:

| Verdict | Exit code | Meaning |
|---|---|---|
| `pass` | `0` | Every probe passed. Today's build is shippable on these axes. |
| `needs_polish` | `0` | At least one P1+ probe failed but **no P0** outstanding. Triage before declaring Phase 1, but not a ship-blocker. |
| `fail` | `1` | At least one P0 probe failed. Stop the line; fix before next run. |
| (unset) | `0` | Indeterminate — runner did not record any probe. Should not happen in practice. |

P0 probes (default severities):

- `auto:health:1` — server alive
- `auto:self:1` — `/dev/founder-e2e` self-renders
- `auto:render:tasks-awaiting-profile` — Phase 1 #7 path B
- `auto:api:traversal` — path-traversal rejection
- `auto:security:payment-guard` — `/profile` PATCH payment fields
- `auto:security:unauthorized-task` — task ownership boundary

---

## How to read a failing run

The runner emits a Markdown report at
`benchmark/runs/<runId>-auto.md`. Each failing step becomes a
[BUG] section with:

- Severity (P0/P1/P2/P3)
- Surface (the URL or command)
- Steps to reproduce (verbatim from the checklist)
- Expected (verbatim from the checklist)
- Actual (one-line observation from the runner)
- Artifacts (URL, screenshot path, console errors, run id)
- References (doc § section pointers)

To paste into a chat with codex / Claude:

```bash
cat benchmark/runs/<runId>-auto.md | pbcopy        # macOS
type benchmark\runs\<runId>-auto.md | clip         # Windows
```

The exact same Markdown (modulo header) is also accessible from
`/dev/founder-e2e` once the run is loaded — Open the saved row in
the runs table and the Spotlight panel surfaces command +
duration + browser + screenshots inline.

---

## Steps the runner CANNOT automate

These are intentional gaps — they require either real auth, real
provider, or human judgment. The autonomous runner records them
either as "not in this path" (the `auto` path simply omits them)
or as `skipped` with a clear note.

| Gap | Why |
|---|---|
| Real Clerk login (Quick path A.3) | Clerk dev sessions need real OAuth; we don't store credentials in CI. Login + cookie polling + cancel transition stay on the manual Quick path. |
| Live ProfileGapCard inside chat (Quick A.4) | Needs auth + NLU round trip; auto path checks the demo task page only. |
| Decision Room multi-user (Full § 7) | Two parallel browser contexts + realtime sync — out of scope for the no-token runner. |
| Real OTP / payment / final-confirmation tap | Not in scope under any circumstance — these are explicit non-negotiable safety boundaries (see `FOUNDER_E2E_BUG_TRIAGE.md`). |
| External provider (Resy / OpenTable / Expedia) live page render | The runner never visits an external provider URL. |

---

## Why no live providers / OpenAI?

The autonomous runner is intentionally **no-token, no-provider, no-auth**.
This is non-negotiable:

- **Live OpenAI / Computer Use** burns money and is owned by codex's
  benchmark runner (`scripts/run-phase0-resy-benchmark.ts`).
- **Live booking provider (Resy / OpenTable / Expedia)** could
  trigger anti-automation, lock accounts, or accidentally hold
  inventory. Track A's benchmark suite handles this carefully;
  the founder QA runner stays out of it.
- **Real OTP / CAPTCHA / payment** are NEVER automated — we do not
  bypass them, period.

If you need an end-to-end run that includes the provider side, that
is `npx tsx scripts/run-phase0-resy-benchmark.ts --case <id> --live-openai`
under codex's domain — see `../20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
and the readiness gate in `../20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`.

---

## How to triage a failing run with codex

1. Read the verdict at the top of the Markdown report.
2. For each `[BUG]` section, determine domain via the surface:
   - `/dev/*` or `/tasks/demo-*` UI / app routes → **Claude (Track B)**.
   - `/api/v1/users/me/profile`, auth boundary → **codex (Track A)**.
   - `/api/dev/founder-e2e-runs` → **Claude** (it's our endpoint).
   - `/api/v1/...` other → **codex (Track A)**.
3. Paste the relevant `[BUG]` block(s) into the chat with the
   owning agent.
4. Re-run `npm run e2e:founder` after the fix; expect the verdict
   to flip to `pass` or `needs_polish`.

---

## Failure mode: dev server not running

If you run `npm run e2e:founder` without a dev server:

- Exit code `2`.
- stderr: `dev server unreachable at http://localhost:3000: ...`.

Start the dev server (`npm run dev` or `npx next dev --webpack`)
and retry. The runner deliberately does not auto-launch — that
would conflict with codex's local worker / Next dev session.

## Failure mode: chromium not installed

- Exit code `3`.
- stderr suggests `npx playwright install chromium`.

Playwright chromium is a one-time `npx playwright install chromium`
download (~150 MB). It's already a transitive dependency of the
worker's booking-autopilot, so the binary should already exist in
most local checkouts.

---

## Schema notes

The runner produces a `QaRun` JSON at schema version `2`:

- `source: "automated"`
- `runnerMeta: { command, baseUrl, browser, durationMs, nodeVersion, label? }`
- `runnerVerdict: "pass" | "needs_polish" | "fail"`
- `pathId: "auto"`

Legacy schema-v1 manual runs (saved before 2026-05-04) still load
without modification — the parser stamps them as `source: "manual"`
on read and `recomputeRun` updates the schemaVersion on next save.

See `lib/founder-e2e/checklist.ts` for the canonical types and
`lib/founder-e2e/runner-report.ts` for the probe → run conversion.

---

## Related files

- `scripts/run-founder-e2e.ts` — runner entrypoint.
- `lib/founder-e2e/runner-report.ts` — pure converter + verdict logic.
- `lib/founder-e2e/fixtures.ts` — auto path step definitions.
- `app/dev/founder-e2e/page.tsx` — the manual workbench (renders
  saved auto runs too).
- `app/api/dev/founder-e2e-runs/route.ts` — dev API surface.
- `scripts/founder-e2e-preflight.mjs` — preflight before manual walk.
- `FOUNDER_E2E_BUG_TRIAGE.md` — severity ladder + agent routing.
- `PHASE_1_FOUNDER_E2E.md` — manual checklist this all encodes.
- `lib/__tests__/founder-e2e.test.ts` — schema + fs tests.
- `lib/__tests__/founder-e2e-runner.test.ts` — runner-only tests.
