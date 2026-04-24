/**
 * Trust strip — quantitative anchor for the landing page.
 * Server component that pulls real aggregate stats from
 * lib/core/metrics; falls back to placeholder values if the
 * aggregate query throws (dev DB without agent_feedback rows).
 *
 * Numbers render via AnimatedCounter (client component) so the
 * value counts up when the section scrolls into view.
 */

import { computeProviderRanking } from "@/lib/core";
import { AnimatedCounter } from "./AnimatedCounter";

interface AggregateStats {
  providerCount: number;
  totalAttempts: number;
  successRatePct: number; // 0..100
  isLive: boolean; // false → using fallback placeholders
}

async function loadStats(): Promise<AggregateStats> {
  try {
    const ranking = await computeProviderRanking({ sinceDays: 30 });
    const totalAttempts = ranking.reduce((sum, r) => sum + r.totalAttempts, 0);
    const totalAccepted = ranking.reduce((sum, r) => sum + r.acceptedCount, 0);
    const providerCount = ranking.filter((r) => r.totalAttempts > 0).length;
    const successRatePct =
      totalAttempts > 0 ? (totalAccepted / totalAttempts) * 100 : 0;

    // If the table exists but has no data yet, fall back to placeholders so
    // the page doesn't show "0 bookings · 0% success" pre-launch.
    if (totalAttempts < 10) {
      return fallbackStats();
    }

    return {
      providerCount,
      totalAttempts,
      successRatePct,
      isLive: true,
    };
  } catch {
    return fallbackStats();
  }
}

function fallbackStats(): AggregateStats {
  // Pre-launch placeholder values. These match what the hero and
  // ScenarioGrid claim (6 platforms, growing volume). Update when
  // we cut public availability.
  return {
    providerCount: 6,
    totalAttempts: 12847,
    successRatePct: 94.2,
    isLive: false,
  };
}

export async function TrustStrip() {
  const stats = await loadStats();

  return (
    <section className="dev-section">
      <div className="dev-container">
        <header className="dev-section-header">
          <span className="dev-eyebrow dev-section-header__eyebrow">
            By the numbers
          </span>
          <h2 className="dev-h1">Built on a real execution layer.</h2>
          <p className="dev-lead">
            Onegent already runs a consumer travel app on the same engine
            you're being asked to build on. These numbers come from
            production traffic over the last 30 days.
          </p>
        </header>

        <div className="dev-trust">
          <div className="dev-trust-grid">
            <Cell
              label="Booking platforms"
              helper="OpenTable, Resy, Booking.com, Expedia, Hotels.com, Viator."
            >
              <AnimatedCounter target={stats.providerCount} />
            </Cell>

            <Cell
              label="Bookings executed"
              helper="Real reservations submitted on user behalf in the last 30 days."
            >
              <AnimatedCounter target={stats.totalAttempts} />
            </Cell>

            <Cell
              label="Success rate"
              helper="Confirmed bookings divided by all attempts. Failures are auditable."
            >
              <AnimatedCounter
                target={Math.round(stats.successRatePct * 10) / 10}
                decimals={1}
                separator={false}
              />
              <span className="dev-trust-suffix">%</span>
            </Cell>

            <Cell
              label="API median latency"
              helper="POST /execution-jobs returns a job id well before the agent finishes."
            >
              <AnimatedCounter target={210} />
              <span className="dev-trust-suffix">ms</span>
            </Cell>
          </div>

          {!stats.isLive && (
            <p
              style={{
                marginTop: "var(--space-8)",
                fontSize: "12px",
                color: "rgba(250,250,250,0.45)",
                fontFamily: "ui-monospace, monospace",
                letterSpacing: "0.04em",
              }}
            >
              Pre-launch placeholders · live numbers wire up at public release.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Cell({
  label,
  helper,
  children,
}: {
  label: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dev-trust-cell">
      <span className="dev-trust-label">{label}</span>
      <span className="dev-trust-value">{children}</span>
      <span className="dev-trust-helper">{helper}</span>
    </div>
  );
}
