"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type Range = "week" | "month" | "all";

type KpiCards = {
  tasksDone: number;
  rooms: number;
  searches: number;
  optionsCompared: number;
  prefsLearned: number;
  votes: number;
  hoursSaved: number;
};

type TimeseriesPoint = { bucket: string; count: number };
type ScenarioSlice = { scenario: string; count: number };
type ActivityItem = {
  kind: "task" | "room" | "search" | "vote" | "pref";
  label: string;
  detail: string;
  scenario: string | null;
  at: string;
};

type AnalyticsResponse = {
  range: Range;
  cards: KpiCards;
  timeseries: TimeseriesPoint[];
  scenarios: ScenarioSlice[];
  activity: ActivityItem[];
};

const GOLD = "#C9A84C";
const SCENARIO_COLORS = ["#C9A84C", "#E5C972", "#A8894F", "#6E5B38", "#8F7A4E", "#4B3F2A"];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}

function kindGlyph(kind: ActivityItem["kind"]): string {
  if (kind === "task") return "✓";
  if (kind === "room") return "◉";
  if (kind === "search") return "⌕";
  if (kind === "vote") return "▲";
  return "★";
}

function kindLink(item: ActivityItem): string | null {
  if (item.kind === "task") return "/tasks";
  if (item.kind === "room") return "/rooms";
  if (item.kind === "vote") return "/rooms";
  return null;
}

function KpiCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div
      style={{
        borderRadius: 18,
        border: "0.5px solid rgba(201,168,76,0.18)",
        background: "linear-gradient(180deg, rgba(40,36,31,0.96) 0%, rgba(27,24,21,0.98) 100%)",
        padding: 18,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 10,
        cursor: href ? "pointer" : "default",
        transition: "border-color 180ms ease",
      }}
      onMouseEnter={(e) => {
        if (href) e.currentTarget.style.borderColor = "rgba(201,168,76,0.45)";
      }}
      onMouseLeave={(e) => {
        if (href) e.currentTarget.style.borderColor = "rgba(201,168,76,0.18)";
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "rgba(244,231,200,0.5)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 32,
          fontWeight: 700,
          color: GOLD,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(244,231,200,0.62)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}

function RangeSwitch({
  range,
  setRange,
}: {
  range: Range;
  setRange: (r: Range) => void;
}) {
  const options: Array<{ id: Range; label: string }> = [
    { id: "week", label: "This week" },
    { id: "month", label: "This month" },
    { id: "all", label: "All time" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        border: "0.5px solid rgba(201,168,76,0.18)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      {options.map((opt) => {
        const active = opt.id === range;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setRange(opt.id)}
            style={{
              border: "none",
              background: active ? "rgba(201,168,76,0.16)" : "transparent",
              color: active ? GOLD : "rgba(244,231,200,0.62)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-dm-sans)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: "rgba(244,231,200,0.5)",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function panelStyle(): React.CSSProperties {
  return {
    borderRadius: 22,
    border: "0.5px solid rgba(201,168,76,0.18)",
    background: "linear-gradient(180deg, rgba(40,36,31,0.96) 0%, rgba(27,24,21,0.98) 100%)",
    boxShadow: "0 20px 48px rgba(0,0,0,0.16)",
    padding: 22,
  };
}

export default function DashboardTab() {
  const [range, setRange] = useState<Range>("month");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/analytics?range=${range}`);
        const payload = (await res.json()) as AnalyticsResponse & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "Failed to load analytics");
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totalActivity = useMemo(() => {
    if (!data) return 0;
    const c = data.cards;
    return c.tasksDone + c.rooms + c.searches + c.votes + c.prefsLearned;
  }, [data]);

  const isEmpty = !loading && !error && data && totalActivity === 0;

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.timeseries.map((p) => ({ date: formatDate(p.bucket), count: p.count }));
  }, [data]);

  const pieData = useMemo(() => {
    if (!data) return [];
    return data.scenarios.slice(0, 6).map((s) => ({ name: s.scenario, value: s.count }));
  }, [data]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 14,
            color: "rgba(244,231,200,0.72)",
            maxWidth: 620,
            lineHeight: 1.6,
          }}
        >
          A quick look at what your agent has been doing for you.
        </div>
        <RangeSwitch range={range} setRange={setRange} />
      </div>

      {loading && (
        <div style={{ ...panelStyle(), textAlign: "center", color: "rgba(244,231,200,0.6)" }}>
          Loading your dashboard…
        </div>
      )}

      {!loading && error && (
        <div style={{ ...panelStyle(), textAlign: "center", color: "#E89A8A" }}>{error}</div>
      )}

      {isEmpty && (
        <div
          style={{
            ...panelStyle(),
            textAlign: "center",
            padding: 40,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-playfair, serif)",
              fontSize: 22,
              fontWeight: 700,
              color: "#F8F2E7",
              marginBottom: 10,
            }}
          >
            Your agent has not started yet.
          </div>
          <div
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 14,
              color: "rgba(244,231,200,0.62)",
              marginBottom: 18,
            }}
          >
            Try creating your first task or decision room.
          </div>
          <Link
            href="/rooms/new"
            style={{
              display: "inline-block",
              background: GOLD,
              color: "#1B1712",
              padding: "10px 18px",
              borderRadius: 12,
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Create a decision room →
          </Link>
        </div>
      )}

      {!loading && !error && data && totalActivity > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <KpiCard
              label="Agent compared"
              value={String(data.cards.optionsCompared)}
              hint={`Options across searches and proposals. Roughly ${data.cards.hoursSaved}h of manual browsing saved.`}
            />
            <KpiCard
              label="Tasks delivered"
              value={String(data.cards.tasksDone)}
              hint="Booking jobs and completed rooms."
              href="/tasks"
            />
            <KpiCard
              label="Decision rooms"
              value={String(data.cards.rooms)}
              hint="Rooms you created or joined."
              href="/rooms"
            />
            <KpiCard
              label="Searches"
              value={String(data.cards.searches)}
              hint="Individual plans the agent ran."
            />
            <KpiCard
              label="New preferences learned"
              value={String(data.cards.prefsLearned)}
              hint="Signals the agent inferred from your actions."
              href="/insights?tab=evidence"
            />
            <KpiCard
              label="Votes cast"
              value={String(data.cards.votes)}
              hint="Picks you made inside decision rooms."
              href="/rooms"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
              gap: 18,
            }}
          >
            <div style={panelStyle()}>
              <PanelTitle>Activity over time</PanelTitle>
              {chartData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={GOLD} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "rgba(244,231,200,0.55)", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(201,168,76,0.14)" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "rgba(244,231,200,0.55)", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(201,168,76,0.14)" }}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#1B1712",
                          border: "0.5px solid rgba(201,168,76,0.25)",
                          borderRadius: 10,
                          color: "#F8F2E7",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "rgba(244,231,200,0.7)" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke={GOLD}
                        strokeWidth={2}
                        fill="url(#goldGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ color: "rgba(244,231,200,0.55)", fontSize: 13 }}>
                  No activity points in this range.
                </div>
              )}
            </div>

            <div style={panelStyle()}>
              <PanelTitle>Scenarios</PanelTitle>
              {pieData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={86}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={entry.name} fill={SCENARIO_COLORS[i % SCENARIO_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "#1B1712",
                          border: "0.5px solid rgba(201,168,76,0.25)",
                          borderRadius: 10,
                          color: "#F8F2E7",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        wrapperStyle={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 11,
                          color: "rgba(244,231,200,0.72)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ color: "rgba(244,231,200,0.55)", fontSize: 13 }}>
                  No scenarios yet.
                </div>
              )}
            </div>
          </div>

          <div style={panelStyle()}>
            <PanelTitle>Recent activity</PanelTitle>
            {data.activity.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {data.activity.map((item, i) => {
                  const href = kindLink(item);
                  const content = (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "28px 1fr auto",
                        gap: 12,
                        alignItems: "center",
                        borderRadius: 12,
                        border: "0.5px solid rgba(201,168,76,0.12)",
                        background: "rgba(255,255,255,0.02)",
                        padding: "10px 14px",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          background: "rgba(201,168,76,0.14)",
                          color: GOLD,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                      >
                        {kindGlyph(item.kind)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#F8F2E7",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.label}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 11,
                            color: "rgba(244,231,200,0.55)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.detail}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 11,
                          color: "rgba(244,231,200,0.5)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatRelative(item.at)}
                      </div>
                    </div>
                  );
                  return href ? (
                    <Link
                      key={`${item.kind}-${item.at}-${i}`}
                      href={href}
                      style={{ textDecoration: "none" }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={`${item.kind}-${item.at}-${i}`}>{content}</div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: "rgba(244,231,200,0.55)", fontSize: 13 }}>
                No recent activity in this range.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
