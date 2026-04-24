# Archived Pipelines — 2026-04 Positioning Shift (Travel-Only)

This directory preserves the 4 non-travel pipelines that were archived as part of
the 2026-04 positioning shift to a travel-only product. They are kept verbatim so
git history + blame are preserved; they are **not** built or tested.

Archived files:

- `credit-card.ts` — `runCreditCardPipeline` (standalone credit-card recommendations)
- `laptop.ts` — `runLaptopPipeline`
- `smartphone.ts` — `runSmartphonePipeline`
- `headphone.ts` — `runHeadphonePipeline`

## Why archived

Onegent repositioned to travel-only (restaurants / hotels / flights / activities /
trip planning). The NLU v2 layer (`lib/agent/nlu-v2/`) no longer emits these
categories — `NluScenario` in `lib/agent/nlu-v2/types.ts` excludes them — so the
code is unreachable at runtime. This story (US-004) physically relocates the
pipelines and removes the import + registration edges from `lib/agent.ts`.

## Expected broken imports

After `git mv` the relative imports in these files (e.g. `../../creditCardEngine`,
`../../laptopEngine`) no longer resolve. That is intentional — this directory is
excluded from typecheck and tests via the `**/_archived/**` globs in
`tsconfig.json` and `vitest.config.ts` (see US-003). Do **not** hand-edit the
relative paths — the exclude pattern is the single-source-of-truth fix.

## Related live code that is still travel-only

`lib/agent/planners/trip-card.ts` (`getBestCardForTrip` / `buildTripCardCallout`)
is a *travel-scoped* helper that uses `recommendCreditCards` directly to pick a
credit card for a trip. It is **not** archived because it is used only inside
travel scenario plans (e.g. `weekend_trip`). If you are looking for "credit card
logic that still runs," that is where it lives.
