/**
 * /dev — Dev surface landing page.
 *
 * Lists every Track B dev route + canonical strategy docs in one place.
 * Codex's session-start ritual + my own debug loop both benefit from a
 * single index with status badges. Routes group by Phase 0 importance.
 *
 * Server component — no fetch, no state, just a static index. Cheap to
 * render, no API dependency. Source of truth for routes is THIS file;
 * if you add a new /dev/* page, add an entry here.
 */

import Link from "next/link";

interface DevRoute {
  href: string;
  title: string;
  blurb: string;
  status: "live" | "mock" | "spec";
  /** What you'd open this for. Keep tight. */
  useCase: string;
}

interface DocLink {
  href: string;
  title: string;
  blurb: string;
  status?: "active" | "blocked" | "archive-candidate";
}

const PHASE_0_ROUTES: DevRoute[] = [
  {
    href: "/dev/resy-probe-runs",
    title: "Resy availability probe runs",
    blurb:
      "Cheap no-token probe of Resy availability for Phase 0 fixture cases. Recommended-case card + per-case detail drawer (date/time/covers, exact venue match, slots table, blocker signals) + copy-paste live command. Probe-first: don't burn an OpenAI token unless this dashboard says use_for_live_fill_test.",
    status: "live",
    useCase:
      "Open BEFORE asking codex to spend a live R-003 / R-030 token. If no case is recommended, generate a fresh probe with `npm run probe:resy`. Codex's runner: scripts/probe-resy-availability.ts.",
  },
  {
    href: "/dev/benchmark-runs",
    title: "Phase 0 benchmark runs",
    blurb:
      "Live consumer of codex's /api/dev/benchmark-runs. Headline metrics + 8-bucket distribution + failure taxonomy chart + per-case drawer + GateBreakdown analyzer + Validator paste panel + ArtifactRail (taskId / timeline / strategy log + cross-dashboard pointers).",
    status: "live",
    useCase:
      "Open this when codex pushes a new benchmark/runs/*.json. Click a case to see ArtifactRail + cross-dashboard links to probe / debug-screenshots.",
  },
  {
    href: "/dev/debug-artifacts",
    title: "Debug artifacts viewer",
    blurb:
      "Reads worker/.debug-screenshots/<provider>/<run>/. summary.json + page.png lightbox + sandboxed page.html iframe. Newest-first with per-provider 'Latest run' shortcut. Captures land here when the worker hits a terminal failure.",
    status: "live",
    useCase:
      "Open after a failed live run. Pair with /dev/benchmark-runs (run report) and /dev/resy-probe-runs (was the case probe-validated?) to triangulate root cause.",
  },
];

const NLU_PROFILE_ROUTES: DevRoute[] = [
  {
    href: "/dev/profile-gap-demo",
    title: "ProfileGapCard schema reference",
    blurb:
      "Contract reference for the canonical 13 profile fields: legend (canonical / legacy / UI-only / payment) + wire trace (missing[] → normalize → partition) + live JSON payload preview that mirrors what /continue would send.",
    status: "live",
    useCase:
      "When wiring profile-gap into a new surface (chat panel / task page / MCP). Shows the exact contract with codex's needs_profile_data shape.",
  },
  {
    href: "/dev/profile-gap-flow",
    title: "ProfileGapCard end-to-end mock",
    blurb:
      "Two-pane simulator: fake chat panel (left) drives REAL coerceIntentState + routeIntent (production code) with a stub LLM extractor. Inspector (right) shows last action / mock backend profile / IntentState / raw extractor JSON.",
    status: "mock",
    useCase:
      "When designing the chat-panel hookup. Clone handleSend, replace mock backend with real fetch — same dispatch shape.",
  },
  {
    href: "/dev/path-b-demo",
    title: "Path B fixture explorer",
    blurb:
      "Phase 1 #7 path B no-token sandbox. 3 toggleable fixture states (missing fields / save success / save failure) exercising the SAME decideProfileGap + makeProfileGapOnSave helpers production uses. Event log shows PATCH/refetch/booking dispatches in order.",
    status: "live",
    useCase:
      "Verify path B control flow without burning OpenAI tokens. Use to confirm save-failure case does NOT resume booking (codex's hardening contract PB-SAVE-2).",
  },
];

