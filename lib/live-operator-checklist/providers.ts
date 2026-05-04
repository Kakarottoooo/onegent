// Live operator checklist - per-provider hard stops, evidence collection
// targets, analyzer commands, and runbook links.
//
// This module is pure. It does not start a live provider, read the database,
// open a browser, or call OpenAI. It is consumed by the read-only
// /dev/live-operator-checklist page so the founder has one place to copy
// the right hard stops, the right grep, and the right analyzer command for
// a controlled live retry that the founder has already approved separately.

export type ProviderKey = "restaurant" | "expedia" | "hotel";

export interface EvidenceTarget {
  /** Short label for the row (e.g. "DB row"). */
  label: string;
  /** Description rendered below the label. */
  description: string;
  /** Concrete artifact path or example identifier. */
  path: string;
  /** Copy-ready command that reads that artifact. ASCII only. */
  command: string;
  /** Explains what the operator should look for. */
  whatToLookFor: string[];
}

export interface AnalyzerCommand {
  /** Short label for the analyzer entry. */
  label: string;
  /** Copy-ready CLI command. ASCII only. */
  command: string;
  /** What artifact bundle the analyzer reads. */
  bundleHint: string;
}

export interface RunbookLink {
  label: string;
  path: string;
  note: string;
}

export interface ProviderChecklist {
  key: ProviderKey;
  title: string;
  scope: string;
  /** Locked-in hard stops the operator must read before approving any retry. */
  hardStops: string[];
  /** Things to never do under any circumstance. */
  neverDo: string[];
  /** Evidence the operator must collect after the run. */
  evidence: EvidenceTarget[];
  /** Analyzer commands that classify the artifact bundle. */
  analyzers: AnalyzerCommand[];
  /** Runbooks that own this provider's controlled retry checklist. */
  runbooks: RunbookLink[];
}

const INTEGRATED_WORKTREE =
  "C:\\Users\\Gzw19\\onegent-integrated-20260504";

