# 2026-04 Positioning Shift — Archived Planners

In April 2026 Onegent narrowed its scope to travel-only use cases
(restaurants, hotels, flights, activities, trip planning). The planners that
drove non-travel scenarios were moved here via `git mv` to preserve history
while removing them from the active runtime.

These planners are intentionally NOT imported anywhere. The `if
(detectedScenario === "gift" | "fitness" | "big_purchase")` branches in
`lib/agent.ts` were deleted in the same commit, so the scenario strings are
already unreachable at runtime (the NLU v2 `NluScenario` union excludes them).

## Archived planners

- `big-purchase.ts` — laptop / smartphone / headphone purchase decision plan
  (exported `parseBigPurchaseIntent`, `runBigPurchasePlanner`)
- `fitness.ts` — fitness studio / class plan (exported `runFitnessPlanner`)
- `gift.ts` — gift shopping (SerpAPI-backed) plan (exported `runGiftPlanner`)

## Archived tests

- `__tests__/gift.test.ts`
- `__tests__/fitness.test.ts`

The `parseBigPurchaseIntent` / `runBigPurchasePlanner` describe blocks that
lived in `lib/__tests__/scenario2.test.ts` were deleted inline since that file
is still live.

## Why these files don't typecheck

The relative imports inside these planners (`../../outputCopy`, `./utils`,
`../../tools`, `../../cities`) point at paths that no longer resolve from the
archive location. Both `tsconfig.json` and `vitest.config.ts` now exclude
`**/_archived/**`, so typecheck and vitest simply skip this directory.

Related parse helpers (`lib/agent/parse/gift.ts`, `lib/agent/parse/fitness.ts`)
were orphaned by this archival but left in place — they are no longer imported
anywhere, and a future cleanup story can remove them.
