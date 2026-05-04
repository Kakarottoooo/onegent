/**
 * /dev/demo-control-room -?founder-facing demo prep dashboard.
 *
 * READ-ONLY. Aggregates existing artifact verdicts (Phase 1 quality
 * gate, founder-e2e, smoke check from gate, Phase 2 vertical status)
 * into a single screen the founder opens before a demo.
 *
 * Hard rules (verified by tests / hold rules):
 *   - No live runs, no retry, no payment, no OTP, no CAPTCHA bypass.
 *   - No "run gate" / "run e2e" buttons -?only `router.refresh()` to
 *     re-render the server component (which re-reads filesystem).
 *   - Server component reads `lib/demo-control-room/loader` directly;
 *     no new dev API.
 *   - Dev-gated via the same pattern as `/dev/founder-e2e`.
 *
 * Layout:
 *   1. Header + V1 caveat + manual Refresh button
 *   2. "Verdict at a glance" trio (gate / founder-e2e / smoke)
 *   3. Runtime forensics quick-link
 *   4. Phase 2 vertical panel
 *   5. Safe demo script (pre-demo, happy path, hard stops, recovery)
 *   6. Source links + loader notes
 *
 * Pure RSC. Client interactivity lives in `./refresh-button.tsx`.
 */

import { notFound } from "next/navigation";

import {
  formatDemoScriptMarkdown,
  formatDurationMs,
  founderVerdictTone,
  loadDemoControlRoomSnapshot,
  SAFE_DEMO_SCRIPT,
  verdictTone,
  type DemoControlRoomSnapshot,
  type Phase2EvidenceLink,
  type Phase2Vertical,
} from "@/lib/demo-control-room";

import { RefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";

function isDevPageEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
}

export default async function DemoControlRoomPage() {
  if (!isDevPageEnabled()) {
    notFound();
  }
  const snap = await loadDemoControlRoomSnapshot();
  const markdown = formatDemoScriptMarkdown();

  return (
    <main className="dcr">
      <Styles />
      <Header generatedAt={snap.generatedAt} />
      <VerdictRow snap={snap} />
      <RuntimeForensicsBlock snap={snap} />
      <Phase2Panel snap={snap} />
      <SafeDemoScriptBlock markdown={markdown} />
      <SourceLinks snap={snap} />
    </main>
  );
}

/* ------ Header ---------------------------------------------------------------------------------------------------------------- */

function Header({ generatedAt }: { generatedAt: string }) {
  return (
    <header className="dcr__top">
      <div className="dcr__breadcrumb">
        <a href="/dev">/dev</a>
        <span> / </span>
        <span>demo-control-room</span>
      </div>
      <div className="dcr__title-row">
        <div>
          <h1 className="dcr__title">Demo Control Room</h1>
          <p className="dcr__subtitle">
            Read-only founder-facing surface. Aggregates the latest Phase 1
            gate, founder-e2e, smoke, runtime-forensics, and Phase 2
            posture into one screen so you can verify shape before a demo.
            <strong> No live runs from here.</strong>
          </p>
        </div>
        <RefreshButton />
      </div>
      <div className="dcr__caveat">
        <strong>[V1]</strong> Reads `benchmark/runs/*.json` artifacts
        only. The dashboard does NOT invoke the gate, founder-e2e, or any
        provider. Re-run via `npm run gate:phase1 -- --allow-known-drift`
        / `npm run e2e:founder` from a shell, then click Refresh.
        <span className="dcr__generated">
          Generated: {new Date(generatedAt).toLocaleString()}
        </span>
      </div>
    </header>
  );
}

/* ------ Verdict trio ---------------------------------------------------------------------------------------------------- */

function VerdictRow({ snap }: { snap: DemoControlRoomSnapshot }) {
  return (
    <section className="dcr__verdicts">
      <h2 className="dcr__section-title">Verdict at a glance</h2>
      <div className="dcr__verdict-grid">
        <GateCard snap={snap} />
        <FounderE2eCard snap={snap} />
        <SmokeCard snap={snap} />
      </div>
    </section>
  );
}

