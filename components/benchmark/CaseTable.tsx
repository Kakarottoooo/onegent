"use client";

/**
 * CaseTable — filterable list of every case in a benchmark run.
 *
 * Click a row to open the detail drawer.
 * Filters owned by the parent (page-level state) so the URL can be
 * deep-linked later.
 *
 * Reads codex's case shape: `caseId`, `prompt`, `outcome`, `taxonomyCode`,
 * `state`, `terminalCode`, `terminalReason`, `durationMs`,
 * `expectedOutcomeMatched`, `taxonomyAccepted`.
 */

import {
  BUCKET_LABEL,
  BUCKET_TONE,
  UNCATEGORIZED_TAXONOMY,
  formatDuration,
  type Phase0BenchmarkCaseResult,
  type Phase0OutcomeBucket,
} from "./types";

interface Props {
  cases: readonly Phase0BenchmarkCaseResult[];
  activeBucket: Phase0OutcomeBucket | null;
  activeTaxonomy: string | null;
  searchText: string;
  onCaseClick: (c: Phase0BenchmarkCaseResult) => void;
  selectedCaseId: string | null;
}

export default function CaseTable({
  cases,
  activeBucket,
  activeTaxonomy,
  searchText,
  onCaseClick,
  selectedCaseId,
}: Props) {
  const filtered = applyFilters(cases, {
    bucket: activeBucket,
    taxonomy: activeTaxonomy,
    search: searchText,
  });

  if (filtered.length === 0) {
    return (
      <section className="benchmark-table" aria-label="Cases">
        <p className="benchmark-table__empty">
          No cases match the current filters. Clear filters to see everything.
        </p>
      </section>
    );
  }

  return (
    <section className="benchmark-table" aria-label="Cases">
      <header className="benchmark-table__head">
        <h3 className="benchmark-table__title">
          Cases ({filtered.length}
          {filtered.length !== cases.length ? ` of ${cases.length}` : ""})
        </h3>
      </header>

      <div className="benchmark-table__scroll">
        <table className="benchmark-table__grid">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Prompt</th>
              <th scope="col">Outcome</th>
              <th scope="col">Taxonomy</th>
              <th scope="col">Match</th>
              <th scope="col">Duration</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const isSelected = selectedCaseId === c.caseId;
              const taxonomyDisplay = c.taxonomyCode ?? UNCATEGORIZED_TAXONOMY;
              return (
                <tr
                  key={c.caseId}
                  className={[
                    "benchmark-table__row",
                    isSelected ? "benchmark-table__row--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onCaseClick(c)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCaseClick(c);
                    }
                  }}
                >
                  <td className="benchmark-table__cell-id">{c.caseId}</td>
                  <td className="benchmark-table__cell-prompt" title={c.prompt}>
                    {c.prompt}
                  </td>
                  <td>
                    <span
                      className={[
                        "benchmark-table__bucket",
                        `benchmark-table__bucket--${BUCKET_TONE[c.outcome]}`,
                      ].join(" ")}
                    >
                      {BUCKET_LABEL[c.outcome]}
                    </span>
                  </td>
                  <td className="benchmark-table__cell-taxonomy">
                    {taxonomyDisplay === UNCATEGORIZED_TAXONOMY ? (
                      <span className="benchmark-table__muted">—</span>
                    ) : (
                      taxonomyDisplay
                    )}
                  </td>
                  <td className="benchmark-table__cell-match">
                    <MatchBadge
                      expectedMatched={c.expectedOutcomeMatched}
                      taxonomyAccepted={c.taxonomyAccepted}
                    />
                  </td>
                  <td>{formatDuration(c.durationMs)}</td>
                  <td className="benchmark-table__cell-state">
                    {c.state ?? <span className="benchmark-table__muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ─── Match badge ────────────────────────────────────────────────────── */

function MatchBadge({
  expectedMatched,
  taxonomyAccepted,
}: {
  expectedMatched: boolean;
  taxonomyAccepted: boolean;
}) {
  if (expectedMatched && taxonomyAccepted) {
    return (
      <span
        className="benchmark-table__match benchmark-table__match--good"
        title="Outcome matched expected and taxonomy accepted"
      >
        ✓ match
      </span>
    );
  }
  if (expectedMatched) {
    return (
      <span
        className="benchmark-table__match benchmark-table__match--ok"
        title="Outcome matched expected; taxonomy not in acceptable set"
      >
        ◐ partial
      </span>
    );
  }
  if (taxonomyAccepted) {
    return (
      <span
        className="benchmark-table__match benchmark-table__match--warn"
        title="Outcome differs from expected, but taxonomy in acceptable set"
      >
        ◯ accepted
      </span>
    );
  }
  return (
    <span
      className="benchmark-table__match benchmark-table__match--bad"
      title="Neither outcome nor taxonomy matched expectations"
    >
      ✗ miss
    </span>
  );
}

/* ─── Pure helper ──────────────────────────────────────────────────── */

interface Filters {
  bucket: Phase0OutcomeBucket | null;
  taxonomy: string | null;
  search: string;
}

export function applyFilters(
  cases: readonly Phase0BenchmarkCaseResult[],
  f: Filters,
): Phase0BenchmarkCaseResult[] {
  const search = f.search.trim().toLowerCase();
  return cases.filter((c) => {
    if (f.bucket && c.outcome !== f.bucket) return false;
    if (f.taxonomy) {
      const code = c.taxonomyCode ?? UNCATEGORIZED_TAXONOMY;
      if (code !== f.taxonomy) return false;
    }
    if (search) {
      const hay = `${c.caseId} ${c.prompt} ${c.taxonomyCode ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
