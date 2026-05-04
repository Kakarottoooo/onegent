import {
  CROSS_PROVIDER_HARD_STOPS,
  FORBIDDEN_BUTTONS,
  NO_LIVE_AUTHORIZATION_NOTICE,
  POST_RUN_REPORT_FIELDS,
  PRE_RUN_REQUIREMENTS,
  listProviderChecklists,
  type ProviderChecklist,
} from "@/lib/live-operator-checklist";

export const dynamic = "force-dynamic";

export default function LiveOperatorChecklistPage() {
  const providers = listProviderChecklists();

  return (
    <main className="loc">
      <Styles />
      <Header />
      <NoLiveBanner />
      <PreRunSection />
      <CrossProviderHardStops />
      {providers.map((provider) => (
        <ProviderSection key={provider.key} provider={provider} />
      ))}
      <PostRunReportSection />
      <PageBoundarySection />
    </main>
  );
}

function Header() {
  return (
    <header className="loc__hero">
      <div className="loc__breadcrumb">
        <a href="/dev">/dev</a>
        <span> / live-operator-checklist</span>
      </div>
      <h1>Live Operator Checklist</h1>
      <p>
        Read-only operator surface for a controlled live retry that the founder
        has approved separately. It lists per-provider hard stops, the exact
        evidence to collect after the run, and the analyzer command that
        classifies the artifact bundle. Source of truth stays in the
        per-provider runbooks linked below; this page is the cockpit copy
        layer.
      </p>
      <div className="loc__notes">
        <span>Read-only. No buttons that start, retry, or skip anything.</span>
        <span>
          See{" "}
          <code>docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md</code> for
          the cold-start safety contract.
        </span>
      </div>
    </header>
  );
}

function NoLiveBanner() {
  return (
    <section className="loc__banner" aria-label="No live run authorization">
      <h2>Authorization</h2>
      <p>{NO_LIVE_AUTHORIZATION_NOTICE}</p>
    </section>
  );
}