function GateCard({ snap }: { snap: DemoControlRoomSnapshot }) {
  const s = snap.qualityGate;
  if (!s.available || !s.summary) {
    return (
      <VerdictCard
        title="Phase 1 quality gate"
        href="/dev/phase1-quality-gates"
        tone="neutral"
      >
        <p className="dcr__empty-line">No gate run found.</p>
        <p className="dcr__hint">{s.emptyHint}</p>
      </VerdictCard>
    );
  }
  const tone = verdictTone(s.summary.verdict);
  return (
    <VerdictCard
      title="Phase 1 quality gate"
      href="/dev/phase1-quality-gates"
      tone={tone}
    >
      <p className="dcr__verdict-headline">
        <span className={`dcr__verdict-pill dcr__verdict-pill--${tone}`}>
          [{s.summary.verdict.toUpperCase()}]
        </span>{" "}
        {s.summary.passCount}/{s.summary.totalChecks} pass
        {s.summary.knownExistingFailureCount > 0 && (
          <>
            , {s.summary.knownExistingFailureCount} known-existing
          </>
        )}
        {s.summary.failCount > 0 && (
          <>, <span className="dcr__bad">{s.summary.failCount} fail</span></>
        )}
      </p>
      <p className="dcr__hint">
        Generated{" "}
        {new Date(s.summary.generatedAt).toLocaleString()} -{" "}
        {formatDurationMs(s.summary.durationMs)} -{" "}
        <code>{s.relPath}</code>
      </p>
    </VerdictCard>
  );
}

function FounderE2eCard({ snap }: { snap: DemoControlRoomSnapshot }) {
  const s = snap.founderE2e;
  if (!s.available || !s.summary) {
    return (
      <VerdictCard
        title="Founder E2E"
        href="/dev/founder-e2e"
        tone="neutral"
      >
        <p className="dcr__empty-line">No founder-e2e run found.</p>
        <p className="dcr__hint">{s.emptyHint}</p>
      </VerdictCard>
    );
  }
  const tone = founderVerdictTone(s.summary.runnerVerdict);
  const verdictText = s.summary.runnerVerdict ?? "indeterminate";
  return (
    <VerdictCard title="Founder E2E" href="/dev/founder-e2e" tone={tone}>
      <p className="dcr__verdict-headline">
        <span className={`dcr__verdict-pill dcr__verdict-pill--${tone}`}>
          [{verdictText.toUpperCase()}]
        </span>{" "}
        {s.summary.pass}/{s.summary.total} pass
        {s.summary.fail > 0 && (
          <>, <span className="dcr__bad">{s.summary.fail} fail</span></>
        )}
        {s.summary.blocker > 0 && (
          <>
            , <span className="dcr__bad">{s.summary.blocker} blocker</span>
          </>
        )}
      </p>
      <p className="dcr__hint">
        Path: <code>{s.summary.pathId}</code> - Source:{" "}
        <code>{s.summary.source}</code> - Started{" "}
        {new Date(s.summary.startedAt).toLocaleString()} -{" "}
        <code>{s.relPath}</code>
      </p>
    </VerdictCard>
  );
}

function SmokeCard({ snap }: { snap: DemoControlRoomSnapshot }) {
  const smoke = snap.qualityGate.smoke;
  if (!smoke.present) {
    return (
      <VerdictCard
        title="Smoke (`smoke:phase1`)"
        href="/dev/phase1-quality-gates"
        tone="neutral"
      >
        <p className="dcr__empty-line">Not in latest gate run.</p>
        <p className="dcr__hint">{smoke.hint}</p>
      </VerdictCard>
    );
  }
  const tone = smokeStatusTone(smoke.status);
  return (
    <VerdictCard
      title="Smoke (`smoke:phase1`)"
      href="/dev/phase1-quality-gates"
      tone={tone}
    >
      <p className="dcr__verdict-headline">
        <span className={`dcr__verdict-pill dcr__verdict-pill--${tone}`}>
          [{(smoke.status ?? "pending").toUpperCase()}]
        </span>{" "}
        in latest gate
      </p>
      <p className="dcr__hint">
        Severity: <code>{smoke.severity ?? "-"}</code> - Duration:{" "}
        {formatDurationMs(smoke.durationMs)} - {smoke.hint}
      </p>
    </VerdictCard>
  );
}

function smokeStatusTone(
  status: string | null,
): "good" | "warn" | "bad" | "neutral" {
  if (status === "pass") return "good";
  if (status === "fail") return "bad";
  if (status === "known_existing_failure") return "warn";
  return "neutral";
}

