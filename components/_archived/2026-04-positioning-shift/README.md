# 2026-04 Positioning Shift — Travel-Only

In April 2026 Onegent narrowed its scope to travel-only use cases
(restaurants, hotels, flights, activities, trip planning). The non-travel
recommendation cards that used to live under `components/` were moved here to
preserve git history while removing them from the active build.

These files are intentionally NOT imported anywhere. Keeping them on disk lets
us resurrect individual card layouts later if the product ever re-expands, but
they should not be re-wired without a new PRD.

## Archived components

- `CreditCardCard.tsx`
- `LaptopCard.tsx`
- `SmartphoneCard.tsx`
- `HeadphoneCard.tsx`

Upstream references (page gating, planner/pipeline registries, NLU scenarios)
were removed in the companion stories of the same positioning-shift PRD.