function PreRunSection() {
  return (
    <section>
      <h2>Pre-run requirements</h2>
      <p className="loc__section-lead">
        Confirm every line below before the founder-approved retry begins.
        Missing a line means stop and re-confirm with the founder.
      </p>
      <ol className="loc__ordered">
        {PRE_RUN_REQUIREMENTS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

function CrossProviderHardStops() {
  return (
    <section className="loc__cross-stops">
      <h2>Cross-provider safety hard stops</h2>
      <p className="loc__section-lead">
        These stops apply to every provider regardless of the retry scope. The
        per-provider sections below add provider-specific stops on top.
      </p>
      <ul className="loc__bullets loc__bullets--bad">
        {CROSS_PROVIDER_HARD_STOPS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function ProviderSection({ provider }: { provider: ProviderChecklist }) {
  return (
    <section className={`loc__provider loc__provider--${provider.key}`}>
      <header className="loc__provider-head">
        <h2>{provider.title}</h2>
        <p className="loc__scope">{provider.scope}</p>
      </header>

      <div className="loc__provider-grid">
        <article className="loc__panel loc__panel--bad">
          <h3>Hard stops</h3>
          <ul className="loc__bullets loc__bullets--bad">
            {provider.hardStops.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>

        <article className="loc__panel loc__panel--bad">
          <h3>Never do</h3>
          <ul className="loc__bullets loc__bullets--bad">
            {provider.neverDo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      </div>

      <article className="loc__panel">
        <h3>Evidence to collect after the run</h3>
        <p className="loc__panel-lead">
          Collect every row before opening the analyzer. Task UI alone is not
          enough; DB / worker log / screenshots / live snapshots are the
          source of truth.
        </p>
        <div className="loc__evidence">
          {provider.evidence.map((target) => (
            <div key={target.label} className="loc__evidence-row">
              <div className="loc__evidence-head">
                <strong>{target.label}</strong>
                <code>{target.path}</code>
              </div>
              <p className="loc__evidence-desc">{target.description}</p>
              <pre className="loc__cmd">{target.command}</pre>
              <ul className="loc__bullets">
                {target.whatToLookFor.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </article>

      <article className="loc__panel">
        <h3>Analyzer commands</h3>
        <p className="loc__panel-lead">
          Run only after the run finished and the artifact bundle has been
          assembled locally. Analyzers do not start a worker, open a provider,
          read the database, or click anything.
        </p>
        <div className="loc__analyzers">
          {provider.analyzers.map((analyzer) => (
            <div key={analyzer.label} className="loc__analyzer-row">
              <strong>{analyzer.label}</strong>
              <pre className="loc__cmd">{analyzer.command}</pre>
              <p className="loc__panel-lead">{analyzer.bundleHint}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="loc__panel">
        <h3>Runbooks</h3>
        <ul className="loc__runbooks">
          {provider.runbooks.map((runbook) => (
            <li key={runbook.path}>
              <code>{runbook.path}</code>
              <strong>{runbook.label}</strong>
              <span>{runbook.note}</span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function PostRunReportSection() {
  return (
    <section>
      <h2>What to send back after the run</h2>
      <p className="loc__section-lead">
        Per the New Agent Startup Contract, report only the canonical fields
        below. No prose dump, no screenshot dump.
      </p>
      <ul className="loc__bullets">
        {POST_RUN_REPORT_FIELDS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function PageBoundarySection() {
  return (
    <section className="loc__boundary">
      <h2>What this page does NOT do</h2>
      <ul className="loc__bullets loc__bullets--bad">
        {FORBIDDEN_BUTTONS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="loc__panel-lead">
        Re-runs, retries, and any provider session must be initiated from a
        shell against the integrated preview worktree, only after the founder
        has approved exactly one controlled run for one provider/case.
      </p>
    </section>
  );
}

function Styles() {
  return (
    <style>{`
.loc {
  max-width: 1160px;
  margin: 0 auto;
  padding: 28px 32px 64px;
  color: #111827;
  font: 14px / 1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.loc__breadcrumb { font-size: 12px; color: #64748b; margin-bottom: 10px; }
.loc__breadcrumb a { color: #2563eb; text-decoration: none; }
.loc__hero {
  border: 1px solid #e5e7eb;
  border-left: 5px solid #2563eb;
  border-radius: 8px;
  padding: 18px;
  background: #ffffff;
}
.loc__hero h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.1; }
.loc__hero p { margin: 0; max-width: 860px; color: #475569; }
.loc__notes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
  color: #64748b;
  font-size: 12px;
}
.loc__notes code { color: #334155; }

.loc__banner {
  margin-top: 22px;
  border: 1px solid #fecaca;
  border-left: 5px solid #b91c1c;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fff7f7;
  color: #7f1d1d;
}
.loc__banner h2 { margin: 0 0 6px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; }
.loc__banner p { margin: 0; max-width: 860px; }

section { margin-top: 26px; }
h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #0f172a;
}
.loc__section-lead {
  margin: 0 0 12px;
  color: #475569;
  max-width: 860px;
}

.loc__ordered, .loc__bullets {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
}
.loc__ordered li, .loc__bullets li {
  color: #1f2937;
}
.loc__bullets--bad li { color: #7f1d1d; }

.loc__cross-stops {
  border: 1px solid #fde68a;
  border-left: 5px solid #b45309;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fffbeb;
}
.loc__cross-stops h2 { color: #78350f; }

.loc__provider {
  border: 1px solid #e5e7eb;
  border-left-width: 5px;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
  margin-top: 22px;
}
.loc__provider--restaurant { border-left-color: #2563eb; }
.loc__provider--expedia { border-left-color: #b45309; }
.loc__provider--hotel { border-left-color: #6d28d9; }

.loc__provider-head h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.loc__scope { margin: 0 0 14px; color: #64748b; font-size: 13px; max-width: 860px; }

.loc__provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.loc__panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  padding: 14px;
  margin-top: 12px;
}
.loc__panel h3 { margin: 0 0 8px; font-size: 13px; color: #0f172a; letter-spacing: 0.04em; text-transform: uppercase; }
.loc__panel-lead { margin: 0 0 10px; color: #475569; font-size: 12.5px; max-width: 800px; }
.loc__panel--bad { background: #fff7f7; border-color: #fecaca; }
.loc__panel--bad h3 { color: #7f1d1d; }

.loc__evidence {
  display: grid;
  gap: 12px;
}
.loc__evidence-row {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
}
.loc__evidence-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  margin-bottom: 4px;
}
.loc__evidence-head code {
  color: #334155;
  font-size: 12px;
  word-break: break-word;
}
.loc__evidence-desc { margin: 0 0 8px; color: #475569; font-size: 12.5px; max-width: 860px; }

.loc__cmd {
  border: 1px solid #cbd5e1;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
  margin: 0 0 8px;
  font: 12px / 1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.loc__analyzers {
  display: grid;
  gap: 10px;
}
.loc__analyzer-row {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
}
.loc__analyzer-row strong { display: block; margin-bottom: 6px; color: #0f172a; }

.loc__runbooks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.loc__runbooks li {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 10px;
  align-items: baseline;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 9px 12px;
  background: #ffffff;
}
.loc__runbooks code { color: #334155; font-size: 12px; word-break: break-word; }
.loc__runbooks strong { display: inline; color: #0f172a; }
.loc__runbooks span { display: block; color: #64748b; font-size: 12.5px; }

.loc__boundary {
  border: 1px solid #fecaca;
  border-left: 5px solid #b91c1c;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fff7f7;
}
.loc__boundary h2 { color: #7f1d1d; }

@media (max-width: 760px) {
  .loc { padding: 20px 18px 48px; }
  .loc__runbooks li { grid-template-columns: 1fr; gap: 4px; }
}
    `}</style>
  );
}
