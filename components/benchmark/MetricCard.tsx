"use client";

/**
 * MetricCard — one of the four rate cards on the benchmark dashboard.
 *
 * Renders the rate (e.g. "Booking-ready rate"), the underlying count
 * (e.g. "2 / 4 cases"), and a tone hint based on whether higher is
 * better for this metric. We do NOT label cards as PASS/FAIL —
 * per `PHASE0_REPORT_CONTRACT.md`, `metrics.passed` is the single
 * gate decision and only the runner can compute it. The big PASS/FAIL
 * pill at the top of the page comes from that boolean.
 */

interface Props {
  label: string;
  /** 0..1 — rendered as a percent. */
  rate: number;
  /** "2 of 4" / "0 of 25" — underlying count. */
  countLabel: string;
  /**
   * Direction the rate should move for this metric:
   *   - "up"   → higher is better (booking-ready, safe-outcome, taxonomy)
   *   - "down" → lower is better (severe-error)
   * Affects color shading only; never claims pass/fail.
   */
  direction: "up" | "down";
  /** Optional helper line under the count (e.g. "of 2 needed"). */
  helper?: string;
}

export default function MetricCard({
  label,
  rate,
  countLabel,
  direction,
  helper,
}: Props) {
  const tone = inferTone(rate, direction);

  return (
    <div
      className={["benchmark-metric", `benchmark-metric--${tone}`].join(" ")}
      data-testid={`benchmark-metric-${label}`}
    >
      <p className="benchmark-metric__label">{label}</p>
      <p className="benchmark-metric__value">{formatPercent(rate)}</p>
      <p className="benchmark-metric__count">{countLabel}</p>
      {helper && <p className="benchmark-metric__helper">{helper}</p>}
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

/** Tone mapping is presentational only — never claims pass/fail. */
function inferTone(
  rate: number,
  direction: "up" | "down",
): "good" | "ok" | "warn" | "bad" {
  if (!Number.isFinite(rate)) return "warn";
  // Normalize rate so 1.0 always means "ideal" regardless of direction.
  const idealCloseness = direction === "up" ? rate : 1 - rate;
  if (idealCloseness >= 0.95) return "good";
  if (idealCloseness >= 0.8) return "ok";
  if (idealCloseness >= 0.5) return "warn";
  return "bad";
}

function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const pct = v * 100;
  if (pct === 0) return "0%";
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}