function VerdictCard({
  title,
  href,
  tone,
  children,
}: {
  title: string;
  href: string;
  tone: "good" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <article className={`dcr__card dcr__card--${tone}`}>
      <header className="dcr__card-head">
        <h3 className="dcr__card-title">{title}</h3>
        <a className="dcr__card-link" href={href}>
          Open
        </a>
      </header>
      <div className="dcr__card-body">{children}</div>
    </article>
  );
}

/* ------ Runtime forensics block ------------------------------------------------------------------------------ */

function RuntimeForensicsBlock({ snap }: { snap: DemoControlRoomSnapshot }) {
  return (
    <section className="dcr__forensics">
      <h2 className="dcr__section-title">Runtime forensics</h2>
      <p className="dcr__forensics-body">
        {snap.runtimeForensics.description}
      </p>
      <a className="dcr__forensics-link" href={snap.runtimeForensics.href}>
        Open {snap.runtimeForensics.href}
      </a>
    </section>
  );
}

/* ------ Phase 2 panel -------------------------------------------------------------------------------------------------- */

function Phase2Panel({ snap }: { snap: DemoControlRoomSnapshot }) {
  return (
    <section className="dcr__phase2">
      <h2 className="dcr__section-title">
        Phase 2 vertical posture: <em>{snap.phase2.postureLabel}</em>
      </h2>
      <p className="dcr__phase2-caveat">
        Phase 2 is FROZEN unless Phase 0/1 are stable. The statuses below
        are the no-live audit verdict -?do not interpret them as
        live-verified. Update protocol: change{" "}
        <code>docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md</code>{" "}
        first, then mirror in{" "}
        <code>lib/demo-control-room/phase2-status.ts</code>.
      </p>
      <div className="dcr__phase2-grid">
        {snap.phase2.verticals.map((v) => (
          <Phase2VerticalCard key={v.id} vertical={v} />
        ))}
      </div>
    </section>
  );
}

