# Founder Dogfood Bug Inbox

Last updated: 2026-05-06

This inbox is for product dogfood bugs found in chat, Tasks, screenshots,
local reports, or founder walkthroughs. It is not a provider-run log and does
not authorize live retries.

Every row should map to a fixture, benchmark case, or explicit gap so dogfood
feedback can become regression coverage instead of a one-off note.

| ID | Status | Area | NLU fixture | Benchmark case | Repro | Expected | Actual | Evidence / coverage | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOG-001 | In progress | App navigation | - | - | Switch between Home, Tasks, Rooms, Contacts, Memory, Calendar on first visit. | Shell and page chrome render from compact data before heavy panels load. | First navigation could feel slow when heavy result/task/calendar surfaces compile or fetch. | App-shell dynamic imports and compact read-model tests from performance branches. | task-workspace | Continue measuring route bundle and endpoint bytes after this pass. |
| DOG-002 | In progress | Tasks | - | `tasks-completed-evidence-consistency` | Open a completed task from a chat card or `/tasks?focus=<jobId>`. | The task stays tied to its source session and opens full logs/snapshots from the focused URL. | Completed evidence could be less discoverable than active runs. | `booking-jobs-workspace.test.ts`; `/tasks` focus behavior updated. | task-workspace | Verify with a local app-only task fixture or existing completed job. |
| DOG-003 | In progress | Tasks | - | `tasks-completed-evidence-consistency` | Click Watch/Details/Evidence on restaurant, hotel, flight, activity task cards. | Watch opens in-place evidence when available; Details opens `/tasks?focus=...`; Evidence is consistent for terminal tasks. | Cards previously used inconsistent labels and completed tasks could lose snapshot affordance. | `booking-jobs-workspace.test.ts`; shared task href helpers. | task-workspace | Add browser UI coverage when local app QA is next authorized. |
| DOG-004 | Open | Screenshots | - | `restaurant-artifact-missing-screenshot` | Open a task with old or sparse artifacts. | Snapshot/log panels clearly say whether no artifacts exist or they are still loading. | Empty streams can look like missing evidence instead of a valid empty state. | Existing `task-timeline-snapshot-diagnostics.test.ts`; benchmark artifact completeness gate. | task-workspace | Audit `TaskTimelinePanel` empty/error copy against completed-task artifacts. |
| DOG-005 | In progress | NLU / activity | `zh-activity-lion-king-trip-shaped`, `en-activity-lion-king-trip-shaped`, `en-trip-lion-king-explicit-trip`, `dogfood-activity-lion-king-zh` | `activity-lion-king-zh-routing`, `activity-lion-king-en-routing`, `trip-lion-king-explicit-trip` | Ask `帮我预定一个纽约6月1号的百老汇狮子王看看` or `book The Lion King in New York on June 1`. | Single-show ticket requests route to activity; explicit full-trip requests remain trip. | Previously could fall into trip planner and ask for end date, nights, or travelers. | `routing-matrix.test.ts`; `live-extractor-eval.test.ts`; `scripts/eval-live-extractor.ts`; `internal-benchmark-v2.test.ts`. | nlu | Replace deterministic parser coverage with true no-live LLM transcript fixtures when available. |
| DOG-006 | Open | Activity provider boundary | `zh-activity-hamilton-complete`, `en-activity-hamilton-complete` | `activity-ticketmaster-simulated-handoff`, `activity-provider-simulated-block` | Ask for a Broadway/event ticket and reach provider-specific ticketing. | Stop at a safe human handoff or classify provider/manual boundary with evidence. | Ticketmaster-style execution can stall or require manual handoff; not live-verified here. | Internal benchmark simulated blocker and manual-boundary cases. | product/manual-boundary | Need separate product QA approval before any provider attempt. |
| DOG-007 | Open | Hotel provider evidence | - | `hotel-booking-provider-simulated-block` | Booking.com returns no availability without hotel-specific proof. | No-availability requires provider evidence; selector drift and network issues stay separate. | False no-availability risk remains a Phase 2 blocker. | Phase 2 hotel runbooks and provider closure docs. | provider-runtime | Keep no-live classifier fixtures updated before another hotel live attempt. |
| DOG-008 | Fixed | Hotel search | `zh-hotel-complete`, `en-hotel-nyc-budget` | `hotel-nyc-budget-routing` | Confirm hotel constraints, then run search. | Search uses confirmed date/location/guest constraints. | Search could use stale or unconfirmed constraints. | `d69d058 fix(chat): use confirmed hotel constraints for search`; hotel routing fixtures. | planner | Watch for regressions in NLU matrix and trip package flow. |
| DOG-009 | In progress | Restaurant cuisine | `zh-restaurant-japanese-complete`, `zh-restaurant-chinese-complete`, `en-restaurant-missing-cuisine`, `dogfood-restaurant-chinese-zh` | `restaurant-japanese-routing`, `restaurant-chinese-routing`, `restaurant-missing-cuisine` | Ask for a specific cuisine, e.g. Japanese or Chinese in NYC. | Cuisine is a strong filter/rerank signal; generic high-rated restaurants should not dominate. | Broad search previously allowed non-matching cuisines into top recommendations. | `restaurant-rerank-cuisine.test.ts`; `routing-matrix.test.ts`; `live-extractor-eval.test.ts`; benchmark cuisine cases. | nlu | Add more cuisine aliases from dogfood failures. |
| DOG-010 | In progress | Hotel date/budget parsing | `zh-hotel-complete`, `en-hotel-nyc-budget`, `en-hotel-refine-budget`, `zh-refine-budget-generic`, `dogfood-hotel-nyc-budget-zh` | `hotel-nyc-budget-routing`, `hotel-missing-checkout` | Ask `帮我订一个5月20号到24号的纽约酒店，预算300一天`. | City, check-in, check-out, and budget survive routing and planner handoff. | Date/budget loss would produce wrong hotel search constraints. | `routing-matrix.test.ts`; `live-extractor-eval.test.ts`; `scripts/eval-live-extractor.ts`; benchmark gate. | nlu | Add true extractor transcript fixtures when a no-live LLM fixture path exists. |

## Intake Rules

- Add a row when a founder or agent hits a reproducible product issue.
- Fill `NLU fixture` and `Benchmark case` when coverage exists; use `-` only
  when the bug is not a routing or benchmark concern.
- Link to the test, commit, or evidence source when one exists.
- Keep provider-live blockers marked as external/product QA until a human
  explicitly approves a single controlled attempt.
- Do not store secrets, OTPs, payment data, screenshots, logs, or local artifact
  contents in this file. Reference paths or report ids only.