const RESTAURANT: ProviderChecklist = {
  key: "restaurant",
  title: "Restaurant (Resy / OpenTable)",
  scope:
    "Phase 0 restaurant controlled live debug. Founder approval covers exactly one provider/case.",
  hardStops: [
    "OTP, one-time code, SMS, or phone verification.",
    "CAPTCHA or bot challenge.",
    "Provider login or account-sensitive prompt.",
    "CVV or card number entry.",
    "Final reservation, final booking, or any irreversible confirmation click.",
    "Wrong restaurant, wrong date, wrong time, or wrong party size selected.",
    "Resy or OpenTable leaves the expected public search/details/checkout path.",
  ],
  neverDo: [
    "Never bypass OTP, CAPTCHA, login, or account checks.",
    "Never enter CVV.",
    "Never click final confirmation.",
    "Never start a broad Resy/OpenTable suite or retry loop after a single approved case.",
  ],
  evidence: [
    {
      label: "DB row",
      description:
        "Pull booking_jobs row(s) so the analyzer sees __source, scenario, params, terminal reason, decisionLog tail.",
      path: "booking_jobs.id, booking_jobs.steps[0]",
      command:
        "SELECT id, trip_label, status, created_at, updated_at, steps, task_id FROM booking_jobs WHERE id = '<retry-job-id>' OR trip_label ILIKE '%<venue>%' ORDER BY created_at DESC LIMIT 8;",
      whatToLookFor: [
        "steps[0].body.__source matches lib/core/execution-* (no legacy shape).",
        "steps[0].body.scenario is exactly 'restaurant'.",
        "steps[0].error / terminalReason / terminalCode tell the same story as logs and screenshots.",
        "decisionLog tail (last 12 entries) shows the real ladder, not a summary.",
      ],
    },
    {
      label: "Worker log grep",
      description:
        "Bounded Select-String over the active worktree's codex-worker.log. Capture only the relevant retry window.",
      path: `${INTEGRATED_WORKTREE}\\codex-worker.log`,
      command: `Select-String -Path ${INTEGRATED_WORKTREE}\\codex-worker.log -Pattern '<retry-job-id>|resy|opentable|guest_form|mobile_verify|paused_payment|safe_handoff|sold out|fully booked|F-AVAIL-NONE|captcha|login|OTP|CVV|final' -Context 2,3 | Select-Object -Last 200`,
      whatToLookFor: [
        "[resy][strategy ...] / [opentable][strategy ...] ladders.",
        "modal_disabled / details api failed / mobile_verify / paused_payment markers.",
        "Any login, CAPTCHA, OTP, CVV, payment, or final-confirmation signal -> stop and review.",
      ],
    },
    {
      label: "Provider screenshots",
      description:
        "Worker debug screenshots show the actual page state at each strategy step.",
      path: `${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots\\<provider>\\<run>\\`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots -Recurse -Include summary.json,page.png,page.html | Sort-Object LastWriteTime -Descending | Select-Object -First 10`,
      whatToLookFor: [
        "Did the worker land on the correct restaurant detail / checkout page?",
        "Did a modal/alert obscure the form?",
        "Does the screenshot match steps[0].error?",
      ],
    },
    {
      label: "Live snapshot JSON",
      description:
        "Live snapshots capture page url + base64 image at each tick. Useful for cross-checking task UI claims.",
      path: `${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id>\\*.json`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id> -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 8`,
      whatToLookFor: [
        "url field shows the actual public path the agent saw.",
        "imageBase64 present (live capture, not stale).",
      ],
    },
  ],
  analyzers: [
    {
      label: "Restaurant artifact analyzer",
      command:
        "npx tsx scripts/analyze-restaurant-artifact.ts .tmp\\restaurant-artifact-bundle.json",
      bundleHint:
        "Bundle template lives in docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md.",
    },
    {
      label: "Unified provider artifact CLI",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind restaurant .tmp\\restaurant-artifact-bundle.json",
      bundleHint:
        "Same bundle shape; one CLI also handles --kind expedia / --kind hotel.",
    },
  ],
  runbooks: [
    {
      label: "Restaurant artifact analysis",
      path: "docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
      note: "Per-class taxonomy + bundle shape + analyzer usage.",
    },
    {
      label: "Resy live debug playbook",
      path: "docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md",
      note: "Resy-specific evidence patterns and known failure ladders.",
    },
    {
      label: "Resy availability probe protocol",
      path: "docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md",
      note: "Run probe BEFORE burning a live token. Probe-positive = safe to attempt fill.",
    },
    {
      label: "R-003 live smoke runbook",
      path: "docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
      note: "Single-case live smoke checklist (codex-owned execution).",
    },
    {
      label: "Restaurant Phase 0 handoff",
      path: "docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md",
      note: "Durable continuation guide for restaurant work.",
    },
  ],
};

const EXPEDIA: ProviderChecklist = {
  key: "expedia",
  title: "Expedia Flight",
  scope:
    "One Expedia flight controlled retry after explicit founder approval. MCO->BNA Southwest is the canonical evidence path.",
  hardStops: [
    "Payment submission or final purchase confirmation.",
    "CVV request.",
    "OTP, CAPTCHA, phone verification, or login wall.",
    "Provider account-sensitive prompt.",
    "Wrong flight card selected (wrong airline, time, price, or route).",
    "Expedia leaves the expected public flight search or checkout path.",
  ],
  neverDo: [
    "Never bypass OTP, CAPTCHA, login, or account checks.",
    "Never enter CVV.",
    "Never click final booking or purchase confirmation.",
    "Never expand scope to Booking.com or Hotels.com unless founder explicitly approves a scope change.",
  ],
  evidence: [
    {
      label: "DB row",
      description:
        "Pull the latest flight booking_jobs row(s) for the retry. Confirm __source, scenario=flight, and target params (MCO/BNA/Southwest/WN 3084/$152).",
      path: "booking_jobs.id, booking_jobs.steps[0]",
      command:
        "SELECT id, trip_label, status, created_at, updated_at, steps, task_id FROM booking_jobs WHERE id = '<retry-job-id>' OR trip_label ILIKE '%BNA%' OR steps::text ILIKE '%MCO%' OR steps::text ILIKE '%WN 3084%' ORDER BY created_at DESC LIMIT 8;",
      whatToLookFor: [
        "steps[0].body.__source has a current core execution marker (no legacy shape).",
        "steps[0].body.scenario === 'flight'.",
        "steps[0].body.params has origin/dest/date/passengers/cabin_class/targetAirline/targetDepartureTime/targetFlightNumber/targetPrice.",
        "decisionLog tail tells the same story as the worker log.",
      ],
    },
    {
      label: "Worker log grep",
      description:
        "Bounded Select-String for Expedia flight-rpa signals plus hard-stop markers.",
      path: `${INTEGRATED_WORKTREE}\\codex-worker.log`,
      command: `Select-String -Path ${INTEGRATED_WORKTREE}\\codex-worker.log -Pattern '<retry-job-id>|flight-rpa|Expedia|Flight-card DOM scan|Trying locator fallback|Locator fallback matched|Flight match|Fare modal|Checkout reached|flight checkout was not reached|profile|payment|captcha|login|OTP|CVV|final' -Context 2,3 | Select-Object -Last 200`,
      whatToLookFor: [
        "Flight-card DOM scan failed -> followed by Trying locator fallback?",
        "Locator fallback matched flight card -> reached fare modal / checkout?",
        "Any login, CAPTCHA, OTP, CVV, payment, or final-confirmation signal -> stop.",
      ],
    },
    {
      label: "Provider screenshots",
      description:
        "Expedia flight RPA writes per-stage screenshots. Verify the target Southwest card was visible at scan time.",
      path: `${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots\\flight-rpa-*\\`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots -Filter 'flight-rpa-*' -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 4 | ForEach-Object { Get-ChildItem $_.FullName }`,
      whatToLookFor: [
        "Is the target Southwest card visible in 01-search-results.jpg?",
        "Is there a sign-in / member-prices / CAPTCHA panel blocking the click?",
        "Did Expedia navigate to fare selection / review / checkout / login / error?",
      ],
    },
    {
      label: "Live snapshot JSON",
      description: "Live snapshot of the retry session for cross-check.",
      path: `${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id>\\*.json`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id> -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 8`,
      whatToLookFor: [
        "url shows the actual public Expedia path the agent saw.",
        "imageBase64 present and not stale.",
      ],
    },
  ],
  analyzers: [
    {
      label: "Expedia retry analyzer",
      command:
        "npx tsx scripts/analyze-expedia-retry-artifact.ts .tmp\\expedia-retry-artifact-bundle.json",
      bundleHint:
        "Bundle template lives in docs/50-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json.",
    },
    {
      label: "Unified provider artifact CLI",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind expedia .tmp\\expedia-retry-artifact-bundle.json",
      bundleHint:
        "Same bundle shape as the Expedia analyzer; outputs paste-ready Markdown.",
    },
  ],
  runbooks: [
    {
      label: "Expedia controlled retry runbook",
      path: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      note: "Hard stops + exact prompt + preflight + evidence + analyzer states + success/failure taxonomy.",
    },
    {
      label: "Phase 2 vertical revival audit",
      path: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      note: "Cross-vertical Phase 2 status; confirms Expedia is candidate, not live verified.",
    },
    {
      label: "Provider runtime debug playbook",
      path: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      note: "DB + worker log + screenshots are the source of truth, not the task UI.",
    },
    {
      label: "Phase 2 sidecar coordination",
      path: "docs/10-coordination/phase2.md",
      note: "Latest Expedia evidence summary and authoritative DB row from the integrator.",
    },
  ],
};

const HOTEL: ProviderChecklist = {
  key: "hotel",
  title: "Hotel (Booking.com / Hotels.com)",
  scope:
    "One Booking.com hotel controlled retry after explicit founder approval. Hotels.com and Expedia hotel are deferred until Booking.com has fresh artifacts.",
  hardStops: [
    "Payment submission or final reserve/purchase confirmation.",
    "CVV request.",
    "OTP, CAPTCHA, phone verification, or login wall.",
    "Provider account-sensitive prompt.",
    "Wrong hotel, wrong dates, wrong room, wrong guest count, or wrong price selected.",
    "Booking.com / Hotels.com / Expedia leaves the expected public hotel path (search, detail, guest details, checkout).",
  ],
  neverDo: [
    "Never bypass OTP, CAPTCHA, login, or account checks.",
    "Never enter CVV.",
    "Never click final booking, reserve, purchase, or confirmation.",
    "Never start with Hotels.com or Expedia hotel unless founder approves a changed provider target.",
  ],
  evidence: [
    {
      label: "DB row",
      description:
        "Pull the latest hotel booking_jobs row(s). Confirm __source, scenario=hotel, and exact hotel/dates/guest params.",
      path: "booking_jobs.id, booking_jobs.steps[0]",
      command:
        "SELECT id, trip_label, status, created_at, updated_at, steps, task_id FROM booking_jobs WHERE id = '<retry-job-id>' OR trip_label ILIKE '%<hotel-name>%' OR steps::text ILIKE '%<hotel-name>%' OR steps::text ILIKE '%<checkin-date>%' ORDER BY created_at DESC LIMIT 8;",
      whatToLookFor: [
        "steps[0].body.__source has a current core execution marker.",
        "steps[0].body.scenario === 'hotel'.",
        "steps[0].body.params has hotel_name/city/checkin/checkout/adults/rooms.",
        "steps[0].terminalReason / terminalCode point at the actual provider boundary.",
      ],
    },
    {
      label: "Worker log grep",
      description:
        "Bounded Select-String over codex-worker.log for Booking.com / Hotels.com signals plus hard-stop markers.",
      path: `${INTEGRATED_WORKTREE}\\codex-worker.log`,
      command: `Select-String -Path ${INTEGRATED_WORKTREE}\\codex-worker.log -Pattern '<retry-job-id>|Booking.com|booking-com|Hotels.com|hotels-com|Expedia|hotel|normaliseStartUrl|searchresults|hotel detail|room|selected room|guest-details|guest details|final details|payment|paused_payment|checkout|sold out|fully booked|No exact matches|captcha|login|OTP|CVV|final' -Context 2,3 | Select-Object -Last 240`,
      whatToLookFor: [
        "normaliseStartUrl includes the intended hotel name and dates.",
        "Booking.com final state check: still on guest-details vs final details.",
        "paused_payment / payment field discovery markers (safe handoff).",
        "Any login, CAPTCHA, OTP, CVV, payment, or final-confirmation signal -> stop.",
      ],
    },
    {
      label: "Provider screenshots",
      description:
        "Booking.com / Hotels.com debug screenshots show search, detail, room reveal, guest details, and payment boundary states.",
      path: `${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots\\`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\worker\\.debug-screenshots -Recurse -Include summary.json,page.png | Sort-Object LastWriteTime -Descending | Select-Object -First 12`,
      whatToLookFor: [
        "Is the target hotel actually selected (not a Hotels.com Don-Don style wrong-venue match)?",
        "Are check-in/check-out dates correct?",
        "Did the worker reach guest details, final details, payment, or a safe boundary?",
        "Does the screenshot match steps[0].error?",
      ],
    },
    {
      label: "Live snapshot JSON",
      description: "Live snapshot of the retry session for cross-check.",
      path: `${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id>\\*.json`,
      command: `Get-ChildItem -Path ${INTEGRATED_WORKTREE}\\.debug-screenshots\\live\\<retry-job-id> -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 8`,
      whatToLookFor: [
        "url shows the actual public hotel path the agent saw.",
        "imageBase64 present and not stale.",
      ],
    },
  ],
  analyzers: [
    {
      label: "Hotel artifact analyzer (via unified CLI)",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\\hotel-retry-artifact-bundle.json",
      bundleHint:
        "Bundle template aligns with EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json; replace flight params with hotel params.",
    },
  ],
  runbooks: [
    {
      label: "Hotel controlled retry runbook",
      path: "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      note: "Hard stops + exact prompt + preflight + evidence + analyzer + success/failure taxonomy.",
    },
    {
      label: "Hotel vertical revival audit",
      path: "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
      note: "Booking.com / Hotels.com / Expedia hotel no-live audit; minimal hotel revival order.",
    },
    {
      label: "Phase 2 vertical revival audit",
      path: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      note: "Cross-vertical Phase 2 status. Hotel is needs_fresh_artifacts.",
    },
    {
      label: "Provider runtime debug playbook",
      path: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      note: "DB + worker log + screenshots are the source of truth, not the task UI.",
    },
  ],
};

export const PROVIDER_CHECKLISTS: ReadonlyArray<ProviderChecklist> = Object.freeze(
  [RESTAURANT, EXPEDIA, HOTEL],
);

export function listProviderChecklists(): ProviderChecklist[] {
  // Defensive shallow copy so consumers cannot mutate the frozen source.
  return PROVIDER_CHECKLISTS.map((entry) => ({
    ...entry,
    hardStops: [...entry.hardStops],
    neverDo: [...entry.neverDo],
    evidence: entry.evidence.map((target) => ({
      ...target,
      whatToLookFor: [...target.whatToLookFor],
    })),
    analyzers: entry.analyzers.map((analyzer) => ({ ...analyzer })),
    runbooks: entry.runbooks.map((runbook) => ({ ...runbook })),
  }));
}

export function getProviderChecklist(
  key: ProviderKey,
): ProviderChecklist | null {
  const found = PROVIDER_CHECKLISTS.find((entry) => entry.key === key);
  if (!found) return null;
  return listProviderChecklists().find((entry) => entry.key === key) ?? null;
}
