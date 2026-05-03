# NLU v2 — Consumer Contract

> **Audience**: anyone wiring the NLU v2 result into a UI surface. Today
> that's the homepage chat panel (`app/page.tsx`); tomorrow it could be a
> Decision Room private chat, the MCP `tools/call` handler, or a CLI.
>
> **Status**: contract live. Types + tests + working dev demo all shipped
> (76e35b9, 8f44eeb, fcdc1d9). Real chat-panel hookup pending the codex
> typecheck cleanup + cookie-auth proxy.
>
> **TL;DR**: Call `POST /api/chat/parse`, switch on `result.__v2_action.type`,
> dispatch the 5 cases. The pattern is exhaustively demonstrated at
> `/dev/profile-gap-flow` — clone its `handleSend` function and replace
> the two `mock*` calls with real fetches.

---

## When to read this

- Wiring a new chat surface that needs NLU
- Adding a new `RouterAction` variant (extending the contract)
- Debugging why a UI behavior didn't fire (check action.type vs handler)
- Onboarding to NLU v2 after Phase 1

If you just want to **try** the dispatcher behavior, skip this doc and
open `/dev/profile-gap-flow`. The page renders every action type with
a debug sidebar.

---

## Source of truth

| What | File |
|---|---|
| Type contract (`IntentState`, `RouterAction`, `ProfilePatch`, …) | [`lib/agent/nlu-v2/types.ts`](./lib/agent/nlu-v2/types.ts) |
| Pure router (state → action) | [`lib/agent/nlu-v2/router.ts`](./lib/agent/nlu-v2/router.ts) |
| LLM extractor + coercion | [`lib/agent/nlu-v2/extractor.ts`](./lib/agent/nlu-v2/extractor.ts) |
| API route | [`app/api/chat/parse/route.ts`](./app/api/chat/parse/route.ts) |
| Live dispatch demo | [`app/dev/profile-gap-flow/page.tsx`](./app/dev/profile-gap-flow/page.tsx) |
| Golden tests | `lib/agent/nlu-v2/__tests__/golden-*.test.ts` |
| Public barrel | [`lib/agent/nlu-v2/index.ts`](./lib/agent/nlu-v2/index.ts) |

If any of these disagree with this doc, the code wins; treat the doc as
stale and update it.

---

## The dispatch contract

### 1. Make the request

```ts
const res = await fetch("/api/chat/parse", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: userText,
    history: previousTurns, // [{ role: "user"|"assistant", content: "..." }, ...] (last ~20)
    sessionId: clientSessionId, // optional — server keeps room/private chat context separate
  }),
});
const result = await res.json() as NluV2ParseResult;
```

Response shape (relevant fields, see `types.ts:NluV2ParseResult` for full):
```ts
{
  intent: NluIntent;                  // legacy v1 surface; kept for back-compat
  scenario: NluScenario | null;       // legacy v1 surface
  categories: NluCategory[];          // canonical v2 field
  confirm_ready: boolean;
  assistant_reply: string | null;     // Layer 1 chat reply (already natural-language)
  suggested_clarify_question: string | null;
  suggested_quick_picks: QuickPick[] | null;

  // ─── The bits this doc cares about ────────────────────────────
  __v2_state: IntentState;            // post-coerce structured state
  __v2_action: RouterAction;          // discriminated union — switch on .type
}
```

### 2. Switch on `__v2_action.type`

```ts
const action = result.__v2_action;
const reply = result.assistant_reply ?? "";

// Always render the assistant reply as a chat bubble FIRST.
appendMessage({ role: "assistant", text: reply });

switch (action.type) {
  case "apply_profile_patch":
    await dispatchProfilePatch(action.patch);
    break;

  case "show_confirm_card":
    renderConfirmCard({ kind: action.kind, state: action.state, directBooking: action.directBooking });
    break;

  case "ask_clarification":
    renderQuickPicks(action.suggested_quick_picks ?? result.suggested_quick_picks);
    break;

  case "continue_chat":
    // Already rendered the reply above — no additional UI.
    break;
}
```

