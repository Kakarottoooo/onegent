"use client";

/**
 * /dev/resy-probe-runs — Resy availability probe dashboard.
 *
 * Reads dev-only endpoints:
 *   GET /api/dev/resy-probe-runs            — list of probe runs
 *   GET /api/dev/resy-probe-runs/{file}     — full run content
 *
 * The probe runner lives at `scripts/probe-resy-availability.ts` (codex,
 * commit `024dd05`) and writes one JSON file per run to
 * `benchmark/runs/resy-availability-probe-<ts>.json`. The dashboard
 * mirrors that schema verbatim — see `lib/benchmark/resy-probe-report.ts`.
 *
 * Why this exists
 * ───────────────
 * R-003 burned a live OpenAI token chasing a Resy case that had zero
 * availability slots on the requested date — the agent did the right
 * thing (`no_availability_correct`) but you can't validate fill/OTP
 * closure on a no-slot case. Probe-first surfaces which cases actually
 * have live availability so the next live token spend lands on a case
 * that can prove fill/OTP works.
 *
 * Founder doesn't read terminal JSON anymore — this page is the
 * single-screen answer to "which case should I run live next?".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildNextLiveCommand,
  countByRecommendation,
  explainRecommendation,
  isExactVenueMatch,
  parseResyProbeUrl,
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
  type ResyProbeCase,
  type ResyProbeRun,
  type ResyProbeRunSummary,
  type ResyProbeSlot,
} from "@/lib/benchmark/resy-probe-report";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

interface ListResp {
  runs: ResyProbeRunSummary[];
  total: number;
}
interface SingleResp {
  run: ResyProbeRun;
}

export default function ResyProbeRunsPage() {
  const [runs, setRuns] = useState<ResyProbeRunSummary[]>([]);
  const [listState, setListState] = useState<LoadState>({ status: "loading" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [run, setRun] = useState<ResyProbeRun | null>(null);
  const [runState, setRunState] = useState<LoadState>({ status: "loading" });
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  /* ─── Loaders ─────────────────────────────────────────────────────── */

  const loadList = useCallback(async () => {
    setListState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/resy-probe-runs", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Probe API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load run list (${res.status})`);
      }
      const json = (await res.json()) as ListResp;
      setRuns(json.runs);
      setListState({ status: "ready" });
      setSelectedFile((prev) => prev ?? json.runs[0]?.file ?? null);
    } catch (err) {
      setListState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load run list.",
      });
    }
  }, []);

  const loadRun = useCallback(async (file: string) => {
    setRunState({ status: "loading" });
    setRun(null);
    setOpenCaseId(null);
    try {
      const res = await fetch(`/api/dev/resy-probe-runs/${encodeURIComponent(file)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load probe run (${res.status})`);
      }
      const json = (await res.json()) as SingleResp;
      setRun(json.run);
      setRunState({ status: "ready" });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load probe run.",
      });
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedFile) void loadRun(selectedFile);
  }, [selectedFile, loadRun]);

  const onCopy = useCallback(async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTag(tag);
      setTimeout(() => setCopiedTag((prev) => (prev === tag ? null : prev)), 1500);
    } catch {
      /* clipboard might be blocked; user can hand-copy */
    }
  }, []);

  const openCase = useMemo(() => {
    if (!run || !openCaseId) return null;
    return run.results.find((r) => r.caseId === openCaseId) ?? null;
  }, [run, openCaseId]);

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <main className="rprobe">
      <header className="rprobe__top">
        <p className="rprobe__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="rprobe__title">Resy availability probe runs</h1>
        <p className="rprobe__sub">
          Cheap no-token probe of Resy availability for Phase 0 fixture cases.
          Probe-first protocol: don&apos;t spend a live token on a case unless
          this dashboard says it has matching slots. Source:{" "}
          <code>benchmark/runs/resy-availability-probe-*.json</code>. Generate
          new runs with <code>npm run probe:resy</code> or{" "}
          <code>npm run probe:resy -- --case R-030</code>.
        </p>
      </header>

      <section className="rprobe__layout">
        <aside className="rprobe__list">
          <h2 className="rprobe__h2">Runs</h2>
          {listState.status === "loading" && <p className="rprobe__muted">Loading…</p>}
          {listState.status === "error" && (
            <p className="rprobe__error">
              {listState.message}{" "}
              <button
                type="button"
                onClick={() => void loadList()}
                className="rprobe__retry"
              >
                Retry
              </button>
            </p>
          )}
          {listState.status === "ready" && runs.length === 0 && (
            <div className="rprobe__empty">
              <p>
                <strong>No probe runs yet.</strong>
              </p>
              <p>
                Generate one (no live tokens, ~10–60s):
                <br />
                <code>npm run probe:resy -- --case R-030</code>
              </p>
              <p className="rprobe__muted-sm">
                Or whole suite: <code>npm run probe:resy</code>
              </p>
            </div>
          )}
          {listState.status === "ready" && runs.length > 0 && (
            <ol className="rprobe__list-items">
              {runs.map((r) => (
                <li
                  key={r.file}
                  className={
                    r.file === selectedFile
                      ? "rprobe__list-item rprobe__list-item--active"
                      : "rprobe__list-item"
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFile(r.file)}
                    className="rprobe__list-btn"
                  >
                    <div className="rprobe__list-when">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString()
                        : r.file}
                    </div>
                    <div className="rprobe__list-meta">
                      <span className="rprobe__list-counts">
                        <span className="rprobe__pill rprobe__pill--good">
                          {r.liveOk ?? "?"}
                        </span>
                        <span className="rprobe__pill rprobe__pill--ok">
                          {r.noMatchingSlot ?? "?"}
                        </span>
                        <span className="rprobe__pill rprobe__pill--warn">
                          {r.blockedOrUnknown ?? "?"}
                        </span>
                        <span className="rprobe__list-total">
                          / {r.total ?? "?"}
                        </span>
                      </span>
                      {r.recommendedCaseId && (
                        <div className="rprobe__list-rec">
                          → {r.recommendedCaseId}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <section className="rprobe__main">
          {runState.status === "loading" && (
            <p className="rprobe__muted">Loading run…</p>
          )}
          {runState.status === "error" && (
            <p className="rprobe__error">{runState.message}</p>
          )}
          {runState.status === "ready" && run && (
            <>
              <RecommendedCard run={run} copiedTag={copiedTag} onCopy={onCopy} />
              <SummaryStrip run={run} />
              <CasesTable
                cases={run.results}
                onOpen={(id) => setOpenCaseId(id)}
                openId={openCaseId}
              />
            </>
          )}
        </section>
      </section>

      {openCase && (
        <CaseDrawer
          c={openCase}
          copiedTag={copiedTag}
          onCopy={onCopy}
          onClose={() => setOpenCaseId(null)}
        />
      )}

      <ResyProbeStyles />
    </main>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function RecommendedCard({
  run,
  copiedTag,
  onCopy,
}: {
  run: ResyProbeRun;
  copiedTag: string | null;
  onCopy: (text: string, tag: string) => void;
}) {
  const rec = run.recommendedCase;
  const recCount = run.recommendedCases.length;
  if (!rec) {
    return (
      <div className="rprobe__rec rprobe__rec--none">
        <div className="rprobe__rec-row">
          <h2 className="rprobe__rec-title">No live-OK case in this run</h2>
          <span className="rprobe__rec-badge rprobe__rec-badge--none">
            no recommendation
          </span>
        </div>
        <p className="rprobe__rec-rationale">
          Every case in this run is either <code>no_matching_slot</code> or{" "}
          <code>blocked_or_unknown</code>. Don&apos;t spend a live token from
          this run; rerun the probe (slots come and go) or expand the suite.
        </p>
      </div>
    );
  }
  const cmd = buildNextLiveCommand(rec.caseId);
  const cmdTag = "rec-cmd";
  const url = parseResyProbeUrl(rec.url);
  return (
    <div className="rprobe__rec">
      <div className="rprobe__rec-row">
        <h2 className="rprobe__rec-title">Recommended next live case</h2>
        <span className="rprobe__rec-badge rprobe__rec-badge--ok">
          {rec.caseId}
        </span>
      </div>
      <p className="rprobe__rec-rationale">
        <strong>{rec.restaurantName}</strong> · {url.date ?? "?"} ·{" "}
        {rec.targetTime} · {url.covers ?? "?"} cover(s) ·{" "}
        {rec.matchingSlots.length} matching slot(s) within ±
        {rec.allowedWindowMinutes}min.
        {recCount > 1 && (
          <>
            {" "}
            <span className="rprobe__muted-sm">
              ({recCount} cases qualify; this is the top choice)
            </span>
          </>
        )}
      </p>
      <div className="rprobe__cmd">
        <code className="rprobe__cmd-text">{cmd}</code>
        <button
          type="button"
          className="rprobe__cmd-copy"
          onClick={() => onCopy(cmd, cmdTag)}
        >
          {copiedTag === cmdTag ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function SummaryStrip({ run }: { run: ResyProbeRun }) {
  const counts = useMemo(() => countByRecommendation(run.results), [run.results]);
  return (
    <div className="rprobe__summary">
      <SummaryStat label="Total cases" value={run.results.length} tone="neutral" />
      <SummaryStat
        label="Live OK"
        value={counts.use_for_live_fill_test}
        tone="good"
      />
      <SummaryStat
        label="No matching slot"
        value={counts.no_matching_slot}
        tone="ok"
      />
      <SummaryStat
        label="Blocked / unknown"
        value={counts.blocked_or_unknown}
        tone="warn"
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "good" | "ok" | "warn";
}) {
  return (
    <div className={`rprobe__stat rprobe__stat--${tone}`}>
      <div className="rprobe__stat-value">{value}</div>
      <div className="rprobe__stat-label">{label}</div>
    </div>
  );
}

function CasesTable({
  cases,
  onOpen,
  openId,
}: {
  cases: ResyProbeCase[];
  onOpen: (id: string) => void;
  openId: string | null;
}) {
  return (
    <div className="rprobe__cases-wrap">
      <table className="rprobe__cases">
        <thead>
          <tr>
            <th>Case</th>
            <th>Restaurant</th>
            <th>Date / time / covers</th>
            <th>Slots</th>
            <th>Venue match</th>
            <th>Verdict</th>
            <th aria-label="Detail" />
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <CaseRow
              key={c.caseId}
              c={c}
              onOpen={onOpen}
              isOpen={c.caseId === openId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseRow({
  c,
  onOpen,
  isOpen,
}: {
  c: ResyProbeCase;
  onOpen: (id: string) => void;
  isOpen: boolean;
}) {
  const tone = RECOMMENDATION_TONE[c.recommendation];
  const url = parseResyProbeUrl(c.url);
  const exact = isExactVenueMatch(c);
  return (
    <tr
      className={`rprobe__row rprobe__row--${tone}${
        isOpen ? " rprobe__row--open" : ""
      }`}
    >
      <td className="rprobe__cell-id">{c.caseId}</td>
      <td>{c.restaurantName}</td>
      <td className="rprobe__cell-when">
        {url.date ?? "—"} · {c.targetTime || url.time || "any"} ·{" "}
        {url.covers ?? "—"}p
      </td>
      <td className="rprobe__cell-slots">
        <strong>{c.slots.length}</strong> total /{" "}
        <strong>{c.matchingSlots.length}</strong> match
        {c.matchingSlots.length > 0 && (
          <div className="rprobe__chip-row">
            {c.matchingSlots.slice(0, 3).map((s, i) => (
              <span key={i} className="rprobe__chip">
                {s.text}
              </span>
            ))}
            {c.matchingSlots.length > 3 && (
              <span className="rprobe__chip-more">
                +{c.matchingSlots.length - 3}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="rprobe__cell-venue">
        {c.apiVenueSlug ? (
          <>
            <code>{c.apiVenueSlug}</code>
            <div
              className={
                exact
                  ? "rprobe__venue-status rprobe__venue-status--ok"
                  : "rprobe__venue-status rprobe__venue-status--warn"
              }
            >
              {exact ? "exact match" : "mismatch"}
            </div>
          </>
        ) : c.apiError ? (
          <span className="rprobe__cell-error">api error</span>
        ) : (
          <span className="rprobe__muted-sm">—</span>
        )}
      </td>
      <td>
        <span className={`rprobe__verdict rprobe__verdict--${tone}`}>
          {RECOMMENDATION_LABEL[c.recommendation]}
        </span>
      </td>
      <td className="rprobe__cell-action">
        <button
          type="button"
          className="rprobe__detail-btn"
          onClick={() => onOpen(c.caseId)}
        >
          Detail →
        </button>
      </td>
    </tr>
  );
}

function CaseDrawer({
  c,
  copiedTag,
  onCopy,
  onClose,
}: {
  c: ResyProbeCase;
  copiedTag: string | null;
  onCopy: (text: string, tag: string) => void;
  onClose: () => void;
}) {
  const tone = RECOMMENDATION_TONE[c.recommendation];
  const url = parseResyProbeUrl(c.url);
  const exact = isExactVenueMatch(c);
  const cmd = buildNextLiveCommand(c.caseId);
  const cmdTag = `drawer-cmd-${c.caseId}`;
  const safe = c.recommendation === "use_for_live_fill_test";

  return (
    <div className="rprobe__drawer-backdrop" onClick={onClose}>
      <div
        className={`rprobe__drawer rprobe__drawer--${tone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rprobe__drawer-top">
          <div>
            <h2 className="rprobe__drawer-title">
              {c.caseId} · {c.restaurantName}
            </h2>
            <p className="rprobe__drawer-sub">
              {url.date ?? "?"} · {c.targetTime} · {url.covers ?? "?"} cover(s)
              {" · ±"}
              {c.allowedWindowMinutes}min window
            </p>
          </div>
          <button
            type="button"
            className="rprobe__drawer-close"
            onClick={onClose}
            aria-label="Close detail drawer"
          >
            ×
          </button>
        </header>

        <div className={`rprobe__drawer-verdict rprobe__drawer-verdict--${tone}`}>
          <span className={`rprobe__verdict rprobe__verdict--${tone}`}>
            {RECOMMENDATION_LABEL[c.recommendation]}
          </span>
          <span className="rprobe__drawer-explain">
            {explainRecommendation(c)}
          </span>
        </div>

        <section className="rprobe__drawer-section">
          <h3>Why this case is{safe ? "" : " not"} safe for live</h3>
          <ul className="rprobe__bullets">
            <li>
              <strong>Venue slug:</strong>{" "}
              {c.apiVenueSlug ? (
                <>
                  <code>{c.apiVenueSlug}</code>
                  {exact ? (
                    <span className="rprobe__pill rprobe__pill--good">
                      exact match
                    </span>
                  ) : (
                    <span className="rprobe__pill rprobe__pill--warn">
                      mismatch with URL slug
                    </span>
                  )}
                </>
              ) : (
                <span className="rprobe__pill rprobe__pill--warn">
                  no API match
                </span>
              )}
              {c.apiError && (
                <div className="rprobe__cell-error">{c.apiError}</div>
              )}
            </li>
            <li>
              <strong>Matching slots:</strong> {c.matchingSlots.length} (within ±
              {c.allowedWindowMinutes}min of {c.targetTime})
            </li>
            <li>
              <strong>Total slots returned:</strong> {c.slots.length}
            </li>
            {c.blockerSignals.length > 0 && (
              <li>
                <strong>Blocker signals:</strong>{" "}
                {c.blockerSignals.map((s) => (
                  <span key={s} className="rprobe__pill rprobe__pill--warn">
                    ⚠ {s}
                  </span>
                ))}
              </li>
            )}
            {c.noAvailabilitySignals.length > 0 && (
              <li>
                <strong>No-availability signals:</strong>{" "}
                {c.noAvailabilitySignals.map((s) => (
                  <span key={s} className="rprobe__pill rprobe__pill--ok">
                    {s}
                  </span>
                ))}
              </li>
            )}
            <li>
              <strong>Probe source:</strong> <code>{c.probeSource}</code>
              {typeof c.apiStatus === "number" && (
                <span className="rprobe__muted-sm">
                  {" "}
                  · API HTTP {c.apiStatus}
                </span>
              )}
            </li>
          </ul>
        </section>

        {c.matchingSlots.length > 0 && (
          <SlotsSection title="Matching slots" slots={c.matchingSlots} />
        )}
        {c.matchingSlots.length === 0 && c.slots.length > 0 && (
          <SlotsSection
            title="All returned slots (none matched window)"
            slots={c.slots}
          />
        )}

        <section className="rprobe__drawer-section">
          <h3>Live command for this case</h3>
          <p className="rprobe__muted-sm">
            {safe
              ? "Safe to run — has matching slots."
              : "⚠ This case will not validate fill/OTP closure (no matching slots). Pick a `use_for_live_fill_test` case instead."}
          </p>
          <div className="rprobe__cmd">
            <code className="rprobe__cmd-text">{cmd}</code>
            <button
              type="button"
              className="rprobe__cmd-copy"
              onClick={() => onCopy(cmd, cmdTag)}
            >
              {copiedTag === cmdTag ? "Copied!" : "Copy"}
            </button>
          </div>
        </section>

        <section className="rprobe__drawer-section">
          <h3>Probe URL</h3>
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rprobe__url"
          >
            {c.url}
          </a>
        </section>

        {c.bodySnippet && (
          <section className="rprobe__drawer-section">
            <h3>Page body snippet</h3>
            <pre className="rprobe__pre">{c.bodySnippet}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

function SlotsSection({
  title,
  slots,
}: {
  title: string;
  slots: ResyProbeSlot[];
}) {
  return (
    <section className="rprobe__drawer-section">
      <h3>
        {title}{" "}
        <span className="rprobe__muted-sm">({slots.length})</span>
      </h3>
      <table className="rprobe__slots">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Δ min</th>
            <th>Date</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {slots.slice(0, 50).map((s, i) => (
            <tr key={i}>
              <td>{s.text}</td>
              <td>{s.diffMinutes}</td>
              <td>{s.dateIso ?? "—"}</td>
              <td>
                <code>{s.source}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {slots.length > 50 && (
        <p className="rprobe__muted-sm">
          (showing first 50 of {slots.length})
        </p>
      )}
    </section>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function ResyProbeStyles() {
  return (
    <style>{`
      .rprobe {
        --ink-9: #111827; --ink-7: #4b5563; --ink-6: #6b7280; --ink-3: #e5e7eb; --ink-2: #f3f4f6;
        --card: #ffffff; --bg: #fafafa;
        --good: #16a34a; --good-bg: rgba(22,163,74,0.10); --good-bd: rgba(22,163,74,0.30);
        --ok: #0ea5e9; --ok-bg: rgba(14,165,233,0.10); --ok-bd: rgba(14,165,233,0.30);
        --warn: #f59e0b; --warn-bg: rgba(245,158,11,0.12); --warn-bd: rgba(245,158,11,0.32);
        max-width: 1280px; margin: 0 auto; padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg); min-height: 100vh; color: var(--ink-9);
      }
      .rprobe__top { margin-bottom: 24px; }
      .rprobe__crumb a { color: var(--ink-6); font-size: 13px; text-decoration: none; }
      .rprobe__crumb a:hover { color: var(--ink-9); }
      .rprobe__title { margin: 8px 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
      .rprobe__sub { margin: 0; font-size: 13.5px; color: var(--ink-7); line-height: 1.55; max-width: 800px; }
      .rprobe__sub code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }

      .rprobe__layout {
        display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; margin-top: 20px;
      }
      @media (max-width: 900px) { .rprobe__layout { grid-template-columns: 1fr; } }

      .rprobe__list { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px; max-height: calc(100vh - 200px); overflow-y: auto; }
      .rprobe__h2 { margin: 0 0 10px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); }
      .rprobe__list-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .rprobe__list-item--active .rprobe__list-btn { background: var(--ok-bg); border-color: var(--ok-bd); }
      .rprobe__list-btn { width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--ink-3); border-radius: 8px; background: var(--card); cursor: pointer; transition: border-color 120ms; font: inherit; color: inherit; }
      .rprobe__list-btn:hover { border-color: var(--ok); }
      .rprobe__list-when { font-size: 12px; font-weight: 600; }
      .rprobe__list-meta { font-size: 11.5px; color: var(--ink-6); margin-top: 4px; }
      .rprobe__list-counts { display: inline-flex; gap: 4px; align-items: center; }
      .rprobe__list-total { color: var(--ink-6); font-size: 11px; }
      .rprobe__list-rec { color: var(--good); font-size: 11px; font-weight: 700; margin-top: 3px; font-family: ui-monospace, monospace; }

      .rprobe__main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

      .rprobe__rec { background: var(--card); border: 1px solid var(--good-bd); border-radius: 12px; padding: 18px 20px; }
      .rprobe__rec--none { border-color: var(--warn-bd); background: var(--warn-bg); }
      .rprobe__rec-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .rprobe__rec-title { margin: 0; font-size: 15px; font-weight: 600; }
      .rprobe__rec-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 10px; border-radius: 999px; }
      .rprobe__rec-badge--ok { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rprobe__rec-badge--none { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rprobe__rec-rationale { margin: 8px 0 12px; font-size: 13px; color: var(--ink-7); line-height: 1.55; }
      .rprobe__rec-rationale code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
      .rprobe__cmd { display: flex; align-items: stretch; gap: 0; }
      .rprobe__cmd-text { flex: 1; padding: 10px 12px; background: var(--ink-2); border: 1px solid var(--ink-3); border-right: none; border-radius: 6px 0 0 6px; font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
      .rprobe__cmd-copy { padding: 10px 14px; background: var(--ink-9); color: #fff; border: 1px solid var(--ink-9); border-radius: 0 6px 6px 0; cursor: pointer; font-size: 12px; font-weight: 600; }
      .rprobe__cmd-copy:hover { background: #000; }

      .rprobe__summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      @media (max-width: 700px) { .rprobe__summary { grid-template-columns: repeat(2, 1fr); } }
      .rprobe__stat { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 12px 14px; }
      .rprobe__stat-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
      .rprobe__stat-label { font-size: 11px; color: var(--ink-6); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
      .rprobe__stat--good .rprobe__stat-value { color: var(--good); }
      .rprobe__stat--ok .rprobe__stat-value { color: var(--ok); }
      .rprobe__stat--warn .rprobe__stat-value { color: var(--warn); }

      .rprobe__cases-wrap { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; overflow: hidden; }
      .rprobe__cases { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
      .rprobe__cases thead th { background: var(--ink-2); padding: 10px 12px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-7); border-bottom: 1px solid var(--ink-3); }
      .rprobe__cases tbody td { padding: 10px 12px; border-top: 1px solid var(--ink-2); vertical-align: top; }
      .rprobe__row--good { background: rgba(22,163,74,0.03); }
      .rprobe__row--warn { background: rgba(245,158,11,0.04); }
      .rprobe__row--open { background: var(--ink-2) !important; }
      .rprobe__cell-id { font-family: ui-monospace, monospace; font-weight: 600; }
      .rprobe__cell-when { color: var(--ink-7); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rprobe__cell-slots strong { font-weight: 600; }
      .rprobe__chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .rprobe__chip { padding: 2px 7px; border-radius: 999px; background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); font-size: 10.5px; font-weight: 600; }
      .rprobe__chip-more { padding: 2px 7px; border-radius: 999px; background: var(--ink-2); color: var(--ink-6); font-size: 10.5px; }
      .rprobe__cell-venue code { font-size: 11px; }
      .rprobe__venue-status { display: inline-block; margin-top: 3px; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; }
      .rprobe__venue-status--ok { color: var(--good); background: var(--good-bg); border: 1px solid var(--good-bd); }
      .rprobe__venue-status--warn { color: var(--warn); background: var(--warn-bg); border: 1px solid var(--warn-bd); }
      .rprobe__cell-error { color: var(--warn); font-size: 11px; }
      .rprobe__verdict { padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
      .rprobe__verdict--good { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rprobe__verdict--ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
      .rprobe__verdict--warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rprobe__cell-action { text-align: right; white-space: nowrap; }
      .rprobe__detail-btn { padding: 4px 10px; font-size: 11px; font-weight: 600; border: 1px solid var(--ink-3); border-radius: 6px; background: var(--card); cursor: pointer; color: var(--ink-9); }
      .rprobe__detail-btn:hover { border-color: var(--ink-7); background: var(--ink-2); }

      .rprobe__pill { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; margin: 0 3px; vertical-align: baseline; }
      .rprobe__pill--good { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rprobe__pill--ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
      .rprobe__pill--warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }

      .rprobe__muted { color: var(--ink-6); font-size: 13px; }
      .rprobe__muted-sm { color: var(--ink-6); font-size: 11.5px; }
      .rprobe__error { color: var(--warn); font-size: 13px; }
      .rprobe__retry { margin-left: 8px; padding: 2px 10px; font-size: 11px; border: 1px solid var(--ink-3); border-radius: 4px; background: var(--card); cursor: pointer; }
      .rprobe__empty { text-align: center; padding: 18px 6px; color: var(--ink-6); font-size: 13px; }
      .rprobe__empty code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; }
      .rprobe__empty p { margin: 6px 0; }

      /* Drawer */
      .rprobe__drawer-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.40); display: flex; align-items: stretch; justify-content: flex-end;
        z-index: 50; backdrop-filter: blur(2px);
      }
      .rprobe__drawer {
        background: var(--card); width: min(620px, 92vw); max-height: 100vh; overflow-y: auto;
        padding: 24px 28px 60px; border-left: 4px solid var(--ink-3);
        animation: rprobe-slide 160ms ease-out;
      }
      .rprobe__drawer--good { border-left-color: var(--good); }
      .rprobe__drawer--ok { border-left-color: var(--ok); }
      .rprobe__drawer--warn { border-left-color: var(--warn); }
      @keyframes rprobe-slide { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

      .rprobe__drawer-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
      .rprobe__drawer-title { margin: 0; font-size: 17px; font-weight: 700; }
      .rprobe__drawer-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--ink-7); }
      .rprobe__drawer-close { font-size: 24px; line-height: 1; padding: 0 6px; border: none; background: none; cursor: pointer; color: var(--ink-6); }
      .rprobe__drawer-close:hover { color: var(--ink-9); }

      .rprobe__drawer-verdict { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; flex-wrap: wrap; }
      .rprobe__drawer-verdict--good { background: var(--good-bg); }
      .rprobe__drawer-verdict--ok { background: var(--ok-bg); }
      .rprobe__drawer-verdict--warn { background: var(--warn-bg); }
      .rprobe__drawer-explain { font-size: 13px; color: var(--ink-9); flex: 1; min-width: 0; }

      .rprobe__drawer-section { margin: 16px 0; }
      .rprobe__drawer-section h3 { margin: 0 0 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-7); }
      .rprobe__bullets { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.7; }
      .rprobe__bullets li { margin-bottom: 4px; }
      .rprobe__bullets code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; margin: 0 4px; }
      .rprobe__url { font-size: 11.5px; color: var(--ok); word-break: break-all; font-family: ui-monospace, monospace; }
      .rprobe__pre { background: var(--ink-2); border: 1px solid var(--ink-3); border-radius: 6px; padding: 10px; font-size: 11.5px; max-height: 200px; overflow: auto; white-space: pre-wrap; word-break: break-word; }

      .rprobe__slots { width: 100%; border-collapse: collapse; font-size: 12px; }
      .rprobe__slots thead th { text-align: left; padding: 6px 8px; background: var(--ink-2); font-size: 10.5px; text-transform: uppercase; color: var(--ink-7); border-bottom: 1px solid var(--ink-3); }
      .rprobe__slots tbody td { padding: 6px 8px; border-top: 1px solid var(--ink-2); }
      .rprobe__slots code { font-size: 10.5px; }
    `}</style>
  );
}
