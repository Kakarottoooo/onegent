"use client";

import { useState, useEffect, useCallback } from "react";
import GlobalNav from "@/components/GlobalNav";
import { useLanguage } from "@/app/hooks/useLanguage";
import type { BookingMonitor } from "@/lib/monitors";

function getSessionId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("session_id", id); }
  return id;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Monitor card ───────────────────────────────────────────────────────────

interface MonitorCardProps {
  monitor: BookingMonitor;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  typeMeta: Record<string, { emoji: string; label: string; desc: string }>;
  statusMeta: Record<string, { color: string; dot: string; label: string }>;
  t: { lastChecked: string; nextCheck: string; stopWatching: string; alertLabel: string };
}

function MonitorCard({ monitor, onCancel, onDelete, typeMeta, statusMeta, t }: MonitorCardProps) {
  const type   = typeMeta[monitor.type] ?? typeMeta.availability_watch;
  const status = statusMeta[monitor.status] ?? statusMeta.active;
  const isLive  = monitor.status === "active";
  const isAlert = monitor.status === "triggered";

  return (
    <div style={{
      borderRadius: 14,
      border: `0.5px solid ${isAlert ? "rgba(239,68,68,0.4)" : isLive ? "rgba(201,168,76,0.25)" : "var(--border, #e5e7eb)"}`,
      backgroundColor: isAlert ? "rgba(239,68,68,0.04)" : "var(--card, #fff)",
      padding: "14px 16px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{type.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13,
              color: "var(--text-primary, #111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {monitor.step_emoji} {monitor.step_label}
            </p>
            <span style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 10, fontWeight: 600, color: status.color, flexShrink: 0,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", backgroundColor: status.dot, flexShrink: 0,
                ...(isLive ? { animation: "navpulse 2s ease-in-out infinite" } : {}),
              }} />
              {status.label}
            </span>
          </div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
            {type.desc}
          </p>
        </div>
      </div>

      {/* Trigger alert */}
      {isAlert && monitor.trigger_message && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          backgroundColor: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.2)",
        }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
            fontWeight: 600, color: "#ef4444", marginBottom: 2 }}>{t.alertLabel}</p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
            {monitor.trigger_message}
          </p>
        </div>
      )}

      {/* Timestamps */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
        <div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
            color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
            {t.lastChecked}
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
            {timeAgo(monitor.last_checked_at)}
          </p>
        </div>
        <div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
            color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
            {t.nextCheck}
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
            {monitor.next_check_at ? timeAgo(monitor.next_check_at).replace("ago", "from now") : "—"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {isLive && (
          <button
            onClick={() => onCancel(monitor.id)}
            style={{
              fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)",
              background: "none", border: "0.5px solid var(--border, #e5e7eb)",
              borderRadius: 6, padding: "3px 10px", cursor: "pointer",
            }}
          >
            {t.stopWatching}
          </button>
        )}
        <button
          onClick={() => onDelete(monitor.id)}
          style={{
            fontFamily: "var(--font-dm-sans)", fontSize: 11,
            color: "rgba(220,38,38,0.65)",
            background: "none", border: "0.5px solid var(--border, #e5e7eb)",
            borderRadius: 6, padding: "3px 10px", cursor: "pointer",
          }}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

interface JobGroup { tripLabel: string; jobId: string; monitors: BookingMonitor[] }

export default function MonitoringPage() {
  const [groups, setGroups] = useState<JobGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);
  const { t } = useLanguage();
  const tm = t.monitoring;

  const typeMeta = {
    availability_watch: { emoji: "🔍", label: tm.typeAvailabilityLabel, desc: tm.typeAvailabilityDesc },
    reservation_check:  { emoji: "🔗", label: tm.typeReservationLabel,  desc: tm.typeReservationDesc },
    weather_alert:      { emoji: "🌦",  label: tm.typeWeatherLabel,      desc: tm.typeWeatherDesc },
  };

  const statusMeta = {
    active:    { color: "var(--gold, #C9A84C)",    dot: "#C9A84C", label: tm.statusActive },
    triggered: { color: "#ef4444",                 dot: "#ef4444", label: tm.statusTriggered },
    paused:    { color: "var(--text-muted, #aaa)", dot: "#aaa",    label: tm.statusPaused },
    cancelled: { color: "var(--text-muted, #aaa)", dot: "#666",    label: tm.statusCancelled },
    resolved:  { color: "#22c55e",                 dot: "#22c55e", label: tm.statusResolved },
  };

  const load = useCallback(async () => {
    const sid = getSessionId();
    if (!sid) { setLoading(false); return; }

    const [monRes, jobRes] = await Promise.allSettled([
      fetch(`/api/monitors?session_id=${encodeURIComponent(sid)}`).then((r) => r.json()),
      fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`).then((r) => r.json()),
    ]);

    const monitors: BookingMonitor[] = (monRes.status === "fulfilled" ? monRes.value?.monitors : null) ?? [];
    const jobs: { id: string; trip_label: string }[] = (jobRes.status === "fulfilled" ? jobRes.value?.jobs : null) ?? [];

    const map = new Map<string, JobGroup>();
    for (const m of monitors) {
      if (!map.has(m.job_id)) {
        const job = jobs.find((j) => j.id === m.job_id);
        map.set(m.job_id, { jobId: m.job_id, tripLabel: job?.trip_label ?? "Trip", monitors: [] });
      }
      map.get(m.job_id)!.monitors.push(m);
    }
    setGroups([...map.values()]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleClearAll() {
    const sid = getSessionId();
    if (!sid || clearingAll) return;
    if (!confirm(`Delete all ${total} monitors?`)) return;
    setClearingAll(true);
    try {
      await fetch(`/api/monitors?session_id=${encodeURIComponent(sid)}`, { method: "DELETE" });
      setGroups([]);
    } finally {
      setClearingAll(false);
    }
  }

  async function cancelMonitor(id: string) {
    await fetch(`/api/monitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    }).catch(() => {});
    load();
  }

  async function deleteMonitor(id: string) {
    await fetch(`/api/monitors/${id}`, { method: "DELETE" }).catch(() => {});
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, monitors: g.monitors.filter((m) => m.id !== id) }))
        .filter((g) => g.monitors.length > 0)
    );
  }

  const total  = groups.reduce((n, g) => n + g.monitors.length, 0);
  const active = groups.reduce((n, g) => n + g.monitors.filter((m) => m.status === "active").length, 0);
  const alerts = groups.reduce((n, g) => n + g.monitors.filter((m) => m.status === "triggered").length, 0);

  const cardT = {
    lastChecked: tm.lastChecked,
    nextCheck: tm.nextCheck,
    stopWatching: tm.stopWatching,
    alertLabel: tm.alertLabel,
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <style>{`
        @keyframes navpulse { 0%,100%{opacity:.4;transform:scale(.85)} 50%{opacity:1;transform:scale(1.2)} }
      `}</style>

      <GlobalNav active="monitoring" />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "var(--font-playfair, serif)", fontSize: 26, fontWeight: 700,
            color: "var(--text-primary, #111)", marginBottom: 4 }}>
            {tm.title}
          </h1>
          {!loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)" }}>
                {total === 0
                  ? tm.noMonitors
                  : `${active} ${tm.active} · ${alerts > 0 ? `${alerts} ${tm.alert}${alerts > 1 ? "s" : ""} · ` : ""}${total} ${tm.total}`}
              </p>
              {total > 0 && (
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "var(--font-dm-sans)", fontSize: 12,
                    color: clearingAll ? "var(--text-muted, #aaa)" : "rgba(220,38,38,0.7)",
                    padding: "2px 0",
                  }}
                >
                  {clearingAll ? "Clearing…" : "Clear all"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Alert banner */}
        {alerts > 0 && (
          <div style={{
            padding: "12px 16px", borderRadius: 12, marginBottom: 20,
            backgroundColor: "rgba(239,68,68,0.07)", border: "0.5px solid rgba(239,68,68,0.25)",
          }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13,
              color: "#ef4444", marginBottom: 4 }}>
              {tm.alertBannerTitle(alerts)}
            </p>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
              {tm.alertBannerDesc}
            </p>
          </div>
        )}

        {/* How monitoring works (only when empty) */}
        {!loading && total === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { emoji: "🔍", title: tm.typeAvailabilityLabel, desc: tm.emptyAvailabilityDesc },
              { emoji: "🔗", title: tm.typeReservationLabel,  desc: tm.emptyReservationDesc },
              { emoji: "🌦",  title: tm.typeWeatherLabel,      desc: tm.emptyWeatherDesc },
            ].map((item) => (
              <div key={item.title} style={{
                padding: "14px 16px", borderRadius: 12,
                border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji}</span>
                <div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 600, fontSize: 13,
                    color: "var(--text-primary, #111)", marginBottom: 3 }}>{item.title}</p>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
            <a href="/" style={{
              display: "block", textAlign: "center", padding: "12px",
              borderRadius: 10, backgroundColor: "var(--gold, #C9A84C)",
              color: "#fff", textDecoration: "none",
              fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, marginTop: 8,
            }}>
              {tm.startTrip}
            </a>
          </div>
        )}

        {loading && (
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-muted, #aaa)" }}>
            {tm.loading}
          </p>
        )}

        {/* Monitor groups */}
        {!loading && groups.map((group) => (
          <div key={group.jobId} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13,
                color: "var(--text-primary, #111)" }}>
                {group.tripLabel}
              </p>
              <a href="/tasks" style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
                color: "var(--gold, #C9A84C)", textDecoration: "none" }}>
                {tm.viewTrip}
              </a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {group.monitors.map((m) => (
                <MonitorCard key={m.id} monitor={m} onCancel={cancelMonitor} onDelete={deleteMonitor}
                  typeMeta={typeMeta} statusMeta={statusMeta} t={cardT} />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