function Phase2VerticalCard({ vertical }: { vertical: Phase2Vertical }) {
  return (
    <article className={`dcr__card dcr__card--${vertical.tone}`}>
      <header className="dcr__card-head">
        <h3 className="dcr__card-title">{vertical.displayName}</h3>
        <span
          className={`dcr__verdict-pill dcr__verdict-pill--${vertical.tone}`}
        >
          [{vertical.statusLabel}]
        </span>
      </header>
      <div className="dcr__card-body">
        <p className="dcr__phase2-rationale">{vertical.rationale}</p>
        <p className="dcr__hint">
          Live phrase: <strong>{vertical.liveVerifiedNote}</strong>
        </p>
        <details className="dcr__evidence">
          <summary>Evidence ({vertical.evidence.length})</summary>
          <ul>
            {vertical.evidence.map((e) => (
              <EvidenceItem key={e.label + e.ref} link={e} />
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}

function EvidenceItem({ link }: { link: Phase2EvidenceLink }) {
  return (
    <li>
      <span className={`dcr__ev-kind dcr__ev-kind--${link.kind}`}>
        [{link.kind}]
      </span>{" "}
      <strong>{link.label}</strong> -?<code>{link.ref}</code>
    </li>
  );
}

/* ------ Safe demo script -------------------------------------------------------------------------------------------- */

function SafeDemoScriptBlock({ markdown }: { markdown: string }) {
  return (
    <section className="dcr__script">
      <h2 className="dcr__section-title">Safe demo script</h2>
      <p className="dcr__script-intro">
        Pre-demo checklist + happy path + hard stops + recovery phrases.
        Runbook:{" "}
        <code>docs/40-phase1/DEMO_CONTROL_ROOM.md</code>. Triple-click
        the textarea below to copy as markdown.
      </p>

      <div className="dcr__script-grid">
        <ChecklistColumn />
        <HappyPathColumn />
      </div>
      <HardStopsTable />
      <RecoveryPhrasesList />

      <details className="dcr__script-md">
        <summary>Full markdown export (paste-ready)</summary>
        <textarea
          readOnly
          className="dcr__markdown"
          value={markdown}
          rows={Math.min(40, markdown.split("\n").length + 2)}
        />
      </details>
    </section>
  );
}

function ChecklistColumn() {
  return (
    <div>
      <h3 className="dcr__col-title">Pre-demo (5 min)</h3>
      <ol className="dcr__num-list">
        {SAFE_DEMO_SCRIPT.preDemoChecklist.map((item) => (
          <li key={item.id}>
            <strong>{item.label}</strong>
            <p className="dcr__hint">{item.hint}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HappyPathColumn() {
  return (
    <div>
      <h3 className="dcr__col-title">Happy path</h3>
      <ol className="dcr__num-list">
        {SAFE_DEMO_SCRIPT.happyPath.map((step) => (
          <li key={step.index}>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
            {step.safety && (
              <p className="dcr__safety">[SAFETY] {step.safety}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function HardStopsTable() {
  return (
    <div className="dcr__hard-stops">
      <h3 className="dcr__col-title">Hard stops</h3>
      <table className="dcr__table">
        <thead>
          <tr>
            <th>Trigger</th>
            <th>Rule</th>
            <th>Recovery line</th>
          </tr>
        </thead>
        <tbody>
          {SAFE_DEMO_SCRIPT.hardStops.map((hs) => (
            <tr key={hs.trigger}>
              <td>{hs.trigger}</td>
              <td>{hs.rule}</td>
              <td>
                <em>{hs.recoveryLine}</em>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecoveryPhrasesList() {
  return (
    <div className="dcr__recovery">
      <h3 className="dcr__col-title">Recovery phrases</h3>
      <ul>
        {SAFE_DEMO_SCRIPT.recoveryPhrases.map((r) => (
          <li key={r.scenario}>
            <strong>{r.scenario}:</strong> {r.line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------ Source links ---------------------------------------------------------------------------------------------------- */

function SourceLinks({ snap }: { snap: DemoControlRoomSnapshot }) {
  return (
    <section className="dcr__sources">
      <h2 className="dcr__section-title">Sources + notes</h2>
      <ul className="dcr__sources-list">
        <li>
          Phase 1 runbook:{" "}
          <code>docs/40-phase1/PHASE_1_FOUNDER_E2E.md</code>
        </li>
        <li>
          Demo runbook:{" "}
          <code>docs/40-phase1/DEMO_CONTROL_ROOM.md</code>
        </li>
        <li>
          Phase 2 audit:{" "}
          <code>docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md</code>
        </li>
        <li>
          Coordination:{" "}
          <code>docs/10-coordination/HUDDLE.md</code>,{" "}
          <code>docs/10-coordination/STRATEGIC_LEDGER.md</code>
        </li>
      </ul>
      {snap.notes.length > 0 && (
        <details className="dcr__notes">
          <summary>Loader notes ({snap.notes.length})</summary>
          <ul>
            {snap.notes.map((n) => (
              <li key={n}>
                <code>{n}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ------ Inline styles -------------------------------------------------------------------------------------------------- */

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.dcr {
  max-width: 1320px;
  margin: 0 auto;
  padding: 24px 32px 64px;
  font: 14px / 1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #111;
}
.dcr__breadcrumb { font-size: 13px; color: #666; margin-bottom: 12px; }
.dcr__breadcrumb a { color: #2563eb; text-decoration: none; }
.dcr__title-row {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
}
.dcr__title { font-size: 28px; margin: 0 0 8px; }
.dcr__subtitle { margin: 0 0 12px; color: #444; max-width: 820px; }
.dcr__caveat {
  background: #fff7ed; border: 1px solid #fed7aa; padding: 10px 14px;
  border-radius: 6px; font-size: 13px; color: #7c2d12; margin-top: 8px;
}
.dcr__generated { float: right; color: #92400e; font-style: italic; }

.dcr__refresh-btn {
  background: #1e293b; color: #fff; border: 0; padding: 8px 16px;
  font-size: 13px; border-radius: 6px; cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.dcr__refresh-btn:hover { background: #0f172a; }
.dcr__refresh-btn:disabled { opacity: 0.5; cursor: progress; }
.dcr__refresh-stamp { color: #94a3b8; font-size: 11px; }

.dcr__section-title {
  font-size: 17px; margin: 24px 0 12px; color: #0f172a;
  border-top: 1px solid #e2e8f0; padding-top: 16px;
}

.dcr__verdict-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;
}
.dcr__card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;
}
.dcr__card--good { border-left: 4px solid #059669; }
.dcr__card--warn { border-left: 4px solid #b45309; }
.dcr__card--bad { border-left: 4px solid #b91c1c; }
.dcr__card--neutral { border-left: 4px solid #94a3b8; }
.dcr__card-head {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px;
}
.dcr__card-title { font-size: 14px; margin: 0; color: #0f172a; }
.dcr__card-link {
  font-size: 12px; color: #2563eb; text-decoration: none;
}
.dcr__card-link:hover { text-decoration: underline; }
.dcr__card-body p { margin: 6px 0; }
.dcr__verdict-headline { font-size: 14px; }
.dcr__verdict-pill {
  display: inline-block; font-family: ui-monospace, monospace; font-size: 11px;
  padding: 2px 8px; border-radius: 3px; font-weight: 700;
}
.dcr__verdict-pill--good { background: #d1fae5; color: #065f46; }
.dcr__verdict-pill--warn { background: #fef3c7; color: #92400e; }
.dcr__verdict-pill--bad  { background: #fee2e2; color: #991b1b; }
.dcr__verdict-pill--neutral { background: #e2e8f0; color: #1e293b; }
.dcr__bad { color: #b91c1c; font-weight: 600; }
.dcr__hint { font-size: 12px; color: #64748b; margin-top: 4px; }
.dcr__empty-line { font-weight: 600; color: #475569; }

.dcr__forensics-body { color: #475569; max-width: 720px; }
.dcr__forensics-link {
  display: inline-block; margin-top: 8px; padding: 6px 12px;
  border: 1px solid #cbd5e1; border-radius: 6px; color: #1e293b;
  text-decoration: none; font-size: 13px;
}
.dcr__forensics-link:hover { background: #f1f5f9; }

.dcr__phase2-caveat {
  background: #fff7ed; border: 1px solid #fed7aa; padding: 10px 14px;
  border-radius: 6px; font-size: 13px; color: #7c2d12; margin: 8px 0 16px;
}
.dcr__phase2-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px;
}
.dcr__phase2-rationale { color: #334155; font-size: 13px; }
.dcr__evidence { margin-top: 8px; }
.dcr__evidence summary { font-size: 12px; cursor: pointer; color: #475569; }
.dcr__evidence ul { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
.dcr__ev-kind {
  display: inline-block; font-family: ui-monospace, monospace; font-size: 10px;
  padding: 1px 6px; border-radius: 3px;
}
.dcr__ev-kind--doc { background: #d1fae5; color: #064e3b; }
.dcr__ev-kind--test { background: #dbeafe; color: #1e3a8a; }
.dcr__ev-kind--module { background: #fef3c7; color: #78350f; }
.dcr__ev-kind--runbook { background: #fce7f3; color: #831843; }

.dcr__script-intro { color: #475569; max-width: 800px; }
.dcr__script-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 16px 0;
}
@media (max-width: 880px) {
  .dcr__script-grid { grid-template-columns: 1fr; }
}
.dcr__col-title {
  font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;
  color: #475569; margin: 12px 0 8px;
}
.dcr__num-list { padding-left: 22px; margin: 0; }
.dcr__num-list li { margin-bottom: 12px; }
.dcr__num-list li p { margin: 4px 0 0; font-size: 13px; }
.dcr__safety {
  background: #fff7ed; color: #7c2d12; padding: 6px 10px; border-radius: 4px;
  font-size: 12px; margin-top: 6px !important;
}

.dcr__hard-stops { margin: 16px 0; }
.dcr__table {
  width: 100%; border-collapse: collapse; font-size: 13px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 6px;
}
.dcr__table th, .dcr__table td {
  text-align: left; padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9; vertical-align: top;
}
.dcr__table th { background: #f8fafc; font-weight: 600; color: #475569; }

.dcr__recovery ul { padding-left: 22px; margin: 0; }
.dcr__recovery li { margin-bottom: 8px; font-size: 13px; }

.dcr__script-md { margin-top: 16px; }
.dcr__script-md summary { cursor: pointer; font-weight: 600; }
.dcr__markdown {
  width: 100%; font-family: ui-monospace, monospace; font-size: 12px;
  background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px;
  margin-top: 8px; border: 1px solid #1e293b;
}

.dcr__sources-list { margin: 0; padding-left: 18px; font-size: 13px; color: #475569; }
.dcr__sources-list li { margin-bottom: 4px; }
.dcr__notes { margin-top: 8px; font-size: 12px; }
.dcr__notes ul { padding-left: 18px; }
        `,
      }}
    />
  );
}