const TASK_TIMELINE_ROUTES: DevRoute[] = [
  {
    href: "/dev/timeline-demo",
    title: "Task Timeline (single-task)",
    blurb:
      "useTimelineEvents 3-tier defensive loader (SSE → polled JSON → fixture) + useSnapshots. Renders against fixture data; ready to swap for cookie-auth /api/v1/travel-tasks/:id once that proxy lands.",
    status: "mock",
    useCase:
      "Verify Timeline component renders a job's lifecycle correctly before wiring to real /tasks/[taskId] page.",
  },
  {
    href: "/dev/dr-timeline-demo",
    title: "Task Timeline (Decision Room)",
    blurb:
      "Multi-member Decision Room timeline view. Renders coordinated voting + per-member-task progress.",
    status: "mock",
    useCase: "Verify multi-task timeline composition in the DR private-message context.",
  },
];

const TASK_DETAIL_DEMOS: DevRoute[] = [
  {
    href: "/tasks/demo-executing",
    title: "/tasks/[taskId] — executing demo",
    blurb:
      "Production-shape task detail page in the 'executing' state. Renders TaskTimelinePanel + side rail (booking job meta + Cancel action). When cookie-auth proxy lands, real UUIDs Just Work.",
    status: "mock",
    useCase: "Verify the live-running view (most common state in real bookings).",
  },
  {
    href: "/tasks/demo-awaiting-profile",
    title: "/tasks/[taskId] — awaiting_profile demo",
    blurb:
      "Same page, demonstrates ProfileGapCard inline when the task needs DOB / phone / etc. onSave swap point ready for codex's /continue endpoint.",
    status: "mock",
    useCase: "Verify the profile-gap inline form flow + onSave wiring.",
  },
  {
    href: "/tasks/demo-awaiting-otp",
    title: "/tasks/[taskId] — awaiting_otp demo",
    blurb:
      "OTP wall state (Phase 0 OTP transitional rule § 7.5). Pairs with WARM_SESSION_STRATEGY when codex unblocks the doc.",
    status: "mock",
    useCase: "Verify how the OTP wait state surfaces to the user.",
  },
  {
    href: "/tasks/demo-ready-for-confirmation",
    title: "/tasks/[taskId] — ready_for_confirmation demo",
    blurb: "Final-confirm-button state (Phase 0 success bucket). Confirm card + snapshot link in main column.",
    status: "mock",
    useCase: "Verify the success path UX.",
  },
  {
    href: "/tasks/demo-failed",
    title: "/tasks/[taskId] — failed demo",
    blurb:
      "Failure state with terminalReason + terminalCode surfaced. Mirrors the navigation-drift R-003 case (final URL contains /search) so the failure card has realistic content.",
    status: "mock",
    useCase: "Verify the failure UX + how terminal info renders.",
  },
];

const STRATEGY_DOCS: DocLink[] = [
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/BENCHMARK_RESTAURANT_100.md",
    title: "BENCHMARK_RESTAURANT_100.md",
    blurb:
      "Phase 0 acceptance gate spec. 100 cases + 4-metric thresholds + § 3 taxonomy + § 7.5 OTP transitional rule. Source of truth for what 'Phase 0 declared' means.",
    status: "active",
  },
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/WARM_SESSION_STRATEGY.md",
    title: "WARM_SESSION_STRATEGY.md",
    blurb:
      "Phase 0 OTP bypass via Playwright storageState. 3-step PoC plan + 5 risks + decision tree. BLOCKED until R-003 reaches OTP layer post-navigation-repair.",
    status: "blocked",
  },
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/NLU_CONSUMER_CONTRACT.md",
    title: "NLU_CONSUMER_CONTRACT.md",
    blurb:
      "Chat panel hookup contract. 5 RouterAction dispatch traces + apply_profile_patch deep dive + 5 open questions for codex.",
    status: "active",
  },
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/EXECUTOR_V2_PIVOT.md",
    title: "EXECUTOR_V2_PIVOT.md",
    blurb:
      "Track A/B pivot doc. Why we moved to Computer Use as default executor + what didn't change (NLU/DR/profile/queue/MCP — the moat).",
    status: "active",
  },
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/PROJECT_SUMMARY.md",
    title: "PROJECT_SUMMARY.md",
    blurb:
      "High-level state + architecture + Browserbase roadmap + Phase 0 doctrine. Time-reversed release notes.",
    status: "active",
  },
];

