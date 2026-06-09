import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-7xl flex-col justify-between gap-10">
        <header className="flex items-center justify-between border-b border-[var(--border)] pb-5">
          <Link href="/" className="font-serif text-2xl font-semibold">
            Onegent<span className="text-[var(--gold)]">.</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <Link href="/action-gateway" className="text-[var(--text-primary)]">
              Dashboard
            </Link>
            <Link href="/action-gateway/demo" className="rounded-lg bg-[var(--gold)] px-4 py-2 text-[var(--gold-text)]">
              Run demo
            </Link>
          </nav>
        </header>

        <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_460px]">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--gold)]">
              B2B AI Agent Action Gateway MVP
            </p>
            <h1 className="mt-4 font-serif text-5xl font-semibold leading-tight md:text-6xl">
              Action Gateway for AI Agents
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">
              Verify, approve, audit, and recover high-risk business actions
              before agents touch real systems.
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
              Onegent helps teams safely deploy agents that submit forms, send
              messages, update records, create purchase orders, or approve
              payments. Every high-risk action is captured, checked against
              policy, routed for approval, verified after mock execution, and
              saved to an audit trail.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/action-gateway"
                className="rounded-lg bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--gold-text)] shadow-[var(--shadow-2)]"
              >
                Open Action Gateway
              </Link>
              <Link
                href="/action-gateway/demo"
                className="rounded-lg border border-[var(--border)] px-5 py-3 text-sm font-semibold"
              >
                Run procurement demo
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-2)]">
            <div className="rounded-lg bg-[var(--card-2)] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Procurement action</span>
                <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300">
                  HIGH risk
                </span>
              </div>
              <h2 className="mt-4 text-xl font-semibold">
                Submit $4,850 purchase order
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Policy triggered: purchase orders over $1,000 require approval.
              </p>
            </div>

            <ol className="mt-5 grid gap-3 text-sm">
              {[
                "Capture agent intent",
                "Assess risk and policies",
                "Request human approval",
                "Mock execute only after approval",
                "Verify result and write audit trail",
              ].map((item, index) => (
                <li key={item} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold-soft)] text-xs font-semibold text-[var(--gold-text)]">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[var(--border)] pt-5 text-sm text-[var(--text-secondary)] md:flex-row md:items-center md:justify-between">
          <span>Mock-only MVP. No real purchase, email, ERP, CRM, vendor portal, or production website is touched.</span>
          <Link href="/legacy/consumer-agent" className="font-semibold text-[var(--text-primary)]">
            Legacy consumer demo
          </Link>
        </footer>
      </div>
    </main>
  );
}
