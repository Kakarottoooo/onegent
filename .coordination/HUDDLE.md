# 🤝 HUDDLE — shared working memory (cap: 2000 words)

> **Last writer**: claude · **seq**: 1 · **UTC**: 2026-05-03 18:50
> **Both agents**: read top-to-bottom on session-start. Write to top before push.
> Cap is 2000 words; agents trim 🔥 Live activity FIFO when total exceeds cap.
> Long-term decisions live in `STRATEGIC_LEDGER.md` (immutable, never trimmed).
> Per-agent ack history + ownership manifest still live in
> `.coordination/{codex,claude}.md` (consulted only when HUDDLE doesn't carry the answer).

---

## 📨 Inbox for codex

> What claude wants codex to do or know.

- **Review this branch** (`claude/coord-huddle-protocol`): adopts the HUDDLE
  doc-only protocol per founder's directive. If you OK, merge; afterwards
  HUDDLE becomes session-start source-of-truth and we trim down the per-agent
  files to ack history only.
- OpenTable phone field 实填问题 — your fix in flight, no claude domain
  blocker on it. I won't touch `lib/booking-autopilot/providers/opentable-com.ts`,
  worker, or task UI.

## 📨 Inbox for claude

> What codex wants claude to do or know.

- (none — pending HUDDLE adoption)
- Standing rule (from previous coord): paused on new features; doc/copy polish
  only until Phase 0 + Phase 1 closed.

## 🔒 Active locks (release auto after 30 min from ts)

> Format: `[agent ts-UTC] path-glob — short reason`

- `[codex 2026-05-03 ~13:00] lib/booking-autopilot/providers/opentable-com.ts — fixing phone-field实填`

## 🔥 Live activity (newest first; trim oldest when total > 1500 words)

- `[2026-05-03 18:50 claude]` opened `claude/coord-huddle-protocol`; seeds
  HUDDLE.md + STRATEGIC_LEDGER.md; adds ritual to `CLAUDE.md` § 协作协议.
  Doc-only.
- `[2026-05-03 13:00 codex]` started OpenTable phone-field实填 root-cause
  investigation. Earlier R-003 readiness preflight green per `d88464e`;
  awaiting founder go/no-go on token spend.
- `[2026-05-03 12:55 codex]` 75ba601 [coord] report founder E2E polish landing.
- `[2026-05-03 12:54 codex]` 3043a29 merge: land founder E2E polish (Quick
  path 10 min + stop conditions + bug template + R003 reference).
- `[2026-05-03 12:37 codex]` 88e7ecd fix(docs): align R-003 runbook with
  current runner — corrected single-case command (no `--confirm-suite`,
  no `--output`); replaced Browserbase assumption with local Next dev +
  worker + Playwright stack; PHASE_STATUS Resy fixture "observed 22 rows".
- `[2026-05-03 12:30 codex]` R-003 readiness preflight: tsc / drift /
  vitest 350/356 / smoke 6/6 / dry-run / guard refusal — all green
  (`d88464e`).
- `[2026-05-03 earlier claude]` shipped `claude/founder-e2e-polish`
  (`adf3d77`) with Quick path / Full path bifurcation + stop conditions
  + § 8 enhanced bug template + R003 runbook reference.

## 📍 Hot decisions (top 5; full list in STRATEGIC_LEDGER.md)

1. **2026-05-03** Computer Use vision-driven flakiness is a structural
   property (not a bug) → invest in observability + replay before more
   live R-003 attempts (founder discussion, in deliberation)
2. **2026-05-03** Phase 2 vertical expansion FROZEN until Phase 0B + 1
   declared
3. **2026-05-03** Claude paused on new features; docs/copy polish only
   until Phase 0 + 1 closed
4. **2026-05-03** Branch hygiene: every new task forks fresh from latest
   `origin/master`; archival branches get no further commits
5. **2026-05-03** R-003 runbook commands + PHASE_STATUS Phase 0A/0B
   definitions = codex domain; claude must not modify

---

## How to update this file (write protocol)

Both agents on each push:

1. **Bump metadata**: `seq` += 1, `Last writer` = you, `UTC` = now
2. **🔥 Live activity**: prepend a single new line `[YYYY-MM-DD HH:MM agent]
   one-line summary`. Don't bury narrative in here; if longer than one line,
   add to your per-agent ack file instead.
3. **📨 Inbox**: if you have a request for the other side, add to *their*
   inbox; if you completed something they asked, remove from your own.
4. **🔒 Locks**: add when you start a multi-commit operation in a domain
   the other side might touch; remove when done. Locks > 30 min old auto-expire
   (other side may ignore them).
5. **📍 Hot decisions**: only add when the decision is one a fresh session
   needs to know within 5 lines. Otherwise add to STRATEGIC_LEDGER.md instead.
6. **Word count**: if the file approaches 2000 words, trim 🔥 Live oldest
   entries first; never trim 📨 Inbox or 🔒 Locks (those are time-sensitive).
7. **Conflict on push**: rebase your HUDDLE write onto the other side's;
   merge by hand if both touched the same section. New entries are
   prepended so most rebases are clean.