const COORDINATION = [
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/.coordination/codex.md",
    title: "codex.md (Track A state)",
    blurb: "Read on origin/master. What codex is doing right now + their open questions for me.",
  },
  {
    href: "https://github.com/Kakarottoooo/onegent/blob/master/.coordination/claude.md",
    title: "claude.md (Track B state)",
    blurb: "Read on this branch. What I'm doing + blockers on codex + recently shipped.",
  },
];

export default function DevLandingPage() {
  return (
    <main className="dev-landing">
      <header className="dev-landing__top">
        <h1 className="dev-landing__title">Dev surfaces</h1>
        <p className="dev-landing__subtitle">
          Track B dev routes + canonical strategy docs. If you can&apos;t find what
          you need on the homepage, it&apos;s probably here.
        </p>
      </header>

      <Section title="Phase 0 critical path" tone="critical">
        {PHASE_0_ROUTES.map((r) => (
          <RouteCard key={r.href} {...r} />
        ))}
      </Section>

      <Section title="NLU + ProfileGap" tone="default">
        {NLU_PROFILE_ROUTES.map((r) => (
          <RouteCard key={r.href} {...r} />
        ))}
      </Section>

      <Section title="Task Timeline (Phase 1 surfaces)" tone="default">
        {TASK_TIMELINE_ROUTES.map((r) => (
          <RouteCard key={r.href} {...r} />
        ))}
      </Section>

      <Section title="Task detail page demos (/tasks/[taskId])" tone="default">
        {TASK_DETAIL_DEMOS.map((r) => (
          <RouteCard key={r.href} {...r} />
        ))}
      </Section>

      <Section title="Strategy docs" tone="muted">
        {STRATEGY_DOCS.map((d) => (
          <DocCard key={d.href} {...d} />
        ))}
      </Section>

      <Section title="Coordination protocol" tone="muted">
        {COORDINATION.map((d) => (
          <DocCard key={d.href} {...d} />
        ))}
      </Section>

      <footer className="dev-landing__footer">
        <p>
          Updated when a new <code>/dev/*</code> route or canonical doc lands.
          Source: <code>app/dev/page.tsx</code>.
        </p>
      </footer>

      <DevLandingStyles />
    </main>
  );
}

/* ─── Building blocks ─────────────────────────────────────────────── */

interface SectionProps {
  title: string;
  tone: "critical" | "default" | "muted";
  children: React.ReactNode;
}

function Section({ title, tone, children }: SectionProps) {
  return (
    <section className={`dev-landing__section dev-landing__section--${tone}`}>
      <h2 className="dev-landing__section-title">{title}</h2>
      <div className="dev-landing__cards">{children}</div>
    </section>
  );
}

function RouteCard({ href, title, blurb, status, useCase }: DevRoute) {
  return (
    <Link href={href} className="dev-landing__card">
      <div className="dev-landing__card-row">
        <h3 className="dev-landing__card-title">{title}</h3>
        <StatusPill status={status} />
      </div>
      <p className="dev-landing__card-blurb">{blurb}</p>
      <p className="dev-landing__card-use">
        <strong>Use when:</strong> {useCase}
      </p>
      <p className="dev-landing__card-href">
        <code>{href}</code>
      </p>
    </Link>
  );
}

function DocCard({ href, title, blurb, status }: DocLink) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="dev-landing__card dev-landing__card--doc"
    >
      <div className="dev-landing__card-row">
        <h3 className="dev-landing__card-title">{title}</h3>
        {status && <DocStatusPill status={status} />}
      </div>
      <p className="dev-landing__card-blurb">{blurb}</p>
    </a>
  );
}

function StatusPill({ status }: { status: DevRoute["status"] }) {
  const label =
    status === "live"
      ? "Live"
      : status === "mock"
      ? "Mock"
      : "Spec";
  return (
    <span className={`dev-landing__pill dev-landing__pill--${status}`}>{label}</span>
  );
}

