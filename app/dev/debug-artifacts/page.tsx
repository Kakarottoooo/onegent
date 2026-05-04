"use client";

/**
 * /dev/debug-artifacts — debug-screenshot artifact viewer.
 *
 * Reads:
 *   GET /api/dev/debug-artifacts                              — index (providers × runs)
 *   GET /api/dev/debug-artifacts/[provider]/[run]/asset/[file] — raw bytes
 *
 * Companion to /dev/resy-probe-runs and /dev/benchmark-runs:
 *
 *   probe-runs    — "which case can I spend a live token on?"
 *   benchmark-runs — "did the live run pass the gate? what's the metric?"
 *   debug-artifacts (this) — "the run failed somewhere; what did the page
 *                            actually look like at that moment?"
 *
 * Founder no longer needs to open file explorer to look at
 * `worker/.debug-screenshots/opentable/<ts>-<label>/page.png`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  DebugArtifactIndex,
  DebugArtifactProvider,
  DebugArtifactRun,
} from "@/lib/debug-artifacts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export default function DebugArtifactsPage() {
  const [index, setIndex] = useState<DebugArtifactIndex | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  /* ─── Load ───────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/debug-artifacts", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Debug artifacts API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load index (${res.status})`);
      }
      const json = (await res.json()) as DebugArtifactIndex;
      setIndex(json);
      setState({ status: "ready" });
      // Auto-select first provider + first run if nothing's active.
      setActiveProvider((prev) => prev ?? json.providers[0]?.provider ?? null);
      setActiveRunId(
        (prev) => prev ?? json.providers[0]?.runs[0]?.runId ?? null,
      );
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load index.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ─── Derived ───────────────────────────────────────────────────── */

  const activeProviderObj: DebugArtifactProvider | null = useMemo(() => {
    if (!index || !activeProvider) return null;
    return index.providers.find((p) => p.provider === activeProvider) ?? null;
  }, [index, activeProvider]);

  const activeRun: DebugArtifactRun | null = useMemo(() => {
    if (!activeProviderObj || !activeRunId) return null;
    return activeProviderObj.runs.find((r) => r.runId === activeRunId) ?? null;
  }, [activeProviderObj, activeRunId]);

  const screenshotUrl =
    activeProvider && activeRunId && activeRun?.files.includes("page.png")
      ? `/api/dev/debug-artifacts/${encodeURIComponent(
          activeProvider,
        )}/${encodeURIComponent(activeRunId)}/asset/page.png`
      : null;

  const htmlUrl =
    activeProvider && activeRunId && activeRun?.files.includes("page.html")
      ? `/api/dev/debug-artifacts/${encodeURIComponent(
          activeProvider,
        )}/${encodeURIComponent(activeRunId)}/asset/page.html`
      : null;

  /* ─── Render ────────────────────────────────────────────────────── */

  return (
    <main className="dbga">
      <header className="dbga__top">
        <p className="dbga__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="dbga__title">Debug artifacts viewer</h1>
        <p className="dbga__sub">
          Reads <code>worker/.debug-screenshots/&lt;provider&gt;/&lt;run&gt;/</code>.
          Each run dir is one captured failure (provider trace wrote{" "}
          <code>summary.json</code> + <code>page.png</code> at the moment of error).
          Founder doesn&apos;t need to open file explorer anymore.
        </p>
        <p className="dbga__related">
          Related dashboards:{" "}
          <Link className="dbga__related-link" href="/dev/resy-probe-runs">
            /dev/resy-probe-runs
          </Link>{" "}
          (which case to spend a live token on) ·{" "}
          <Link className="dbga__related-link" href="/dev/benchmark-runs">
            /dev/benchmark-runs
          </Link>{" "}
          (did the live run pass?)
        </p>
        <p className="dbga__sub dbga__sub--muted">
          Note: this dashboard reads from <code>process.cwd()/worker/.debug-screenshots</code>{" "}
          — runs captured in a sibling worktree (e.g. codex&apos;s detached
          worktree) won&apos;t show up here unless you serve dev from that
          worktree.
        </p>
      </header>

      {state.status === "loading" && <p className="dbga__muted">Loading index…</p>}
      {state.status === "error" && (
        <p className="dbga__error">
          {state.message}{" "}
          <button type="button" onClick={() => void load()} className="dbga__retry">
            Retry
          </button>
        </p>
      )}

      {state.status === "ready" && index && (
        <>
          <SummaryStrip index={index} />

          {index.providers.length === 0 ? (
            <EmptyState />
          ) : (
            <section className="dbga__layout">
              <aside className="dbga__sidebar">
                {index.providers.map((p) => (
                  <ProviderBlock
                    key={p.provider}
                    provider={p}
                    activeProvider={activeProvider}
                    activeRunId={activeRunId}
                    onPick={(provider, runId) => {
                      setActiveProvider(provider);
                      setActiveRunId(runId);
                    }}
                  />
                ))}
              </aside>

              <section className="dbga__detail">
                {!activeRun && (
                  <p className="dbga__muted">
                    Pick a run from the sidebar to inspect summary +
                    screenshot + HTML snapshot.
                  </p>
                )}
                {activeRun && (
                  <RunDetail
                    provider={activeProvider ?? ""}
                    run={activeRun}
                    screenshotUrl={screenshotUrl}
                    htmlUrl={htmlUrl}
                    onLightbox={() => setLightboxOpen(true)}
                  />
                )}
              </section>
            </section>
          )}
        </>
      )}

      {lightboxOpen && screenshotUrl && (
        <div
          className="dbga__lightbox"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-label="Screenshot lightbox — click anywhere to close"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dbga__lightbox-img" src={screenshotUrl} alt="page.png full size" />
        </div>
      )}

      <DebugArtifactsStyles />
    </main>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function SummaryStrip({ index }: { index: DebugArtifactIndex }) {
  return (
    <div className="dbga__summary">
      <Stat label="Providers" value={index.totals.providers} />
      <Stat label="Runs total" value={index.totals.runs} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="dbga__stat">
      <div className="dbga__stat-value">{value}</div>
      <div className="dbga__stat-label">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="dbga__empty">
      <h3>No debug artifacts captured yet</h3>
      <p>
        Provider runs that hit a terminal guest-form / OTP / availability
        failure write to <code>worker/.debug-screenshots/&lt;provider&gt;/</code>.
        Nothing has been captured in this worktree yet. To populate, run a
        booking through the worker:
      </p>
      <ul>
        <li>
          <strong>OpenTable</strong>: an OpenTable booking that fails at
          phone-gate / guest-form will write to{" "}
          <code>opentable/&lt;ts&gt;-&lt;label&gt;/</code>.
        </li>
        <li>
          <strong>Resy</strong>: a Resy live run (probe-first — see{" "}
          <Link className="dbga__related-link" href="/dev/resy-probe-runs">
            /dev/resy-probe-runs
          </Link>
          ) that hits a fill / OTP failure will write to{" "}
          <code>resy/&lt;ts&gt;-&lt;label&gt;/</code>.
        </li>
      </ul>
      <p>
        Probe-first hint: don&apos;t spend a live OpenAI token before
        confirming the case has matching slots. A no-slot case fails on
        availability, not on the fill flow you wanted to debug — the resulting
        screenshot is uninformative for fill / OTP work.
      </p>
      <p className="dbga__sub--muted">
        If you expected runs here but see nothing, the dev server may be
        running from a different worktree than the worker that wrote the
        artifacts. Both processes must run from the same checkout.
      </p>
    </section>
  );
}

function ProviderBlock({
  provider,
  activeProvider,
  activeRunId,
  onPick,
}: {
  provider: DebugArtifactProvider;
  activeProvider: string | null;
  activeRunId: string | null;
  onPick: (provider: string, runId: string) => void;
}) {
  // Sidebar already lists newest-first per loader contract (see
  // lib/debug-artifacts.ts). The "latest" shortcut is convenient when the
  // provider has many runs and you just want the most recent capture
  // without scanning timestamps.
  const latest = provider.runs[0] ?? null;
  return (
    <div className="dbga__provider">
      <h3 className="dbga__provider-title">
        {provider.provider}
        <span className="dbga__provider-count">{provider.runs.length}</span>
      </h3>
      {latest && (
        <button
          type="button"
          className="dbga__latest-btn"
          onClick={() => onPick(provider.provider, latest.runId)}
          title={`Jump to most recent run for ${provider.provider}`}
        >
          ↟ Latest run
        </button>
      )}
      {provider.runs.length === 0 && (
        <p className="dbga__muted">no runs</p>
      )}
      <ol className="dbga__runs">
        {provider.runs.map((r) => {
          const isActive =
            r.runId === activeRunId && provider.provider === activeProvider;
          return (
            <li
              key={r.runId}
              className={
                isActive ? "dbga__run dbga__run--active" : "dbga__run"
              }
            >
              <button
                type="button"
                className="dbga__run-btn"
                onClick={() => onPick(provider.provider, r.runId)}
              >
                <div className="dbga__run-when">
                  {r.capturedAt
                    ? new Date(r.capturedAt).toLocaleString()
                    : r.runId}
                </div>
                <div className="dbga__run-label">{r.label || "(no label)"}</div>
                <div className="dbga__run-files">
                  {r.files.map((f) => (
                    <span key={f} className="dbga__file-chip">
                      {f}
                    </span>
                  ))}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RunDetail({
  provider,
  run,
  screenshotUrl,
  htmlUrl,
  onLightbox,
}: {
  provider: string;
  run: DebugArtifactRun;
  screenshotUrl: string | null;
  htmlUrl: string | null;
  onLightbox: () => void;
}) {
  return (
    <>
      <div className="dbga__detail-head">
        <h2 className="dbga__detail-title">
          <code>{provider}</code> · {run.label || "(no label)"}
        </h2>
        <p className="dbga__detail-when">
          {run.capturedAt
            ? new Date(run.capturedAt).toLocaleString()
            : run.runId}
        </p>
      </div>

      {run.summary && (
        <div className="dbga__summary-block">
          <h3 className="dbga__h3">summary.json</h3>
          {run.summary.url && (
            <p className="dbga__summary-url">
              <strong>URL:</strong>{" "}
              <a
                href={run.summary.url}
                target="_blank"
                rel="noopener noreferrer"
                className="dbga__summary-url-link"
              >
                {run.summary.url}
              </a>
            </p>
          )}
          {run.summary.viewport && (
            <p className="dbga__summary-viewport">
              <strong>Viewport:</strong> {run.summary.viewport.width}×
              {run.summary.viewport.height}
            </p>
          )}
          <pre className="dbga__summary-payload">
            {JSON.stringify(run.summary.summary, null, 2)}
          </pre>
        </div>
      )}

      {screenshotUrl ? (
        <div className="dbga__screenshot-block">
          <h3 className="dbga__h3">page.png</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="dbga__screenshot"
            src={screenshotUrl}
            alt={`${provider} ${run.runId} screenshot`}
            onClick={onLightbox}
          />
          <p className="dbga__hint">Click image for full-size lightbox.</p>
        </div>
      ) : (
        <p className="dbga__muted">No <code>page.png</code> captured for this run.</p>
      )}

      {htmlUrl && (
        <div className="dbga__html-block">
          <h3 className="dbga__h3">page.html</h3>
          <iframe
            className="dbga__html-frame"
            src={htmlUrl}
            sandbox=""
            title={`${provider} ${run.runId} HTML snapshot`}
          />
          <p className="dbga__hint">
            Sandboxed iframe (no scripts, no same-origin) — paths inside the
            HTML snapshot may render with broken assets, but DOM/text is
            inspectable.
          </p>
        </div>
      )}
    </>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function DebugArtifactsStyles() {
  return (
    <style>{`
      .dbga {
        --ink-9: #111827; --ink-7: #4b5563; --ink-6: #6b7280; --ink-3: #e5e7eb; --ink-2: #f3f4f6;
        --card: #ffffff; --bg: #fafafa;
        --good: #16a34a; --good-bg: rgba(22,163,74,0.10); --good-bd: rgba(22,163,74,0.30);
        --ok: #0ea5e9; --ok-bg: rgba(14,165,233,0.10); --ok-bd: rgba(14,165,233,0.30);
        --warn: #f59e0b; --warn-bg: rgba(245,158,11,0.12); --warn-bd: rgba(245,158,11,0.32);
        max-width: 1400px; margin: 0 auto; padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg); min-height: 100vh; color: var(--ink-9);
      }
      .dbga__top { margin-bottom: 18px; }
      .dbga__crumb a { color: var(--ink-6); font-size: 13px; text-decoration: none; }
      .dbga__crumb a:hover { color: var(--ink-9); }
      .dbga__title { margin: 8px 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
      .dbga__sub { margin: 0 0 4px; font-size: 13px; color: var(--ink-7); line-height: 1.55; max-width: 880px; }
      .dbga__sub--muted { font-size: 12px; color: var(--ink-6); }
      .dbga__sub code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }
      .dbga__related { margin: 6px 0 6px; font-size: 12px; color: var(--ink-7); }
      .dbga__related-link { color: var(--ok); text-decoration: none; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 600; }
      .dbga__related-link:hover { text-decoration: underline; }
      .dbga__latest-btn { width: 100%; margin: 0 0 8px; padding: 4px 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--ink-3); border-radius: 6px; background: var(--ink-2); cursor: pointer; color: var(--ink-7); }
      .dbga__latest-btn:hover { border-color: var(--ok); color: var(--ok); }
      .dbga__muted { color: var(--ink-6); font-size: 13px; }
      .dbga__error { color: var(--warn); font-size: 13px; }
      .dbga__retry { margin-left: 8px; padding: 2px 10px; font-size: 11px; border: 1px solid var(--ink-3); border-radius: 4px; background: var(--card); cursor: pointer; }

      .dbga__summary { display: flex; gap: 10px; margin: 16px 0; }
      .dbga__stat { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 10px 14px; min-width: 110px; }
      .dbga__stat-value { font-size: 20px; font-weight: 700; line-height: 1.1; }
      .dbga__stat-label { font-size: 11px; color: var(--ink-6); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }

      .dbga__empty { background: var(--card); border: 1px solid var(--ink-3); border-radius: 12px; padding: 24px; max-width: 720px; }
      .dbga__empty h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
      .dbga__empty p { margin: 0 0 8px; font-size: 13px; color: var(--ink-7); line-height: 1.6; }
      .dbga__empty ul { margin: 8px 0; padding-left: 20px; font-size: 13px; color: var(--ink-7); line-height: 1.6; }
      .dbga__empty code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }

      .dbga__layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; }
      @media (max-width: 900px) { .dbga__layout { grid-template-columns: 1fr; } }

      .dbga__sidebar { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 12px; max-height: 70vh; overflow-y: auto; }
      .dbga__provider { margin-bottom: 14px; }
      .dbga__provider:last-child { margin-bottom: 0; }
      .dbga__provider-title { margin: 0 0 8px; padding: 0 4px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); display: flex; justify-content: space-between; align-items: baseline; }
      .dbga__provider-count { font-size: 10.5px; font-weight: 600; color: var(--ink-6); background: var(--ink-2); border-radius: 999px; padding: 1px 8px; letter-spacing: 0; }
      .dbga__runs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .dbga__run--active .dbga__run-btn { background: var(--ok-bg); border-color: var(--ok-bd); }
      .dbga__run-btn { width: 100%; text-align: left; padding: 8px 10px; border: 1px solid var(--ink-3); border-radius: 6px; background: var(--card); cursor: pointer; transition: border-color 120ms; font: inherit; color: inherit; }
      .dbga__run-btn:hover { border-color: var(--ok); }
      .dbga__run-when { font-size: 11.5px; font-weight: 600; }
      .dbga__run-label { font-size: 11px; color: var(--ink-7); margin-top: 2px; }
      .dbga__run-files { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
      .dbga__file-chip { background: var(--ink-2); color: var(--ink-7); border-radius: 4px; padding: 1px 6px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, monospace; }

      .dbga__detail { display: flex; flex-direction: column; gap: 14px; }
      .dbga__detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .dbga__detail-title { margin: 0; font-size: 16px; font-weight: 600; }
      .dbga__detail-title code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 14px; background: var(--ink-2); padding: 1px 6px; border-radius: 4px; }
      .dbga__detail-when { margin: 0; font-size: 12px; color: var(--ink-6); }

      .dbga__h3 { margin: 0 0 8px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); }
      .dbga__summary-block, .dbga__screenshot-block, .dbga__html-block { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px 16px; }
      .dbga__summary-url { margin: 0 0 6px; font-size: 12.5px; word-break: break-all; }
      .dbga__summary-url-link { color: var(--ok); text-decoration: none; word-break: break-all; }
      .dbga__summary-url-link:hover { text-decoration: underline; }
      .dbga__summary-viewport { margin: 0 0 6px; font-size: 12.5px; color: var(--ink-7); }
      .dbga__summary-payload { background: var(--ink-2); border-radius: 6px; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11.5px; line-height: 1.5; overflow-x: auto; max-height: 240px; margin: 0; }
      .dbga__screenshot { width: 100%; max-width: 1100px; height: auto; border-radius: 6px; border: 1px solid var(--ink-3); cursor: zoom-in; display: block; }
      .dbga__html-frame { width: 100%; height: 480px; border: 1px solid var(--ink-3); border-radius: 6px; background: #fff; }
      .dbga__hint { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-6); font-style: italic; }

      .dbga__lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; cursor: zoom-out; padding: 24px; }
      .dbga__lightbox-img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 4px 32px rgba(0,0,0,0.5); }
    `}</style>
  );
}
