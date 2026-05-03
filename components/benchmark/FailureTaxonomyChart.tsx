"use client";

/**
 * FailureTaxonomyChart — vertical list of taxonomy codes with a
 * horizontal bar each, sorted by count (descending). Empty rows hidden.
 *
 * Click a row to filter the case table to just that taxonomy code.
 *
 * Per `PHASE0_REPORT_CONTRACT.md`:
 *   - Use `result.taxonomyCode` for grouping
 *   - Cases without a code render under `uncategorized`
 *
 * Severe codes (`F-LOGIC-WRONG-*`) are visually distinct — these are the
 * disqualifying ones for Phase 0.
 */

import {
  TAXONOMY_LABEL,
  UNCATEGORIZED_TAXONOMY,
  groupByTaxonomy,
  isSevereTaxonomy,
  type Phase0BenchmarkCaseResult,
} from "./types";

interface Props {
  cases: readonly Phase0BenchmarkCaseResult[];
  /** null = no filter; "uncategorized" = uncategorized filter. */
  activeTaxonomy: string | null;
  onTaxonomyClick: (code: string | null) => void;
}

export default function FailureTaxonomyChart({
  cases,
  activeTaxonomy,
  onTaxonomyClick,
}: Props) {
  const grouped = groupByTaxonomy(cases);
  const ranked = Object.entries(grouped)
    .map(([code, list]) => ({ code, count: list.length }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const max = Math.max(1, ...ranked.map((r) => r.count));
  const totalGrouped = ranked.reduce((s, r) => s + r.count, 0);

  return (
    <section className="benchmark-failures" aria-label="Failure taxonomy">
      <div className="benchmark-failures__head">
        <h3 className="benchmark-failures__title">Taxonomy distribution</h3>
        <span className="benchmark-failures__count">
          {totalGrouped === 0
            ? "No cases recorded"
            : `${totalGrouped} cases across ${ranked.length} ${
                ranked.length === 1 ? "code" : "codes"
              }`}
        </span>
        {activeTaxonomy && (
          <button
            type="button"
            className="benchmark-failures__clear"
            onClick={() => onTaxonomyClick(null)}
          >
            Clear filter ({activeTaxonomy})
          </button>
        )}
      </div>

      {ranked.length === 0 ? (
        <p className="benchmark-failures__empty">
          No cases recorded for this run.
        </p>
      ) : (
        <ul className="benchmark-failures__list">
          {ranked.map(({ code, count }) => {
            const severe = isSevereTaxonomy(code);
            const widthPct = (count / max) * 100;
            const isActive = activeTaxonomy === code;
            const label =
              code === UNCATEGORIZED_TAXONOMY
                ? TAXONOMY_LABEL[UNCATEGORIZED_TAXONOMY]
                : TAXONOMY_LABEL[code] ?? code;

            return (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => onTaxonomyClick(isActive ? null : code)}
                  className={[
                    "benchmark-failures__row",
                    severe ? "benchmark-failures__row--severe" : "",
                    isActive ? "benchmark-failures__row--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={`${label} (${code}): ${count} cases`}
                >
                  <span className="benchmark-failures__row-tag">{code}</span>
                  <span className="benchmark-failures__row-label">{label}</span>
                  <span className="benchmark-failures__row-bar-track">
                    <span
                      className={[
                        "benchmark-failures__row-bar",
                        severe ? "benchmark-failures__row-bar--severe" : "",
                      ].join(" ")}
                      style={{ width: `${widthPct}%` }}
                    />
                  </span>
                  <span className="benchmark-failures__row-count">{count}</span>
                  {severe && (
                    <span
                      className="benchmark-failures__severe-flag"
                      title="Severe — counts toward severe_error_rate"
                    >
                      ⚠
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