function DocStatusPill({ status }: { status: NonNullable<DocLink["status"]> }) {
  const label =
    status === "active"
      ? "Active"
      : status === "blocked"
      ? "Blocked"
      : "Archive?";
  return (
    <span className={`dev-landing__pill dev-landing__pill--${status}`}>{label}</span>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function DevLandingStyles() {
  return (
    <style>{`
      .dev-landing {
        --ink-2: #f3f4f6;
        --ink-3: #e5e7eb;
        --ink-6: #6b7280;
        --ink-7: #4b5563;
        --ink-8: #1f2937;
        --ink-9: #111827;
        --card: #ffffff;
        --bg: #fafafa;

        --tone-good: #16a34a;
        --tone-good-bg: rgba(22, 163, 74, 0.10);
        --tone-good-border: rgba(22, 163, 74, 0.30);
        --tone-warn: #f59e0b;
        --tone-warn-bg: rgba(245, 158, 11, 0.12);
        --tone-warn-border: rgba(245, 158, 11, 0.32);
        --tone-ok: #0ea5e9;
        --tone-ok-bg: rgba(14, 165, 233, 0.10);
        --tone-ok-border: rgba(14, 165, 233, 0.30);
        --tone-bad: #b91c1c;
        --tone-bad-bg: rgba(185, 28, 28, 0.10);
        --tone-bad-border: rgba(185, 28, 28, 0.30);

        max-width: 1100px;
        margin: 0 auto;
        padding: 36px 28px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        min-height: 100vh;
        color: var(--ink-9);
      }
      .dev-landing__top { margin-bottom: 28px; }
      .dev-landing__title {
        margin: 0 0 6px;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .dev-landing__subtitle {
        margin: 0;
        font-size: 13.5px;
        color: var(--ink-7);
        line-height: 1.5;
      }
      .dev-landing__section { margin-top: 28px; }
      .dev-landing__section-title {
        margin: 0 0 12px;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-7);
      }
      .dev-landing__section--critical .dev-landing__section-title {
        color: var(--tone-warn);
      }
      .dev-landing__section--muted .dev-landing__section-title {
        color: var(--ink-6);
      }
      .dev-landing__cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 12px;
      }
      .dev-landing__card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px 18px;
        border: 1px solid var(--ink-3);
        border-radius: 10px;
        background: var(--card);
        text-decoration: none;
        color: inherit;
        transition: border-color 120ms, transform 120ms;
      }
      .dev-landing__card:hover {
        border-color: var(--tone-ok);
        transform: translateY(-1px);
      }
      .dev-landing__card--doc {
        background: linear-gradient(180deg, rgba(0,0,0,0.005), rgba(0,0,0,0));
      }
      .dev-landing__card-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .dev-landing__card-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--ink-9);
      }
      .dev-landing__card-blurb {
        margin: 0;
        font-size: 12.5px;
        color: var(--ink-7);
        line-height: 1.55;
      }
      .dev-landing__card-use {
        margin: 4px 0 0;
        font-size: 11.5px;
        color: var(--ink-6);
        line-height: 1.5;
      }
      .dev-landing__card-use strong {
        color: var(--ink-7);
        font-weight: 600;
      }
      .dev-landing__card-href {
        margin: 4px 0 0;
        font-size: 11px;
        color: var(--ink-6);
      }
      .dev-landing__card-href code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        background: var(--ink-2);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .dev-landing__pill {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .dev-landing__pill--live {
        color: var(--tone-good);
        background: var(--tone-good-bg);
        border: 1px solid var(--tone-good-border);
      }
      .dev-landing__pill--mock {
        color: var(--tone-ok);
        background: var(--tone-ok-bg);
        border: 1px solid var(--tone-ok-border);
      }
      .dev-landing__pill--spec {
        color: var(--ink-7);
        background: var(--ink-2);
        border: 1px solid var(--ink-3);
      }
      .dev-landing__pill--active {
        color: var(--tone-good);
        background: var(--tone-good-bg);
        border: 1px solid var(--tone-good-border);
      }
      .dev-landing__pill--blocked {
        color: var(--tone-warn);
        background: var(--tone-warn-bg);
        border: 1px solid var(--tone-warn-border);
      }
      .dev-landing__pill--archive-candidate {
        color: var(--ink-6);
        background: var(--ink-2);
        border: 1px solid var(--ink-3);
      }
      .dev-landing__footer {
        margin-top: 40px;
        padding-top: 16px;
        border-top: 1px solid var(--ink-3);
      }
      .dev-landing__footer p {
        margin: 0;
        font-size: 11.5px;
        color: var(--ink-6);
      }
      .dev-landing__footer code {
        font-family: ui-monospace, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
    `}</style>
  );
}
