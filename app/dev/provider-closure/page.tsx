/**
 * /dev/provider-closure - Provider Closure Operator Room.
 *
 * READ-ONLY. Three vertical lanes (restaurant / flight / hotel)
 * organize the closure work an operator drives between live
 * provider attempts. Each lane shows: closure posture, last known
 * blocker, evidence required, primary runbook + supporting
 * references, safe hard stops, what to inspect after run, copy-
 * ready CLI commands, taxonomy classes, and a source-of-truth
 * reminder.
 *
 * Hard rules (verified by static guard tests):
 *   - No live runs, no retry, no resume, no start, no execute,
 *     no submit, no payment, no OTP, no CAPTCHA bypass.
 *   - The only mutating button is `router.refresh()` to re-render
 *     the server component (which re-reads benchmark/runs/).
 *   - Server component reads `lib/provider-closure-room/loader`
 *     directly; no new dev API.
 *   - Read-only and safe to open in production preview.
 *   - Does not import `lib/live-operator-checklist/**`; instead
 *     probes the file path so this page builds even when that
 *     sidecar branch has not been cherry-picked yet.
 *
 * No live OpenAI / Computer Use / browser session / payment / OTP
 * / CAPTCHA / final-confirm path. No live run is authorized by
 * this page.
 */

import { loadProviderClosureRoomSnapshot } from "@/lib/provider-closure-room";
import type {
  NextAllowedAction,
  ProviderClosureRoomSnapshot,
  ProviderClosureTerminalOutcome,
  ProviderLaneSnapshot,
} from "@/lib/provider-closure-room";
import { PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL } from "@/lib/provider-closure/schema";

import { RefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";

export default async function ProviderClosureRoomPage() {
  const snap = await loadProviderClosureRoomSnapshot();

  return (
    <main className="pcr">
      <Styles />
      <Header generatedAt={snap.generatedAt} />
      <NoLiveDisclaimer />
      <ChecklistLink snap={snap} />
      <LaneList snap={snap} />
      <SourceFooter snap={snap} />
    </main>
  );
}

/* ------ Header ---------------------------------------------------------------------------------------------------------- */

function Header({ generatedAt }: { generatedAt: string }) {
  return (
    <header className="pcr__top">
      <div className="pcr__breadcrumb">
        <a href="/dev">/dev</a>
        <span> / </span>
        <span>provider-closure</span>
      </div>
      <div className="pcr__title-row">
        <div>
          <h1 className="pcr__title">Provider Closure Operator Room</h1>
          <p className="pcr__subtitle">
            Read-only cockpit for restaurant, flight, and hotel closure
            work. Each lane shows the current closure posture, the last
            known blocker, the evidence the operator must collect before
            any next live attempt, the canonical runbook and references,
            safe hard stops, what to inspect after run, and the exact
            no-live CLI commands to use. <strong>No live run is
            authorized by this page.</strong>
          </p>
          <p className="pcr__generated">
            Snapshot generated at {generatedAt}.
          </p>
        </div>
        <RefreshButton />
      </div>
    </header>
  );
}

/* ------ No-live disclaimer --------------------------------------------------------------------------------------- */

function NoLiveDisclaimer() {
  return (
    <section className="pcr__disclaimer" aria-label="No live run authorized">
      <h2 className="pcr__disclaimer-title">Hard rules for this cockpit</h2>
      <ul className="pcr__disclaimer-list">
        <li>
          This page is read-only. It never starts a worker, calls OpenAI,
          opens a provider, reads the database, or submits a payment.
        </li>
        <li>
          A live provider attempt requires explicit founder approval for
          one exact command, separately from anything on this page.
        </li>
        <li>
          Stop before payment, CVV, OTP, CAPTCHA, login bypass, or final
          booking/reserve/purchase confirmation. Capture evidence, do
          not retry.
        </li>
        <li>
          Source of truth for any closure verdict is the DB row, the
          worker log, and the screenshot/live-snapshot artifacts. The
          task UI alone is not enough.
        </li>
      </ul>
    </section>
  );
}

/* ------ Checklist link ---------------------------------------------------------------------------------------- */

function ChecklistLink({ snap }: { snap: ProviderClosureRoomSnapshot }) {
  const tone = snap.checklist.available ? "good" : "neutral";
  return (
    <section className={`pcr__checklist pcr__checklist--${tone}`}>
      <h2 className="pcr__checklist-title">Operator checklist surface</h2>
      <p className="pcr__checklist-note">{snap.checklist.note}</p>
      {snap.checklist.available ? (
        <p>
          <a className="pcr__checklist-link" href={snap.checklist.href}>
            Open {snap.checklist.href}
          </a>
        </p>
      ) : (
        <p className="pcr__checklist-href">
          Placeholder: <code>{snap.checklist.href}</code>
        </p>
      )}
    </section>
  );
}

/* ------ Lane list ---------------------------------------------------------------------------------------------------- */

function LaneList({ snap }: { snap: ProviderClosureRoomSnapshot }) {
  return (
    <section className="pcr__lanes">
      {snap.lanes.map((lane) => (
        <LaneCard key={lane.lane.id} laneSnap={lane} />
      ))}
    </section>
  );
}

function LaneCard({ laneSnap }: { laneSnap: ProviderLaneSnapshot }) {
  const { lane, tone, artifacts } = laneSnap;
  return (
    <article className={`pcr__lane pcr__lane--${tone}`} id={`lane-${lane.id}`}>
      <header className="pcr__lane-head">
        <div>
          <h2 className="pcr__lane-title">{lane.displayName}</h2>
          <p className="pcr__lane-key">
            <code>provider:{lane.providerKey}</code> ·{" "}
            <code>lane:{lane.id}</code>
          </p>
        </div>
        <ArtifactBadge total={artifacts.totalBenchmarkArtifacts} matched={artifacts.laneBenchmarkArtifacts} />
      </header>

      <NotLiveVerifiedBanner liveVerified={lane.liveVerified} />

      <Block label="Current closure posture">
        <p className="pcr__prose">{lane.closurePosture}</p>
      </Block>

      <Block label="Last known blocker">
        <p className="pcr__prose">{lane.lastKnownBlocker}</p>
      </Block>

      <NextActionBlock action={lane.nextSingleAllowedAction} />

      <ClosureAcceptanceBlock
        safeTerminalStates={lane.safeTerminalStates}
        failureTerminalStates={lane.failureTerminalStates}
        inconclusiveTerminalStates={lane.inconclusiveTerminalStates}
      />

      <Block label="Latest local artifact for this lane">
        <ArtifactPanel summary={artifacts} />
      </Block>

      <Block label="Primary runbook">
        <p className="pcr__prose">
          <ReferenceLink reference={lane.primaryRunbook} />
        </p>
      </Block>

      <Block label="Supporting references">
        <ul className="pcr__list">
          {lane.supportingReferences.map((ref) => (
            <li key={ref.ref}>
              <ReferenceLink reference={ref} /> <span className="pcr__kind">[{ref.kind}]</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block label="Evidence required before next live attempt">
        <ol className="pcr__list">
          {lane.evidenceRequired.map((e) => (
            <li key={e.label}>
              <strong>{e.label}.</strong> {e.detail}
            </li>
          ))}
        </ol>
      </Block>

      <Block label="Safe hard stops">
        <ul className="pcr__list pcr__list--stops">
          {lane.hardStops.map((s) => (
            <li key={s.label}>
              <strong>{s.label}.</strong> {s.detail}
            </li>
          ))}
        </ul>
      </Block>

      <Block label="What to inspect after run">
        <ol className="pcr__list">
          {lane.inspectAfterRun.map((i) => (
            <li key={i.label}>
              <strong>{i.label}.</strong> {i.detail}
            </li>
          ))}
        </ol>
      </Block>

      <Block label="No-live CLI commands">
        <div className="pcr__cli-stack">
          {lane.cliCommands.map((c) => (
            <CliBlock key={c.label} label={c.label} description={c.description} command={c.command} />
          ))}
        </div>
      </Block>

      <Block label="Operator failure taxonomy classes used by this lane">
        <ul className="pcr__list pcr__list--inline">
          {lane.taxonomyClasses.map((tax) => (
            <li key={tax}>
              <code>{tax}</code>
            </li>
          ))}
        </ul>
        <p className="pcr__prose pcr__prose--small">
          See{" "}
          <a href="/dev/runtime-forensics">/dev/runtime-forensics</a> and{" "}
          <code>docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md</code> for the
          full taxonomy + signals + do-NOT lists.
        </p>
      </Block>

      <footer className="pcr__lane-footer">
        <strong>Source-of-truth reminder.</strong>{" "}
        {lane.sourceOfTruthReminder}
      </footer>
    </article>
  );
}

/* ------ NOT LIVE VERIFIED banner --------------------------------------------------------------------------------- */

function NotLiveVerifiedBanner({ liveVerified }: { liveVerified: boolean }) {
  if (liveVerified) {
    return (
      <div
        className="pcr__notlive pcr__notlive--verified"
        role="status"
        aria-label="Lane has accepted live closure evidence"
      >
        <span className="pcr__notlive-pill pcr__notlive-pill--verified">
          LIVE VERIFIED
        </span>
        <span className="pcr__notlive-text">
          This lane has accepted live closure evidence recorded in the
          acceptance doc. Do not click final confirmation; use this lane
          to review evidence and plan the next broader phase.
        </span>
      </div>
    );
  }

  return (
    <div
      className="pcr__notlive"
      role="status"
      aria-label="Lane is not live verified"
    >
      <span className="pcr__notlive-pill">NOT LIVE VERIFIED</span>
      <span className="pcr__notlive-text">
        Tooling passing is not provider closure passing. Closure
        acceptance for this lane requires the criteria below plus
        an explicit operator sign-off recorded in the acceptance
        doc.
      </span>
    </div>
  );
}

/* ------ Next single allowed action block ------------------------------------------------------------------------ */

function NextActionBlock({ action }: { action: NextAllowedAction }) {
  return (
    <section className="pcr__block pcr__nextaction" aria-label="Next single allowed action">
      <h3 className="pcr__block-title">Next single allowed action</h3>
      <div className="pcr__block-body">
        <p className="pcr__nextaction-label">{action.label}</p>
        <p className="pcr__prose">{action.detail}</p>
        {action.ref ? (
          <p className="pcr__prose pcr__prose--small">
            Reference:{" "}
            <ReferenceLink
              reference={{ label: action.ref, ref: action.ref }}
            />
          </p>
        ) : null}
        <p className="pcr__prose pcr__prose--muted">
          This is the only action authorized from this lane right
          now. No live retry is authorized from this page; any
          live attempt requires a separate founder-approved exact
          command.
        </p>
      </div>
    </section>
  );
}

/* ------ Closure acceptance block --------------------------------------------------------------------------------- */

function ClosureAcceptanceBlock({
  safeTerminalStates,
  failureTerminalStates,
  inconclusiveTerminalStates,
}: {
  safeTerminalStates: ProviderClosureTerminalOutcome[];
  failureTerminalStates: ProviderClosureTerminalOutcome[];
  inconclusiveTerminalStates: ProviderClosureTerminalOutcome[];
}) {
  return (
    <section className="pcr__block pcr__acceptance" aria-label="Closure acceptance criteria">
      <h3 className="pcr__block-title">Closure acceptance criteria</h3>
      <div className="pcr__block-body">
        <p className="pcr__prose pcr__prose--small">
          Outcomes are partitioned across the 8-state taxonomy in{" "}
          <code>lib/provider-closure/schema.ts</code>. Read the full
          pass / fail / inconclusive criteria in{" "}
          <code>docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md</code>.
        </p>
        <div className="pcr__acceptance-grid">
          <AcceptanceColumn
            title="Closure passes"
            tone="good"
            states={safeTerminalStates}
          />
          <AcceptanceColumn
            title="Closure fails"
            tone="bad"
            states={failureTerminalStates}
          />
          <AcceptanceColumn
            title="Inconclusive (do not retry)"
            tone="warn"
            states={inconclusiveTerminalStates}
          />
        </div>
      </div>
    </section>
  );
}

function AcceptanceColumn({
  title,
  tone,
  states,
}: {
  title: string;
  tone: "good" | "warn" | "bad";
  states: ProviderClosureTerminalOutcome[];
}) {
  return (
    <div className={`pcr__acceptance-col pcr__acceptance-col--${tone}`}>
      <p className="pcr__acceptance-title">{title}</p>
      <ul className="pcr__acceptance-list">
        {states.map((s) => (
          <li key={s}>
            <code>{s}</code>
            <span className="pcr__acceptance-label">
              {" "}
              {PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL[s]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------ Sub-blocks ----------------------------------------------------------------------------------------------------- */

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pcr__block">
      <h3 className="pcr__block-title">{label}</h3>
      <div className="pcr__block-body">{children}</div>
    </section>
  );
}

function ReferenceLink({
  reference,
}: {
  reference: { label: string; ref: string };
}) {
  const ref = reference.ref;
  if (ref.startsWith("https://")) {
    return (
      <a href={ref} target="_blank" rel="noopener noreferrer">
        {reference.label}
      </a>
    );
  }
  if (ref.startsWith("/dev/") || ref.startsWith("/api/")) {
    return <a href={ref}>{reference.label}</a>;
  }
  // Repo-relative path. Render as code so the operator copies it.
  return (
    <span>
      {reference.label}: <code>{ref}</code>
    </span>
  );
}

function CliBlock({
  label,
  description,
  command,
}: {
  label: string;
  description: string;
  command: string;
}) {
  return (
    <div className="pcr__cli">
      <p className="pcr__cli-label">{label}</p>
      <p className="pcr__cli-desc">{description}</p>
      <pre className="pcr__cli-cmd">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function ArtifactBadge({ total, matched }: { total: number; matched: number }) {
  return (
    <div
      className="pcr__artifact-badge"
      title="Best-effort filename count under benchmark/runs/. Authoritative classification is the per-vertical analyzer."
    >
      <span className="pcr__artifact-num">{matched}</span>
      <span className="pcr__artifact-sub">
        / {total} artifact{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function ArtifactPanel({
  summary,
}: {
  summary: {
    totalBenchmarkArtifacts: number;
    laneBenchmarkArtifacts: number;
    latestArtifactFile: string | null;
    emptyHint: string;
  };
}) {
  if (summary.laneBenchmarkArtifacts === 0) {
    return <p className="pcr__prose pcr__prose--muted">{summary.emptyHint}</p>;
  }
  return (
    <div>
      <p className="pcr__prose">
        {summary.laneBenchmarkArtifacts} of{" "}
        {summary.totalBenchmarkArtifacts} local artifacts under{" "}
        <code>benchmark/runs/</code> match this lane&apos;s filename markers.
      </p>
      {summary.latestArtifactFile ? (
        <p className="pcr__prose pcr__prose--small">
          Latest match: <code>benchmark/runs/{summary.latestArtifactFile}</code>
        </p>
      ) : null}
      <p className="pcr__prose pcr__prose--muted">
        Filename markers are best-effort. The per-vertical analyzer
        (<code>npx tsx scripts/analyze-provider-artifact.ts</code>) is
        the authoritative classifier.
      </p>
    </div>
  );
}

/* ------ Source footer ----------------------------------------------------------------------------------------------- */

function SourceFooter({ snap }: { snap: ProviderClosureRoomSnapshot }) {
  return (
    <footer className="pcr__footer">
      <p>
        Cockpit source: <code>app/dev/provider-closure/page.tsx</code> +{" "}
        <code>lib/provider-closure-room/</code>. Operator usage doc:{" "}
        <code>docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md</code>.
        Evidence protocol:{" "}
        <code>docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md</code>.
        Failure taxonomy:{" "}
        <code>docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md</code>.
      </p>
      {snap.notes.length > 0 && (
        <details className="pcr__notes">
          <summary>Loader notes ({snap.notes.length})</summary>
          <ul>
            {snap.notes.map((n, i) => (
              <li key={i}>
                <code>{n}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="pcr__footer-rule">
        Schema version {snap.schemaVersion}. Snapshot is read-only.
      </p>
    </footer>
  );
}

/* ------ Styles ------------------------------------------------------------------------------------------------------------ */

function Styles() {
  return (
    <style>{`
      .pcr {
        --ink-1: #f9fafb;
        --ink-2: #f3f4f6;
        --ink-3: #e5e7eb;
        --ink-5: #9ca3af;
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
        --tone-neutral: #0ea5e9;
        --tone-neutral-bg: rgba(14, 165, 233, 0.08);
        --tone-neutral-border: rgba(14, 165, 233, 0.28);
        --tone-bad: #b91c1c;
        --tone-bad-bg: rgba(185, 28, 28, 0.10);
        --tone-bad-border: rgba(185, 28, 28, 0.30);

        max-width: 1080px;
        margin: 0 auto;
        padding: 28px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        min-height: 100vh;
        color: var(--ink-9);
      }
      .pcr__breadcrumb {
        font-size: 12px;
        color: var(--ink-6);
        margin-bottom: 6px;
      }
      .pcr__breadcrumb a {
        color: var(--ink-7);
        text-decoration: none;
      }
      .pcr__breadcrumb a:hover { text-decoration: underline; }
      .pcr__title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
      }
      .pcr__title {
        margin: 0 0 8px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .pcr__subtitle {
        margin: 0 0 6px;
        font-size: 13px;
        color: var(--ink-7);
        line-height: 1.55;
      }
      .pcr__subtitle strong {
        color: var(--tone-warn);
      }
      .pcr__generated {
        margin: 0;
        font-size: 11px;
        color: var(--ink-6);
      }
      .pcr__refresh-btn {
        appearance: none;
        border: 1px solid var(--ink-3);
        background: var(--card);
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .pcr__refresh-btn:hover { border-color: var(--tone-neutral); }
      .pcr__refresh-btn:disabled { cursor: progress; opacity: 0.7; }
      .pcr__refresh-stamp {
        font-weight: 400;
        color: var(--ink-6);
      }

      .pcr__disclaimer {
        margin-top: 22px;
        padding: 14px 18px;
        border: 1px solid var(--tone-warn-border);
        background: var(--tone-warn-bg);
        border-radius: 10px;
      }
      .pcr__disclaimer-title {
        margin: 0 0 6px;
        font-size: 12.5px;
        font-weight: 700;
        color: var(--tone-warn);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .pcr__disclaimer-list {
        margin: 0;
        padding-left: 18px;
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--ink-8);
      }
      .pcr__disclaimer-list li { margin-top: 3px; }

      .pcr__checklist {
        margin-top: 18px;
        padding: 14px 18px;
        border: 1px solid var(--ink-3);
        background: var(--card);
        border-radius: 10px;
      }
      .pcr__checklist--good { border-color: var(--tone-good-border); background: var(--tone-good-bg); }
      .pcr__checklist--neutral { border-color: var(--tone-neutral-border); background: var(--tone-neutral-bg); }
      .pcr__checklist-title {
        margin: 0 0 6px;
        font-size: 12.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-7);
      }
      .pcr__checklist-note {
        margin: 0 0 6px;
        font-size: 12.5px;
        color: var(--ink-7);
        line-height: 1.55;
      }
      .pcr__checklist-link {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--tone-neutral);
      }
      .pcr__checklist-href code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 6px;
        border-radius: 4px;
      }

      .pcr__lanes {
        margin-top: 22px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .pcr__lane {
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 12px;
        padding: 18px 22px;
        box-shadow: 0 1px 0 rgba(0,0,0,0.02);
      }
      .pcr__lane--warn { border-left: 4px solid var(--tone-warn); }
      .pcr__lane--neutral { border-left: 4px solid var(--tone-neutral); }
      .pcr__lane--good { border-left: 4px solid var(--tone-good); }
      .pcr__lane--bad { border-left: 4px solid var(--tone-bad); }

      .pcr__lane-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--ink-2);
      }
      .pcr__lane-title {
        margin: 0 0 4px;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .pcr__lane-key {
        margin: 0;
        font-size: 11.5px;
        color: var(--ink-6);
      }
      .pcr__lane-key code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .pcr__artifact-badge {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        line-height: 1.1;
      }
      .pcr__artifact-num {
        font-size: 22px;
        font-weight: 700;
        color: var(--ink-9);
      }
      .pcr__artifact-sub {
        font-size: 10.5px;
        color: var(--ink-6);
      }

      .pcr__block {
        margin-top: 14px;
      }
      .pcr__block-title {
        margin: 0 0 6px;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-7);
      }
      .pcr__block-body { font-size: 13px; }
      .pcr__prose {
        margin: 0 0 6px;
        line-height: 1.55;
        color: var(--ink-8);
      }
      .pcr__prose--small { font-size: 11.5px; color: var(--ink-7); }
      .pcr__prose--muted { font-size: 12px; color: var(--ink-6); }

      .pcr__list {
        margin: 0;
        padding-left: 20px;
        line-height: 1.55;
        color: var(--ink-8);
      }
      .pcr__list li { margin-top: 4px; }
      .pcr__list--inline {
        padding-left: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .pcr__list--inline li {
        margin-top: 0;
        background: var(--ink-2);
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11.5px;
      }
      .pcr__list--stops li {
        color: var(--ink-9);
      }
      .pcr__kind {
        font-size: 10px;
        text-transform: uppercase;
        color: var(--ink-6);
        letter-spacing: 0.05em;
      }

      .pcr__cli-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .pcr__cli {
        background: var(--ink-1);
        border: 1px solid var(--ink-3);
        border-radius: 8px;
        padding: 10px 12px;
      }
      .pcr__cli-label {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        color: var(--ink-9);
      }
      .pcr__cli-desc {
        margin: 4px 0 8px;
        font-size: 12px;
        color: var(--ink-7);
        line-height: 1.5;
      }
      .pcr__cli-cmd {
        margin: 0;
        padding: 8px 10px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11.5px;
        overflow-x: auto;
        white-space: pre;
      }
      .pcr__cli-cmd code { background: transparent; color: inherit; padding: 0; }

      .pcr__notlive {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 12px 0 0;
        padding: 10px 14px;
        background: var(--tone-bad-bg);
        border: 1px solid var(--tone-bad-border);
        border-radius: 8px;
      }
      .pcr__notlive-pill {
        align-self: flex-start;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--tone-bad);
        background: rgba(185, 28, 28, 0.16);
        padding: 3px 8px;
        border-radius: 4px;
      }
      .pcr__notlive-text {
        font-size: 12px;
        color: var(--ink-8);
        line-height: 1.5;
      }
      .pcr__notlive--verified {
        background: var(--tone-good-bg);
        border-color: var(--tone-good-border);
      }
      .pcr__notlive-pill--verified {
        color: var(--tone-good);
        background: rgba(22, 163, 74, 0.16);
      }

      .pcr__nextaction {
        background: var(--tone-warn-bg);
        border: 1px solid var(--tone-warn-border);
        border-radius: 8px;
        padding: 10px 14px;
      }
      .pcr__nextaction-label {
        margin: 0 0 4px;
        font-size: 13px;
        font-weight: 700;
        color: var(--ink-9);
      }

      .pcr__acceptance {
        background: var(--ink-1);
        border: 1px solid var(--ink-3);
        border-radius: 8px;
        padding: 10px 14px;
      }
      .pcr__acceptance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
        margin-top: 6px;
      }
      .pcr__acceptance-col {
        padding: 8px 10px;
        border-radius: 6px;
        background: var(--card);
        border: 1px solid var(--ink-3);
      }
      .pcr__acceptance-col--good { border-color: var(--tone-good-border); }
      .pcr__acceptance-col--warn { border-color: var(--tone-warn-border); }
      .pcr__acceptance-col--bad { border-color: var(--tone-bad-border); }
      .pcr__acceptance-title {
        margin: 0 0 4px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-7);
      }
      .pcr__acceptance-col--good .pcr__acceptance-title { color: var(--tone-good); }
      .pcr__acceptance-col--warn .pcr__acceptance-title { color: var(--tone-warn); }
      .pcr__acceptance-col--bad .pcr__acceptance-title { color: var(--tone-bad); }
      .pcr__acceptance-list {
        margin: 0;
        padding-left: 16px;
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--ink-8);
      }
      .pcr__acceptance-list code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: var(--ink-2);
        padding: 1px 4px;
        border-radius: 3px;
      }
      .pcr__acceptance-label {
        color: var(--ink-6);
        font-size: 11px;
      }

      .pcr__lane-footer {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px solid var(--ink-2);
        font-size: 11.5px;
        color: var(--ink-7);
        line-height: 1.55;
      }

      .pcr__footer {
        margin-top: 36px;
        padding-top: 16px;
        border-top: 1px solid var(--ink-3);
      }
      .pcr__footer p {
        margin: 0 0 6px;
        font-size: 11.5px;
        color: var(--ink-6);
      }
      .pcr__footer code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .pcr__notes {
        margin-top: 8px;
        font-size: 11.5px;
        color: var(--ink-6);
      }
      .pcr__notes ul { margin: 6px 0 0; padding-left: 18px; }
      .pcr__footer-rule {
        margin-top: 6px;
        font-size: 11px;
        color: var(--ink-6);
      }
    `}</style>
  );
}