**Discriminated-union narrowing tip**: capture `action` to a local `const` before
spreading into a `setState` callback. TypeScript loses narrowing inside
closures over the union (this bit me in `app/dev/profile-gap-flow/page.tsx`,
fixed with `const action = result.action; switch (action.type) { ... }`).

---

## Action enumeration

### `apply_profile_patch` — NEW in commit `76e35b9`

The user said "save my DOB 1995/05/15" / "我的护照号 A1234567" / etc. Patch
the profile, **don't advance the booking pipeline**.

```ts
{ type: "apply_profile_patch"; patch: ProfilePatch }
```

`ProfilePatch` is `Partial<Record<ProfileEditField, string>>`. The 13 keys
mirror codex's backend canonical schema:
```
first_name, last_name, email, phone,
date_of_birth, passport_number, passport_expiry, passport_country,
address_line1, city, state, zip, country
```

Pre-normalized:
- Date fields are ISO `YYYY-MM-DD` (extractor resolves "May 15 1995" → "1995-05-15")
- Phone keeps user punctuation
- Country is 2-letter ISO when recognizable, else raw text
- Empty / whitespace values are dropped before reaching the consumer
- Empty patches are stripped — if `__v2_action.type === "apply_profile_patch"`, `patch` is GUARANTEED non-empty (router returns `continue_chat` instead)

#### Backend hookup (TBD with codex)

The endpoint is not built yet. Suggested path:

```http
PATCH /api/users/me/profile               (cookie-auth, browser)
PATCH /api/v1/users/me/profile            (API-key, third-party agents)

Content-Type: application/json
{
  "profile": {
    "first_name": "Jane",
    "last_name": "Doe",
    "phone": "+1 555 0100"
  }
}

→ 200 { "ok": true, "updated": ["first_name", "last_name", "phone"] }
→ 400 { "error": "validation_failed", "fields": { "phone": "too_short" } }
→ 401 { "error": "unauthenticated" }
```

Cookie-auth path is what the homepage chat needs. API-key path is for the
MCP/B2AI surface.

#### Reference implementation

