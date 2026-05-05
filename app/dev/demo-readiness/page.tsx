import {
  formatDemoReadinessMarkdown,
  loadDemoEvidenceSnapshot,
  type DemoEvidenceSnapshot,
  type DemoEvidenceTone,
} from "@/lib/demo-evidence";

export const dynamic = "force-dynamic";

export default async function DemoReadinessPage() {
  const snap = await loadDemoEvidenceSnapshot();
  const markdown = formatDemoReadinessMarkdown(snap);

  return (
    <main className="demo-readiness">
      <Styles />
      <Header snap={snap} />
      <EvidenceGrid snap={snap} />
      <Phase2Posture />
      <HardStops snap={snap} />
      <RouteOrder snap={snap} />
      <UsefulLinks snap={snap} />
      <MarkdownExport markdown={markdown} />
    </main>
  );
}

function Header({ snap }: { snap: DemoEvidenceSnapshot }) {
  return (
    <header className={`dr__hero dr__hero--${snap.readiness.tone}`}>
      <div className="dr__breadcrumb">
        <a href="/dev">/dev</a>
        <span> / demo-readiness</span>
      </div>
      <div className="dr__hero-row">
        <div>
          <h1>Demo Readiness</h1>
          <p>
            Compact, read-only pre-demo summary. For the full founder script
            and evidence dashboard, open <a href="/dev/demo-control-room">Demo Control Room</a>.
            Use <code>docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md</code> as the
            final acceptance checklist.
          </p>
        </div>
        <div className={`dr__verdict dr__verdict--${snap.readiness.tone}`}>
          {snap.readiness.verdict.replace("_", " ")}
        </div>
      </div>
      <div className="dr__notes">
        <span>Generated {new Date(snap.generatedAt).toLocaleString()}</span>
        <span>Phase 2 not live verified.</span>
        <span>No live provider, payment, OTP, CAPTCHA, or final confirmation controls.</span>
      </div>
      {snap.readiness.blockers.length > 0 && (
        <Callout title="Blockers" tone="bad" items={snap.readiness.blockers} />
      )}
      {snap.readiness.warnings.length > 0 && (
        <Callout title="Warnings" tone="warn" items={snap.readiness.warnings} />
      )}
    </header>
  );
}

function EvidenceGrid({ snap }: { snap: DemoEvidenceSnapshot }) {
  const gate = snap.phase1Gate.summary;
  const founder = snap.founderE2e.summary;
  const smoke = snap.phase1Gate.smoke;
  const runtime = snap.runtimeForensics;

  return (
    <section>
      <h2>Build / Gate / Demo Evidence</h2>
      <div className="dr__grid">
        <EvidenceCard
          title="Phase 1 Gate"
          tone={gateTone(gate?.verdict)}
          href="/dev/phase1-quality-gates"
          body={
            gate
              ? `${gate.verdict}: ${gate.passCount}/${gate.totalChecks} pass, ${gate.failCount} fail`
              : "No artifact found"
          }
          meta={snap.phase1Gate.relPath ?? "Run from shell before demo"}
        />
        <EvidenceCard
          title="Founder E2E"
          tone={founderTone(founder?.runnerVerdict, founder?.blocker)}
          href="/dev/founder-e2e"
          body={
            founder
              ? `${founder.runnerVerdict ?? "manual"}: ${founder.pass}/${founder.total} pass, ${founder.blocker} blocker`
              : "No artifact found"
          }
          meta={snap.founderE2e.relPath ?? "Run from shell or /dev/founder-e2e"}
        />
        <EvidenceCard
          title="Smoke"
          tone={smokeTone(smoke.status, smoke.present)}
          href="/dev/phase1-quality-gates"
          body={smoke.present ? `smoke:phase1 ${smoke.status}` : "Not present"}
          meta={smoke.hint}
        />
        <EvidenceCard
          title="Runtime Forensics"
          tone={runtime.p0Count > 0 ? "bad" : runtime.p1Count > 0 ? "warn" : "neutral"}
          href="/dev/runtime-forensics"
          body={`${runtime.reportCount} artifact report(s), ${runtime.p0Count} P0, ${runtime.legacyShapeCount} legacy-shape`}
          meta={`${runtime.scannedFiles} benchmark file(s) scanned. Worker log: ${runtime.workerLogAvailable ? "available" : "not found"}`}
        />
      </div>
    </section>
  );
}

function Phase2Posture() {
  return (
    <section className="dr__phase2">
      <h2>Phase 2 Posture</h2>
      <p>
        Phase 2 is not live verified. Treat Expedia as an audited candidate,
        and treat Booking.com and Hotels.com as not demo-ready until fresh
        founder-approved artifacts exist.
      </p>
    </section>
  );
}

