// lib/founder-e2e/fixtures.ts
//
// Typed data backing PHASE_1_FOUNDER_E2E.md. Two paths (Quick / Full),
// every step has a stable id, severity-on-fail, and surfaces array.
//
// Source of truth for: which steps exist, what each step is testing, what
// counts as a fail, and which steps are part of the Phase 1 #8 exit bar.
//
// Updates here MUST stay in sync with the doc — when adding a step:
//   1. Add it here (immutable id `<pathId>:<sectionId>:<index>`).
//   2. Reference it in the doc § A.* / § N.* prose.
//   3. If it's part of the exit bar, add to FOUNDER_E2E_EXIT_CRITERIA.

import type {
  ChecklistPath,
  ChecklistStep,
  ExitCriterionDefinition,
} from "./checklist";

// -----------------------------------------------------------------------------
// Quick path — 10 minutes, "today's build didn't crash"
// -----------------------------------------------------------------------------

const QUICK_STEPS: ReadonlyArray<ChecklistStep> = [
  {
    id: "quick:A.1:1",
    section: "A.1",
    title: "Boot dev server",
    whatToDo: [
      "1. cd /c/Users/Gzw19/onegent",
      "2. git fetch origin && git log --oneline origin/master -3",
      "3. npm run dev > ./dev.log 2>&1   (or `npx next dev --webpack` in detached worktree)",
      "4. Wait until the log says `Ready in <time>`.",
    ].join("\n"),
    expected:
      "Dev server prints `Ready in ...` and `http://localhost:3000` returns 200/302 to a manual `curl -I`.",
    warn: "Turbopack panic on symlinked node_modules — fall back to webpack flag.",
    surfaces: ["http://localhost:3000"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § A.1"],
  },
  {
    id: "quick:A.2:1",
    section: "A.2",
    title: "Auto smoke (npm run smoke:phase1)",
    whatToDo: ["1. In a second terminal: npm run smoke:phase1"].join("\n"),
    expected: "All 6 routes pass + exit code 0.",
    warn: "Any FAIL → STOP the walkthrough; below 60 minutes will be noise.",
    surfaces: [
      "/dev/path-b-demo",
      "/tasks/demo-executing",
      "/tasks/demo-awaiting-profile",
      "/tasks/demo-ready-for-confirmation",
      "/dev/benchmark-runs",
      "/dev/profile-gap-flow",
    ],
    severityOnFail: "P0",
    refs: ["PHASE_1_E2E_SMOKE.md", "PHASE_1_FOUNDER_E2E.md § A.2"],
  },
  {
    id: "quick:A.3:1",
    section: "A.3",
    title: "Real task create + cookie-auth polling + cancel",
    whatToDo: [
      "1. Login ziweiA at http://localhost:3000 .",
      '2. Send chat: "Buvette next Thursday 8pm solo dinner".',
      "3. Confirm task creation; should land on /tasks/<uuid>.",
      "4. DevTools → Network: confirm /api/v1/travel-tasks/<uuid> polls every ~5s with cookie attached.",
      '5. Click "Cancel task" → confirm.',
    ].join("\n"),
    expected:
      'Status pill flips to "Cancelled", polling stops, the cancel button disappears.',
    warn:
      "If polling is 401 → cookie auth broke (codex 48c80b2 regression). If state stays running after cancel → 7289ba0 regression.",
    surfaces: ["/tasks/<taskId>", "/api/v1/travel-tasks/", "/api/v1/execution-jobs/"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § A.3", "PHASE_1_PLAN.md #6, #7"],
  },
  {
    id: "quick:A.4:1",
    section: "A.4",
    title: "Inline ProfileGapCard (path B) renders in chat",
    whatToDo: [
      "1. With ziweiA (or ziweiB if profile is empty), send a request needing DOB / phone.",
      '   Example: "Carbone tonight 7pm party of 2".',
      "2. Wait for NLU to detect the gap.",
    ].join("\n"),
    expected:
      "Inline ProfileGapCard renders in the chat stream — orange accent. NOT the legacy InlineBookingProfileGate modal.",
    warn:
      "Modal popup → NEXT_PUBLIC_PROFILE_GAP_INLINE flag broke OR backend dropped payload.profile_gap.",
    surfaces: ["/", "/api/chat/parse"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § A.4", "PHASE_1_PLAN.md #7 path B"],
  },
  {
    id: "quick:A.5:1",
    section: "A.5",
    title: "Ownership boundary across accounts",
    whatToDo: [
      "1. Copy the task UUID created in A.3.",
      "2. Sign out → sign in as ziweiB.",
      "3. Paste /tasks/<uuid> into the URL bar.",
    ].join("\n"),
    expected:
      'Renders "Sign in to view this task" 401 card with no leaked title or content.',
    warn:
      "Leaking ziweiA's task title or content → P0 security incident; halt and ping codex.",
    surfaces: ["/tasks/<uuid>"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § A.5"],
  },
  {
    id: "quick:A.6:1",
    section: "A.6",
    title: "PATCH profile rejects payment fields",
    whatToDo: [
      "1. Copy __session cookie from the browser after ziweiA login.",
      "2. curl -X PATCH http://localhost:3000/api/v1/users/me/profile \\",
      '       -H "Cookie: __session=<paste>" \\',
      '       -H "Content-Type: application/json" \\',
      '       -d \'{"card_number": "4111111111111111"}\'',
    ].join("\n"),
    expected:
      "HTTP 4xx with body referencing 'payment fields not allowed' (or equivalent guard message).",
    warn:
      "HTTP 200 → P0 regulatory + security regression; payment data must NEVER touch the profile endpoint.",
    surfaces: ["/api/v1/users/me/profile"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § A.6", "PHASE_1_PLAN.md Audit Finding 5"],
  },
];

const QUICK_PATH: ChecklistPath = {
  id: "quick",
  title: "Quick path — today's build didn't crash",
  description:
    "10-minute first-pass smoke covering render, cookie-auth, ownership boundary, payment guard. NOT a sign-off; pre-flight only.",
  durationMin: 8,
  durationMax: 12,
  sections: [
    {
      id: "A.1",
      title: "A.1 Boot dev server",
      blurb: "Make sure the local dev server is up before any UI work.",
      steps: [QUICK_STEPS[0]],
    },
    {
      id: "A.2",
      title: "A.2 Auto smoke",
      blurb: "Headless render-level check across 6 critical surfaces.",
      steps: [QUICK_STEPS[1]],
    },
    {
      id: "A.3",
      title: "A.3 Real task / cookie / cancel",
      blurb: "End-to-end happy path on the main user surface.",
      steps: [QUICK_STEPS[2]],
    },
    {
      id: "A.4",
      title: "A.4 Profile gap card",
      blurb: "Inline path B vs. legacy modal regression check.",
      steps: [QUICK_STEPS[3]],
    },
    {
      id: "A.5",
      title: "A.5 Ownership boundary",
      blurb: "Make sure ziweiB cannot peek at ziweiA's task.",
      steps: [QUICK_STEPS[4]],
    },
    {
      id: "A.6",
      title: "A.6 Profile PATCH guard",
      blurb: "Defense in depth against payment data leaking into profile.",
      steps: [QUICK_STEPS[5]],
    },
  ],
};

// -----------------------------------------------------------------------------
// Full path — 60-90 minute sign-off (mirrors PHASE_1_FOUNDER_E2E.md § 0–§ 11)
// -----------------------------------------------------------------------------

const FULL_STEPS: ReadonlyArray<ChecklistStep> = [
  // § 0 Pre-flight
  {
    id: "full:0.1:1",
    section: "0.1",
    title: "Pre-flight environment",
    whatToDo: [
      "1. cd /c/Users/Gzw19/onegent && git fetch origin && git log --oneline origin/master -3",
      "2. Boot Next.js: npm run dev > ./dev.log 2>&1 (or webpack fallback)",
      "3. Boot worker: cd worker && npm run dev > ../worker.log 2>&1",
      "4. Open http://localhost:3000 in a fresh browser window.",
    ].join("\n"),
    expected:
      "Both dev.log and worker.log show `Ready` / `Listening`; homepage renders with sign-in button.",
    warn:
      "If worker is not running, real task in § 3 will hang at `executing`; that is expected, not a bug.",
    surfaces: ["http://localhost:3000"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 0.1"],
  },
  {
    id: "full:0.2:1",
    section: "0.2",
    title: "Test accounts present",
    whatToDo: [
      "Confirm ziweiA / ziweiB / ziweiC accounts in Clerk natural-tuna-90 dev instance, password manager has the secrets.",
    ].join("\n"),
    expected: "All three accounts log in successfully; sessions persist.",
    surfaces: ["/sign-in"],
    severityOnFail: "P1",
    refs: ["MEMORY.md test_accounts.md"],
  },
  {
    id: "full:0.3:1",
    section: "0.3",
    title: "DevTools open with Network filter",
    whatToDo: [
      'Open DevTools, filter Network on `/api/v1/`, keep Console tab visible for the full session.',
    ].join("\n"),
    expected: "Network and Console tabs visible throughout the walkthrough.",
    severityOnFail: "P3",
    refs: ["PHASE_1_FOUNDER_E2E.md § 0.3"],
  },
  {
    id: "full:0.4:1",
    section: "0.4",
    title: "Auto smoke (npm run smoke:phase1)",
    whatToDo: ["npm run smoke:phase1 — let it complete, capture exit code."].join("\n"),
    expected: "All 6 routes pass + exit code 0.",
    warn: "Any failure → halt walkthrough; fix renders first.",
    surfaces: [
      "/dev/path-b-demo",
      "/tasks/demo-executing",
      "/tasks/demo-awaiting-profile",
      "/tasks/demo-ready-for-confirmation",
      "/dev/benchmark-runs",
      "/dev/profile-gap-flow",
    ],
    severityOnFail: "P0",
    refs: ["PHASE_1_E2E_SMOKE.md"],
  },

  // § 1 Dev landing
  {
    id: "full:1:1",
    section: "1",
    title: "/dev landing index renders",
    whatToDo: ["Open http://localhost:3000/dev"].join("\n"),
    expected:
      "Phase 0 / NLU / Timeline route cards render with status badges. Strategy docs + Coordination links work. No console errors.",
    warn: "404 on any card / hydration mismatch / Server Component throw.",
    surfaces: ["/dev"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 1"],
  },

  // § 2 Demo states
  {
    id: "full:2.1:1",
    section: "2.1",
    title: "demo-executing UI",
    whatToDo: ["Open /tasks/demo-executing"].join("\n"),
    expected:
      'Title "Buvette in West Village next Thursday 8pm solo dinner" with active blue "Running" pill, Cancel button enabled, TaskTimelinePanel renders.',
    warn:
      "Status pill the wrong tone OR Cancel button disabled OR timeline panel throws.",
    surfaces: ["/tasks/demo-executing"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.1"],
  },
  {
    id: "full:2.2:1",
    section: "2.2",
    title: "demo-awaiting-profile UI + ProfileGapCard fill",
    whatToDo: [
      "1. Open /tasks/demo-awaiting-profile",
      "2. Verify ProfileGapCard renders with date_of_birth + phone fields.",
      "3. Fill DOB and phone; click Save and continue.",
    ].join("\n"),
    expected:
      "Orange `Need details` pill, ProfileGapCard inline, Save-and-continue disabled until at least one field is filled, alert shows GapSavePayload JSON.",
    warn:
      "Payment field accepted inline (P0 violation) / Save-and-continue clickable empty / wrong field type widget.",
    surfaces: ["/tasks/demo-awaiting-profile"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.2"],
  },
  {
    id: "full:2.3:1",
    section: "2.3",
    title: "demo-awaiting-otp UI",
    whatToDo: ["Open /tasks/demo-awaiting-otp"].join("\n"),
    expected:
      'Orange "Awaiting code" pill, copy mentions Resy verification code, founder-handoff messaging.',
    warn:
      "No founder-handoff messaging — Phase 0 § 7.5 mandates explicit hand-off copy.",
    surfaces: ["/tasks/demo-awaiting-otp"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.3", "BENCHMARK_RESTAURANT_100.md § 7.5"],
  },
  {
    id: "full:2.4:1",
    section: "2.4",
    title: "demo-ready-for-confirmation UI",
    whatToDo: ["Open /tasks/demo-ready-for-confirmation"].join("\n"),
    expected:
      'Green "Ready to confirm" pill, no confirm button (intentional), snapshot link present.',
    warn:
      "Adding a confirm button = P0 violation of payment-and-final-tap policy.",
    surfaces: ["/tasks/demo-ready-for-confirmation"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.4"],
  },
  {
    id: "full:2.5:1",
    section: "2.5",
    title: "demo-failed UI",
    whatToDo: ["Open /tasks/demo-failed"].join("\n"),
    expected:
      'Red "Failed" pill, terminal_reason copy visible, Try again or Back to tasks CTA.',
    warn:
      "Raw URL leaked into copy without translation; missing CTA.",
    surfaces: ["/tasks/demo-failed"],
    severityOnFail: "P2",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.5"],
  },
  {
    id: "full:2.6:1",
    section: "2.6",
    title: "Demo not-found fallback",
    whatToDo: ["Open /tasks/demo-bogus-state"].join("\n"),
    expected:
      "Friendly 'Demo not found' card listing the 5 valid demo IDs as clickable links.",
    warn: "500 error page instead of friendly fallback.",
    surfaces: ["/tasks/demo-bogus-state"],
    severityOnFail: "P2",
    refs: ["PHASE_1_FOUNDER_E2E.md § 2.6"],
  },

  // § 3 Real flow
  {
    id: "full:3.1:1",
    section: "3.1",
    title: "Sign in ziweiA",
    whatToDo: [
      "1. Click Sign in.",
      "2. Login as ziweiA.",
    ].join("\n"),
    expected: "Land on homepage signed in; Clerk session cookie set.",
    warn: "Clerk OAuth 401/502 / sign-in loop.",
    surfaces: ["/sign-in"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 3.1"],
  },
  {
    id: "full:3.2:1",
    section: "3.2",
    title: "Create real task via chat",
    whatToDo: [
      '1. Type "Buvette next Thursday 8pm solo dinner" and press Enter.',
      "2. Confirm the create-task card.",
    ].join("\n"),
    expected:
      "NLU classifies as restaurant + party_size; quick_picks or confirm-card surfaces; POST /api/chat/commit succeeds.",
    warn:
      "Wrong scenario detected / confirm card date mismatched / inline ProfileGapCard not modal.",
    surfaces: ["/", "/api/chat/parse", "/api/chat/commit"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 3.2"],
  },
  {
    id: "full:3.3:1",
    section: "3.3",
    title: "Real /tasks/[taskId] state polling",
    whatToDo: [
      "1. Open /tasks/<uuid>",
      "2. Watch DevTools Network for periodic /api/v1/travel-tasks/<uuid> requests.",
    ].join("\n"),
    expected:
      "Status pill renders (Running or Executing). Polling ~5s with __session cookie attached.",
    warn:
      "401 on polling (cookie-auth regression) / status frozen.",
    surfaces: ["/tasks/<uuid>", "/api/v1/travel-tasks/"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 3.3"],
  },
  {
    id: "full:3.4:1",
    section: "3.4",
    title: "Cancel real task transitions to cancelled",
    whatToDo: [
      "1. Click Cancel task on the real task page.",
      "2. Confirm cancellation.",
    ].join("\n"),
    expected:
      "POST /api/v1/execution-jobs/<jobId>/cancel returns 200; task.state flips to cancelled; polling stops; cancel button hidden.",
    warn: "Polling continues / state stays in non-terminal.",
    surfaces: ["/api/v1/execution-jobs/<jobId>/cancel"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 3.4"],
  },
  {
    id: "full:3.5:1",
    section: "3.5",
    title: "Ownership boundary (ziweiA → ziweiB)",
    whatToDo: [
      "1. Sign out ziweiA.",
      "2. Sign in ziweiB in incognito or a clean profile.",
      "3. Open the previous task UUID directly.",
    ].join("\n"),
    expected:
      "Sign-in card renders with no task content leaked. Distinguish 401 sign-in from 404 not-found.",
    warn: "Title or any task content leaked → P0 security.",
    surfaces: ["/tasks/<uuid>"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 3.5"],
  },

  // § 4 Profile PATCH endpoint
  {
    id: "full:4.1:1",
    section: "4.1",
    title: "Capture session cookie",
    whatToDo: [
      "DevTools → Application → Cookies → __session value copied.",
    ].join("\n"),
    expected: "Cookie value copied to clipboard.",
    severityOnFail: "P3",
    refs: ["PHASE_1_FOUNDER_E2E.md § 4.1"],
  },
  {
    id: "full:4.2:1",
    section: "4.2",
    title: "Empty PATCH triggers 400",
    whatToDo: [
      "Run curl -X PATCH /api/v1/users/me/profile -d '{}' -H 'Cookie: __session=...' .",
    ].join("\n"),
    expected:
      "HTTP 400 with `error.code = empty_profile_patch`. Confirms endpoint is alive and validating.",
    warn: "401 → cookie not honored. 404 → endpoint unregistered.",
    surfaces: ["/api/v1/users/me/profile"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 4.2"],
  },
  {
    id: "full:4.3:1",
    section: "4.3",
    title: "Single-field PATCH is partial",
    whatToDo: [
      "Run curl PATCH with body `{\"phone\": \"+15555550199\"}` and inspect response.profile.",
    ].join("\n"),
    expected:
      "HTTP 200, response.profile.phone updated, other fields unchanged.",
    warn: "Other fields wiped → endpoint behaving like PUT, not PATCH.",
    surfaces: ["/api/v1/users/me/profile"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 4.3"],
  },
  {
    id: "full:4.4:1",
    section: "4.4",
    title: "Payment field rejected (PATCH guard)",
    whatToDo: [
      "Run curl PATCH with body `{\"card_number\": \"4111111111111111\"}` .",
    ].join("\n"),
    expected:
      "HTTP 4xx with body mentioning payment fields are not allowed.",
    warn: "HTTP 200 → P0 regulatory regression.",
    surfaces: ["/api/v1/users/me/profile"],
    severityOnFail: "P0",
    refs: ["PHASE_1_FOUNDER_E2E.md § 4.4"],
  },

  // § 5 Benchmark dashboard
  {
    id: "full:5:1",
    section: "5",
    title: "Benchmark dashboard renders",
    whatToDo: ["Open /dev/benchmark-runs and click into a run."].join("\n"),
    expected:
      "Run list, 4 metric cards, GateBreakdown rows, recommended fixes, per-case drawer all render.",
    warn:
      "Console errors / GateBreakdown threshold mismatch / Validator missing fields.",
    surfaces: ["/dev/benchmark-runs"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 5"],
  },
  {
    id: "full:5:2",
    section: "5",
    title: "ValidatorPanel paste catches malformed JSON",
    whatToDo: [
      "Paste a benchmark JSON missing a known field; confirm Validator surfaces an error.",
    ].join("\n"),
    expected:
      "Validator lists the missing field with shape hint. § 7.5 OTP soft-warning fires when applicable.",
    warn: "Validator silently accepts malformed input.",
    surfaces: ["/dev/benchmark-runs"],
    severityOnFail: "P2",
    refs: ["PHASE_1_FOUNDER_E2E.md § 5"],
  },

  // § 6 Profile gap mock pipeline
  {
    id: "full:6:1",
    section: "6",
    title: "Profile-gap-flow apply_profile_patch",
    whatToDo: [
      "Open /dev/profile-gap-flow and send: my email is foo@example.com and phone is 555-1234",
    ].join("\n"),
    expected:
      "Inspector shows apply_profile_patch action; mock backend now has email + phone; IntentState scenario = profile_edit.",
    warn: "Inspector throws or apply_profile_patch missing.",
    surfaces: ["/dev/profile-gap-flow"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 6"],
  },
  {
    id: "full:6:2",
    section: "6",
    title: "Profile-gap-flow needs_profile_data + gap fill",
    whatToDo: [
      "Send: book me a restaurant tonight 7pm party of 2 — observe ProfileGapCard.",
      "Fill all gap fields and click Save and continue.",
    ].join("\n"),
    expected:
      "ProfileGapCard renders inline; missing first_name / last_name / DOB highlighted; mock PATCH dispatched.",
    warn:
      "ProfileGapCard hides chat history / fields out of order / mock pipeline error.",
    surfaces: ["/dev/profile-gap-flow"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 6"],
  },

  // § 7 Decision Room
  {
    id: "full:7.1:1",
    section: "7.1",
    title: "Create Decision Room",
    whatToDo: [
      'Login ziweiA, send "让我和小明小红一起决定周末去哪吃饭".',
    ].join("\n"),
    expected:
      "NLU classifies as multi_member_room scenario; DR created; redirected to /rooms/<id>.",
    warn: "NLU mis-classifies; DR fails to create.",
    surfaces: ["/rooms/<id>"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 7.1"],
  },
  {
    id: "full:7.2:1",
    section: "7.2",
    title: "Invite ziweiB to room",
    whatToDo: [
      "1. Click Invite member; enter ziweiB email.",
      "2. Login ziweiB in another browser/incognito; open the DR link.",
    ].join("\n"),
    expected:
      "ziweiB in member list; ziweiB sees the DR conversation; ziweiB chat input visible.",
    warn: "Realtime sync drops; ziweiB sees nothing.",
    surfaces: ["/rooms/<id>"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 7.2"],
  },
  {
    id: "full:7.3:1",
    section: "7.3",
    title: "Multi-user chat regression",
    whatToDo: [
      'Both accounts type into chat ("我想吃日料" / "我想吃中餐"); wait for NLU follow-up.',
    ].join("\n"),
    expected:
      "Typing indicators work; member avatars render; NLU recommends quick_picks; payer attribution correct.",
    warn:
      "Realtime sync gaps / payer label wrong / NLU crash.",
    surfaces: ["/rooms/<id>"],
    severityOnFail: "P1",
    refs: ["PHASE_1_FOUNDER_E2E.md § 7.3"],
  },
];

const FULL_PATH: ChecklistPath = {
  id: "full",
  title: "Full path — Phase 1 #8 sign-off",
  description:
    "60-90 minute walkthrough covering all demo states, real flow, profile PATCH endpoint, benchmark dashboard, mock profile-gap pipeline, Decision Room. Required before declaring Phase 1.",
  durationMin: 60,
  durationMax: 90,
  sections: [
    {
      id: "0",
      title: "0. Pre-flight",
      blurb: "Boot servers, accounts, DevTools.",
      steps: FULL_STEPS.filter((s) => s.section.startsWith("0.")),
    },
    {
      id: "1",
      title: "1. /dev landing",
      blurb: "Health check the index page.",
      steps: FULL_STEPS.filter((s) => s.section === "1"),
    },
    {
      id: "2",
      title: "2. Task surface — 5 demo states",
      blurb: "UI quality for each demo state + not-found fallback.",
      steps: FULL_STEPS.filter((s) => s.section.startsWith("2.")),
    },
    {
      id: "3",
      title: "3. Task surface — real flow",
      blurb: "Sign in, create, poll, cancel, ownership boundary.",
      steps: FULL_STEPS.filter((s) => s.section.startsWith("3.")),
    },
    {
      id: "4",
      title: "4. Profile PATCH endpoint",
      blurb: "Backend contract for /api/v1/users/me/profile.",
      steps: FULL_STEPS.filter((s) => s.section.startsWith("4.")),
    },
    {
      id: "5",
      title: "5. Benchmark dashboard",
      blurb: "Phase 0 dashboard render + validator paste.",
      steps: FULL_STEPS.filter((s) => s.section === "5"),
    },
    {
      id: "6",
      title: "6. Profile-gap-flow mock pipeline",
      blurb: "End-to-end mock chat → NLU → ProfileGapCard.",
      steps: FULL_STEPS.filter((s) => s.section === "6"),
    },
    {
      id: "7",
      title: "7. Decision Room",
      blurb: "Multi-user chat regression check.",
      steps: FULL_STEPS.filter((s) => s.section.startsWith("7.")),
    },
  ],
};

// -----------------------------------------------------------------------------
// Public registry
// -----------------------------------------------------------------------------

export const FOUNDER_E2E_PATHS: Record<"quick" | "full", ChecklistPath> = {
  quick: QUICK_PATH,
  full: FULL_PATH,
};

export function getFounderE2ePath(pathId: "quick" | "full"): ChecklistPath {
  return FOUNDER_E2E_PATHS[pathId];
}

// -----------------------------------------------------------------------------
// Exit criteria — mirrors PHASE_1_FOUNDER_E2E.md § 10
//
// Both paths share the criteria definitions, but the Quick path will only
// exercise a subset (Quick-only criteria for first-pass smoke). The Full path
// exit bar is the canonical Phase 1 #8 declaration gate.
// -----------------------------------------------------------------------------

export const FOUNDER_E2E_EXIT_CRITERIA_FULL: ReadonlyArray<ExitCriterionDefinition> = [
  {
    id: "demo-states-rendered",
    title: "All 5 demo states render at Apple/Linear/Stripe quality bar",
    requiresStepIds: [
      "full:2.1:1",
      "full:2.2:1",
      "full:2.3:1",
      "full:2.4:1",
      "full:2.5:1",
    ],
  },
  {
    id: "real-task-flow",
    title: "Real task create → polling → cancel runs cleanly",
    requiresStepIds: ["full:3.2:1", "full:3.3:1", "full:3.4:1"],
  },
  {
    id: "ownership-boundary",
    title: "Cookie auth isolates task visibility across accounts",
    requiresStepIds: ["full:3.5:1"],
  },
  {
    id: "profile-patch",
    title: "PATCH /profile is partial + rejects payment fields",
    requiresStepIds: ["full:4.2:1", "full:4.3:1", "full:4.4:1"],
  },
  {
    id: "benchmark-dashboard",
    title: "Benchmark dashboard renders + validator paste works",
    requiresStepIds: ["full:5:1", "full:5:2"],
  },
  {
    id: "mock-profile-gap",
    title: "Mock profile-gap pipeline drives ProfileGapCard correctly",
    requiresStepIds: ["full:6:1", "full:6:2"],
  },
  {
    id: "decision-room",
    title: "Decision Room multi-user regression clean",
    requiresStepIds: ["full:7.1:1", "full:7.2:1", "full:7.3:1"],
  },
  {
    id: "smoke-and-preflight",
    title: "Auto smoke + dev server + ownership all green",
    requiresStepIds: ["full:0.1:1", "full:0.4:1"],
  },
];

export const FOUNDER_E2E_EXIT_CRITERIA_QUICK: ReadonlyArray<ExitCriterionDefinition> = [
  {
    id: "quick-render",
    title: "Dev server up + smoke renders",
    requiresStepIds: ["quick:A.1:1", "quick:A.2:1"],
  },
  {
    id: "quick-cookie-auth",
    title: "Cookie auth + cancel transition",
    requiresStepIds: ["quick:A.3:1"],
  },
  {
    id: "quick-profile-gap",
    title: "Inline ProfileGapCard renders",
    requiresStepIds: ["quick:A.4:1"],
  },
  {
    id: "quick-ownership",
    title: "Ownership boundary holds",
    requiresStepIds: ["quick:A.5:1"],
  },
  {
    id: "quick-payment-guard",
    title: "Payment fields rejected by /profile PATCH",
    requiresStepIds: ["quick:A.6:1"],
  },
];

export function getExitCriteriaForPath(
  pathId: "quick" | "full",
): ReadonlyArray<ExitCriterionDefinition> {
  return pathId === "quick"
    ? FOUNDER_E2E_EXIT_CRITERIA_QUICK
    : FOUNDER_E2E_EXIT_CRITERIA_FULL;
}
