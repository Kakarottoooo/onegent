# Founder Dogfood Bug Inbox

Last updated: 2026-05-06

This inbox is for product dogfood bugs found in chat, Tasks, screenshots,
local reports, or founder walkthroughs. It is not a provider-run log and does
not authorize live retries.

| ID | Status | Area | Repro | Expected | Actual | Evidence / source | Regression coverage | Owner / next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOG-001 | In progress | App navigation | Switch between Home, Tasks, Rooms, Contacts, Memory, Calendar on first visit. | Shell and page chrome render from compact data before heavy panels load. | First navigation could feel slow when heavy result/task/calendar surfaces compile or fetch. | 2026-05-06 app-shell performance pass; `docs/00-start-here/SYSTEM_DESIGN.md`. | App-shell dynamic imports and compact read-model tests from performance branches. | Continue measuring route bundle and endpoint bytes after this pass. |
| DOG-002 | In progress | Tasks | Open a completed task from a chat card or `/tasks?focus=<jobId>`. | The task stays tied to its source session and opens full logs/snapshots from the focused URL. | Completed evidence could be less discoverable than active runs. | Founder task UX feedback; task cards had inconsistent Watch/Details labels. | `booking-jobs-workspace.test.ts`; `/tasks` focus behavior updated. | Verify with a local app-only task fixture or existing completed job. |
| DOG-003 | In progress | Tasks | Click Watch/Details on restaurant, hotel, flight, activity task cards. | Watch opens in-place evidence when available; Details opens `/tasks?focus=...`. | Some cards showed Watch, some Details, some jumped to `/tasks`, and completed tasks could lose snapshot affordance. | Task Workspace v2 workstream. | `booking-jobs-workspace.test.ts`; InlineJobCard and `/tasks` use shared helpers. | Add browser UI coverage when local app QA is next authorized. |
| DOG-004 | Open | Screenshots | Open a task with old or sparse artifacts. | Snapshot stream clearly says whether no snapshots exist or they are still loading. | Empty streams can look like missing evidence instead of a valid empty state. | Founder screenshot/log debugging feedback. | Existing `task-timeline-snapshot-diagnostics.test.ts`. | Audit `TaskTimelinePanel` empty/error copy against completed-task artifacts. |
| DOG-005 | In progress | NLU / activity | Ask `帮我预定一个纽约6月1号的百老汇狮子王看看` or `book The Lion King in New York on June 1`. | Route to activity/event ticket flow. | Previously could fall into trip planner and ask for end date, nights, or travelers. | User prompt and `activity-ticket-normalization.test.ts`. | `routing-matrix.test.ts` and `scripts/eval-nlu-routing.ts`. | Keep expanding matrix with real failed utterances. |
| DOG-006 | Open | Activity | Ask for a Broadway/event ticket and reach provider-specific ticketing. | Stop at a safe human handoff or clearly classify provider/manual boundary. | Ticketmaster-style execution can stall or require manual handoff; not live-verified here. | Founder bug inbox seed item. | Internal benchmark simulated blocker case. | Need separate product QA approval before any provider attempt. |
| DOG-007 | Open | Hotel | Booking.com returns no availability without hotel-specific proof. | No-availability should require provider evidence; selector drift and network issues stay separate. | False no-availability risk remains a Phase 2 blocker. | Phase 2 hotel runbooks and provider closure docs. | Existing hotel retry/runtime tests. | Keep no-live classifier fixtures updated before another hotel live attempt. |
| DOG-008 | Fixed | Hotel search | Confirm hotel constraints, then run search. | Search uses confirmed date/location/guest constraints. | Search could use stale or unconfirmed constraints. | `d69d058 fix(chat): use confirmed hotel constraints for search`. | Existing chat/hotel task tests. | Watch for regressions in NLU matrix and trip package flow. |
| DOG-009 | In progress | Restaurant cuisine | Ask for a specific cuisine, e.g. Japanese in NYC. | Cuisine is a strong filter/rerank signal; generic high-rated restaurants should not dominate. | Broad search previously allowed non-matching cuisines into top recommendations. | `restaurant-rerank-cuisine.test.ts`. | `routing-matrix.test.ts`; existing cuisine rerank test. | Add more cuisine aliases from dogfood failures. |

## Intake Rules

- Add a row when a founder or agent hits a reproducible product issue.
- Link to the test, commit, or evidence source when one exists.
- Keep provider-live blockers marked as external/product QA until a human
  explicitly approves a single controlled attempt.
- Do not store secrets, OTPs, payment data, screenshots, logs, or local artifact
  contents in this file. Reference paths or report ids only.