```ts
async function dispatchProfilePatch(patch: ProfilePatch): Promise<void> {
  try {
    const res = await fetch("/api/users/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ profile: patch }),
    });
    if (!res.ok) {
      throw new Error(await readError(res));
    }
    showToast({
      tone: "success",
      text: `Saved ${prettyFieldList(Object.keys(patch))}.`,
    });
  } catch (err) {
    // Recovery: surface the failure as an assistant chat bubble.
    appendMessage({
      role: "assistant",
      text: `I couldn't save that — ${humanError(err)}. Mind trying again?`,
    });
  }
}
```

#### Mid-flow state preservation

Critical: `apply_profile_patch` does NOT wipe the ambient booking flow.
If the user was mid-booking (`state.scenario === "restaurant"`,
`state.restaurant.city === "New York"`, etc.), the next turn picks up
where they left off.

The router enforces this — `__v2_state.restaurant` is preserved unchanged
across a `profile_edit` turn. Consumer code should:

1. Apply the PATCH
2. Render a brief acknowledgement (assistant_reply already provides one)
3. **Do NOT clear conversation state, do NOT pop the restaurant booking card**
4. Wait for the next user turn

Verified by golden test PI3 (`golden-profile-edit.test.ts`).

#### Assistant reply pattern

The Layer 1 reply (`result.assistant_reply`) for a profile_edit turn is
already pre-shaped: "Saved first name → Jane, last name → Doe, phone →
+1 555 0100. ✓ I'll keep this for your next booking."

Don't override it. Render verbatim. The tone matches the rest of the
chat surface.

---

### `show_confirm_card`

Booking is fully specified, ready to commit.

```ts
{
  type: "show_confirm_card";
  kind: "plan" | "composite_plan" | "room" | "trip";
  state: IntentState;
  directBooking?: boolean;
}
```

Existing confirm card rendering already handles this — see
`components/ConfirmCard.tsx` (existing path; not Track B). When
`directBooking === true`, the user named one specific venue — emit
venue-specific copy ("Book Carbone for 2 on Apr 28") and skip the
recommendation pipeline.

`kind` mapping:
| Kind | When | UI |
|---|---|---|
| `plan` | Solo + 1 category | Single-card list flow |
| `composite_plan` | Solo + 2+ categories | Multi-column horizontal, no vote |
| `room` | Multi (Decision Room) + N categories | Multi-column, with vote |
| `trip` | Multi + all 4 categories | Legacy alias for room — TripPackageCard renderer |

---

### `ask_clarification`

Required field still missing. Show the assistant reply (already
asks the question) plus optional quick-pick buttons.

```ts
{
  type: "ask_clarification";
  missing: string[];
  suggested_quick_picks?: QuickPick[];
}
```

`missing[]` strings are NOT user-facing — they're field names
(`"city"`, `"check_in"`, `"member_names"`, `"party_mode"`, etc.).
The user-facing text lives in `result.assistant_reply`.

Render `suggested_quick_picks` as tap-to-fill chips. When user taps,
pre-fill the input with `pick.value` and submit.

---

### `continue_chat`

Default — assistant reply is the only UI. Used for chitchat,
out-of-scope responses, refinement requests (Phase 2 territory),
and the defensive fallback when `apply_profile_patch` was emitted
with an empty patch (router refuses to PATCH nothing).

```ts
{ type: "continue_chat" }
```

No special handling — `appendMessage({ role: "assistant", text: reply })`
is the whole dispatcher.

---

## Imports cheat sheet

```ts
// Types only (zero bundle cost)
import type {
  IntentState,
  RouterAction,
  ProfilePatch,
  ProfileEditField,
  NluV2ParseResult,
  QuickPick,
} from "@/lib/agent/nlu-v2";

// Constants (run-time)
import { PROFILE_EDIT_FIELDS } from "@/lib/agent/nlu-v2";

// Server-only (never import from client components)
import { analyzeConversationalV2, buildFallbackResult } from "@/lib/agent/nlu-v2";

// Pure functions safe in any environment
import { routeIntent, getMissingForScenario, buildStateSummary } from "@/lib/agent/nlu-v2";
```

---

## Worked examples (5 traces)

Each trace shows: user input → state → action → backend call → assistant
reply.

### 1. Standalone profile edit

```
User: "save my DOB 1995/05/15"

State: {
  intent: "profile_edit",
  scenario: null,
  categories: [],
  profile_patch: { date_of_birth: "1995-05-15" }
}

Action: { type: "apply_profile_patch", patch: { date_of_birth: "1995-05-15" } }

Backend: PATCH /api/users/me/profile { profile: { date_of_birth: "1995-05-15" } }

Reply: "Saved date of birth → 1995-05-15. ✓ I'll keep this for your next booking."
```

### 2. Mid-flow profile edit

```
PrevState: {
  intent: "create_plan",
  scenario: "restaurant",
  restaurant: { city: "New York", date: "2026-05-14", time: "19:00", party_size: 2 }
}

User: "实际我的 DOB 是 1995/5/15"

State: {
  intent: "profile_edit",
  scenario: "restaurant",            ← PRESERVED
  restaurant: { ...prev },           ← PRESERVED
  profile_patch: { date_of_birth: "1995-05-15" }
}

Action: { type: "apply_profile_patch", patch: { date_of_birth: "1995-05-15" } }

Backend: PATCH /api/users/me/profile { profile: { date_of_birth: "1995-05-15" } }

Reply: "Saved date of birth → 1995-05-15. ✓"

