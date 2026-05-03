"use client";

/**
 * BucketDistribution — horizontal stacked bar showing the 8 outcome
 * buckets, plus a per-bucket count grid below.
 *
 * Click a bucket cell to filter the case table to just that bucket.
 *
 * Reads `result.outcome` per case (codex's contract). Buckets are
 * always rendered in the same order so the bar layout is stable
 * across runs.
 */

import {
  BUCKET_LABEL,
  BUCKET_TONE,
  OUTCOME_BUCKET_ORDER,
  type Phase0BenchmarkCaseResult,
  type Phase0OutcomeBucket,
} from "./types";

interface Props {
  cases: readonly Phase0BenchmarkCaseResult[];
  activeBucket: Phase0OutcomeBucket | null;
  onBucketClick: (bucket: Phase0OutcomeBucket | null) => void;
}

export default function BucketDistribution({
  cases,
  activeBucket,
  onBucketClick,
}: Props) {
  const counts = countByBucket(cases);
  const total = Math.max(cases.length, 1);

  return (
    <section className="benchmark-bucket" aria-label="Outcome distribution">
      <div className="benchmark-bucket__head">
        <h3 className="benchmark-bucket__title">Outcome distribution</h3>
        {activeBucket && (
          <button
            type="button"
            className="benchmark-bucket__clear"
            onClick={() => onBucketClick(null)}
          >
            Clear filter ({BUCKET_LABEL[activeBucket]})
          </button>
        )}
      </div>

      {/* Stacked bar */}
      <div
        className="benchmark-bucket__bar"
        role="img"
        aria-label="Stacked bucket bar"
      >
        {OUTCOME_BUCKET_ORDER.map((b) => {
          const count = counts[b];
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <button
              key={b}
              type="button"
              className={[
                "benchmark-bucket__segment",
                `benchmark-bucket__segment--${BUCKET_TONE[b]}`,
                activeBucket === b ? "benchmark-bucket__segment--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ width: `${pct}%` }}
              onClick={() => onBucketClick(activeBucket === b ? null : b)}
              title={`${BUCKET_LABEL[b]}: ${count} (${pct.toFixed(1)}%)`}
              aria-label={`${BUCKET_LABEL[b]}: ${count} cases, ${pct.toFixed(1)} percent`}
            >
              {pct >= 8 ? `${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Per-bucket grid */}
      <ul className="benchmark-bucket__grid">
        {OUTCOME_BUCKET_ORDER.map((b) => {
          const count = counts[b];
          const pct = (count / total) * 100;
          const isActive = activeBucket === b;
          return (
            <li key={b}>
              <button
                type="button"
                onClick={() => onBucketClick(isActive ? null : b)}
                className={[
                  "benchmark-bucket__cell",
                  `benchmark-bucket__cell--${BUCKET_TONE[b]}`,
                  isActive ? "benchmark-bucket__cell--active" : "",
                  count === 0 ? "benchmark-bucket__cell--empty" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={count === 0}
              >
                <span className="benchmark-bucket__cell-dot" aria-hidden />
                <span className="benchmark-bucket__cell-label">
                  {BUCKET_LABEL[b]}
                </span>
                <span className="benchmark-bucket__cell-count">{count}</span>
                <span className="benchmark-bucket__cell-pct">
                  {pct.toFixed(0)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─── Helper ─────────────────────────────────────────────────────────── */

function countByBucket(
  cases: readonly Phase0BenchmarkCaseResult[],
): Record<Phase0OutcomeBucket, number> {
  const out = {} as Record<Phase0OutcomeBucket, number>;
  for (const b of OUTCOME_BUCKET_ORDER) out[b] = 0;
  for (const c of cases) out[c.outcome] += 1;
  return out;
}