function HardStops({ snap }: { snap: DemoEvidenceSnapshot }) {
  return (
    <section>
      <h2>Hard Stops</h2>
      <div className="dr__stops">
        {snap.hardStops.map((stop) => (
          <article key={stop.id} className="dr__stop">
            <h3>{stop.trigger}</h3>
            <p>{stop.action}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RouteOrder({ snap }: { snap: DemoEvidenceSnapshot }) {
  return (
    <section>
      <h2>Exact Demo Route Order</h2>
      <ol className="dr__routes">
        {snap.routeOrder.map((step) => (
          <li key={step.href}>
            <a href={step.href}>{step.href}</a>
            <strong>{step.label}</strong>
            <span>{step.purpose}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UsefulLinks({ snap }: { snap: DemoEvidenceSnapshot }) {
  return (
    <section>
      <h2>Useful Links</h2>
      <div className="dr__links">
        {snap.docs.map((doc) => (
          <div key={doc.path} className="dr__link-row">
            <span className={`dr__doc-status dr__doc-status--${doc.exists ? "ok" : "missing"}`}>
              {doc.exists ? "present" : "missing"}
            </span>
            <span>{doc.label}</span>
            <code>{doc.path}</code>
          </div>
        ))}
      </div>
      <h3 className="dr__subhead">Phase 2 / Expedia posture</h3>
      <div className="dr__links">
        {snap.phase2Links.map((link) => (
          <div key={link.label + link.path} className="dr__link-row">
            <span className="dr__doc-status dr__doc-status--info">read</span>
            <span>{link.label}</span>
            <code>{link.path}</code>
            <em>{link.note}</em>
          </div>
        ))}
      </div>
      {snap.notes.length > 0 && (
        <details className="dr__loader-notes">
          <summary>Loader notes ({snap.notes.length})</summary>
          <ul>
            {snap.notes.map((note) => (
              <li key={note}>
                <code>{note}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function MarkdownExport({ markdown }: { markdown: string }) {
  return (
    <section>
      <h2>Markdown Export</h2>
      <details className="dr__markdown-export">
        <summary>Copy demo readiness markdown</summary>
        <textarea
          readOnly
          className="dr__markdown-textarea"
          value={markdown}
          rows={Math.min(32, markdown.split("\n").length + 2)}
        />
      </details>
    </section>
  );
}

function Callout({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "bad" | "warn";
  items: string[];
}) {
  return (
    <div className={`dr__callout dr__callout--${tone}`}>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceCard({
  title,
  tone,
  href,
  body,
  meta,
}: {
  title: string;
  tone: DemoEvidenceTone;
  href: string;
  body: string;
  meta: string;
}) {
  return (
    <article className={`dr__card dr__card--${tone}`}>
      <div className="dr__card-head">
        <h3>{title}</h3>
        <a href={href}>Open</a>
      </div>
      <p className="dr__card-body">{body}</p>
      <p className="dr__card-meta">{meta}</p>
    </article>
  );
}

function gateTone(verdict: string | undefined): DemoEvidenceTone {
  if (verdict === "pass") return "good";
  if (verdict === "needs_polish") return "warn";
  if (verdict === "fail" || verdict === "env_blocked") return "bad";
  return "neutral";
}

function founderTone(
  verdict: string | undefined,
  blocker: number | undefined,
): DemoEvidenceTone {
  if (verdict === "pass" && !blocker) return "good";
  if (verdict === "fail" || (blocker ?? 0) > 0) return "bad";
  if (verdict === "needs_polish") return "warn";
  return "neutral";
}

function smokeTone(
  status: string | null,
  present: boolean,
): DemoEvidenceTone {
  if (!present) return "neutral";
  if (status === "pass") return "good";
  if (status === "fail") return "bad";
  return "warn";
}

function Styles() {
  return (
    <style>{`
.demo-readiness {
  max-width: 1160px;
  margin: 0 auto;
  padding: 28px 32px 64px;
  color: #111827;
  font: 14px / 1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dr__breadcrumb { font-size: 12px; color: #64748b; margin-bottom: 10px; }
.dr__breadcrumb a { color: #2563eb; text-decoration: none; }
.dr__hero {
  border: 1px solid #e5e7eb;
  border-left-width: 5px;
  border-radius: 8px;
  padding: 18px;
  background: #ffffff;
}
.dr__hero--good { border-left-color: #059669; }
.dr__hero--warn { border-left-color: #b45309; }
.dr__hero--bad { border-left-color: #b91c1c; }
.dr__hero--neutral { border-left-color: #94a3b8; }
.dr__hero-row {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}
.dr__hero h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.1; }
.dr__hero p { margin: 0; max-width: 760px; color: #475569; }
.dr__hero a { color: #2563eb; text-decoration: none; }
.dr__hero a:hover { text-decoration: underline; }
.dr__verdict {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 12px;
  font-weight: 800;
  border-radius: 6px;
  padding: 8px 10px;
  white-space: nowrap;
}
.dr__verdict--good { color: #065f46; background: #d1fae5; }
.dr__verdict--warn { color: #92400e; background: #fef3c7; }
.dr__verdict--bad { color: #991b1b; background: #fee2e2; }
.dr__verdict--neutral { color: #334155; background: #e2e8f0; }
.dr__notes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
  color: #64748b;
  font-size: 12px;
}
.dr__callout {
  margin-top: 14px;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
}
.dr__callout ul { margin: 6px 0 0; padding-left: 18px; }
.dr__callout--bad { color: #7f1d1d; background: #fee2e2; border: 1px solid #fecaca; }
.dr__callout--warn { color: #78350f; background: #fffbeb; border: 1px solid #fde68a; }
section { margin-top: 26px; }
h2 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #0f172a;
}
.dr__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.dr__card {
  border: 1px solid #e5e7eb;
  border-left-width: 4px;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}
.dr__card--good { border-left-color: #059669; }
.dr__card--warn { border-left-color: #b45309; }
.dr__card--bad { border-left-color: #b91c1c; }
.dr__card--neutral { border-left-color: #94a3b8; }
.dr__card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}
.dr__card h3 { margin: 0; font-size: 14px; }
.dr__card a { color: #2563eb; text-decoration: none; font-size: 12px; }
.dr__card-body { margin: 8px 0 4px; color: #111827; }
.dr__card-meta { margin: 0; font-size: 12px; color: #64748b; word-break: break-word; }
.dr__phase2 {
  border: 1px solid #fed7aa;
  border-left: 4px solid #ea580c;
  border-radius: 8px;
  padding: 14px;
  background: #fff7ed;
}
.dr__phase2 p { margin: 0; color: #7c2d12; max-width: 860px; }
.dr__stops {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px;
}
.dr__stop {
  border: 1px solid #fecaca;
  background: #fff7f7;
  border-radius: 8px;
  padding: 12px;
}
.dr__stop h3 { margin: 0 0 6px; font-size: 13px; color: #7f1d1d; }
.dr__stop p { margin: 0; font-size: 12.5px; color: #475569; }
.dr__routes {
  display: grid;
  gap: 8px;
  list-style-position: inside;
  padding: 0;
  margin: 0;
}
.dr__routes li {
  display: grid;
  grid-template-columns: 170px 190px 1fr;
  gap: 10px;
  align-items: baseline;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
}
.dr__routes a { color: #2563eb; text-decoration: none; font-family: ui-monospace, monospace; font-size: 12px; }
.dr__routes strong { font-size: 13px; }
.dr__routes span { color: #64748b; font-size: 12.5px; }
.dr__links {
  display: grid;
  gap: 8px;
}
.dr__link-row {
  display: grid;
  grid-template-columns: 82px 220px 1fr;
  gap: 10px;
  align-items: baseline;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 9px 12px;
  background: #fff;
}
.dr__link-row code {
  color: #334155;
  font-size: 12px;
  word-break: break-word;
}
.dr__link-row em {
  grid-column: 3;
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}
.dr__doc-status {
  display: inline-flex;
  justify-content: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dr__doc-status--ok { color: #065f46; background: #d1fae5; }
.dr__doc-status--missing { color: #991b1b; background: #fee2e2; }
.dr__doc-status--info { color: #1e3a8a; background: #dbeafe; }
.dr__subhead { margin: 18px 0 8px; font-size: 14px; color: #334155; }
.dr__loader-notes { margin-top: 12px; color: #64748b; font-size: 12px; }
.dr__loader-notes ul { padding-left: 18px; }
.dr__markdown-export {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}
.dr__markdown-export summary {
  cursor: pointer;
  font-weight: 700;
  color: #334155;
}
.dr__markdown-textarea {
  width: 100%;
  margin-top: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  font: 12px / 1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  resize: vertical;
}
@media (max-width: 760px) {
  .demo-readiness { padding: 20px 18px 48px; }
  .dr__hero-row { display: block; }
  .dr__verdict { display: inline-flex; margin-top: 12px; }
  .dr__routes li,
  .dr__link-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .dr__link-row em { grid-column: auto; }
}
    `}</style>
  );
}