Next turn: user says "ok continue", state still has restaurant context — booking flow resumes.
```

### 3. Anti-pattern: casual age mention

```
User: "Book a flight to Tokyo, I'll be 30 next month"

State: {
  intent: "create_plan",      ← NOT profile_edit
  scenario: "flight",
  flight: { dest: "Tokyo" }
  // profile_patch absent
}

Action: { type: "ask_clarification", missing: ["origin", "departure_date"] }

No backend PATCH. Quick picks for origin city.
```

### 4. Direct booking (named venue)

```
User: "Book Carbone in NYC tomorrow 7pm for 2"

State: {
  intent: "create_plan",
  scenario: "restaurant",
  restaurant: {
    restaurant_name: "Carbone",
    city: "New York",
    date: "<tomorrow ISO>",
    time: "19:00",
    party_size: 2
  }
}

Action: {
  type: "show_confirm_card",
  kind: "plan",
  directBooking: true,
  state: <above>
}

Render confirm card with direct-booking copy:
"Book Carbone for 2 tomorrow at 7:00 PM in New York?"
```

### 5. Out-of-scope chitchat

```
User: "help me buy a laptop for coding"

State: {
  intent: "chitchat",
  scenario: null,
  planning_assumptions: ["out_of_scope: electronics shopping"]
}

Action: { type: "continue_chat" }

Reply: "I focus on travel — restaurants, hotels, flights, activities.
       For laptops you'd want a different tool. Anything travel I can help with?"
```

---

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| `/api/chat/parse` returns 5xx | `!res.ok` | Show generic "I had a hiccup, try again?" reply; keep prev state |
| `__v2_action` missing from response | Check before switch | Treat as `continue_chat`; log to telemetry |
| Action type unknown to consumer (forward-compat) | `default:` in switch | Fall through to `continue_chat` rendering; surface `assistant_reply` only |
| PATCH endpoint returns validation error | `400 { error, fields }` | Append assistant message with field-specific guidance ("Phone needs at least 7 digits — could you double-check?"); don't crash |
| PATCH endpoint returns 401 | Unauthenticated | Open the auth modal / redirect to /sign-in; queue the patch for retry post-auth |
| Network failure | catch | Toast "Couldn't reach the server — your message wasn't sent." Don't silently lose the user input |

---

## Reference

- Live dispatch demo: `/dev/profile-gap-flow` — clone its `handleSend` function for the real wiring
- Schema reference: `/dev/profile-gap-demo` — visualizes the 13-field canonical schema + wire normalization
- Phase 0 contract (separate but related): `benchmark/PHASE0_REPORT_CONTRACT.md`
- Backend canonical fields: `components/profile-gap/types.ts:CANONICAL_FIELD_IDS` (mirrored at `lib/agent/nlu-v2/types.ts:PROFILE_EDIT_FIELDS`)
- Tests covering every branch: `lib/agent/nlu-v2/__tests__/golden-profile-edit.test.ts` (21 cases)

---

## Open questions for codex

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) or
   `/api/v1/users/me/profile` (API-key)? Both? When does the cookie-auth
   proxy for `/api/v1/*` land?
2. **Validation contract** — what's the canonical error shape the
   frontend should expect on field-level rejection (DOB in the future,
   phone with non-digits, etc.)?
3. **Idempotency** — is PATCH idempotent on this endpoint? If user
   re-sends the same patch (network retry), does it 200 silently or 409?
4. **Telemetry** — should every `apply_profile_patch` dispatch emit a
   client telemetry event (e.g. `nlu.profile_edit.applied`)? Lets us
   spot extractor accuracy regressions in production.
5. **Mid-flow state preservation in MCP path** — when the chat surface
   is the MCP `tools/call` (not browser), how do we ack back to the
   third-party agent? Suggest returning the patched profile in the
   tool result + leaving booking state for the next call.

These get resolved when codex picks up the chat-panel hookup. Until
then, this doc captures the contract Track B is committing to honor.
