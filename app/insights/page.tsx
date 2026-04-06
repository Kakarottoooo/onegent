"use client";

import { useState, useEffect } from "react";
import GlobalNav from "@/components/GlobalNav";
import { useLanguage } from "@/app/hooks/useLanguage";
import type { Translations } from "@/lib/i18n";
import type { PolicyBias, UserPreferenceProfile } from "@/lib/policy";
import type { ScenarioMemory, PatternMemory, RelationshipProfile, RelationshipType } from "@/lib/memory";
import type { AgentFeedbackStats } from "@/lib/db";

function getSessionId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("session_id", id); }
  return id;
}

type Tab = "overview" | "scenarios" | "patterns" | "profile";

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
      color: "var(--text-muted, #aaa)", textTransform: "uppercase",
      letterSpacing: "0.08em", marginBottom: 10 }}>
      {children}
    </p>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: "green" | "red" | "gold" }) {
  const bg = accent === "green" ? "rgba(22,163,74,0.04)"
           : accent === "red"   ? "rgba(220,38,38,0.04)"
           : accent === "gold"  ? "rgba(201,168,76,0.06)"
           : "var(--card-2, #f9f9f9)";
  const border = accent === "green" ? "rgba(22,163,74,0.15)"
               : accent === "red"   ? "rgba(220,38,38,0.15)"
               : accent === "gold"  ? "rgba(201,168,76,0.2)"
               : "var(--border, #e5e7eb)";
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12,
      border: `0.5px solid ${border}`, background: bg }}>
      {children}
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: "var(--border, #e5e7eb)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: color,
        borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );
}

function Pill({ children, color, bg }: { children: string; color: string; bg: string }) {
  return (
    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600,
      color, background: bg, borderRadius: 6, padding: "2px 8px" }}>
      {children}
    </span>
  );
}

// ── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({ stats, policy, profile, ti }: {
  stats: AgentFeedbackStats | null;
  policy: PolicyBias | null;
  profile: UserPreferenceProfile | null;
  ti: Translations["insights"];
}) {
  if (!stats && !policy) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🧠</p>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 14,
          color: "var(--text-primary, #111)", marginBottom: 6 }}>
          {ti.nothingLearned}
        </p>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)", lineHeight: 1.6 }}>
          {ti.nothingLearnedDesc}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Stats row */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { label: ti.feedbackEvents, value: stats.totalEvents },
            { label: ti.accepted,       value: stats.outcomeBreakdown.accepted ?? 0 },
            { label: ti.overridden,     value: stats.outcomeBreakdown.manual_override ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} style={{
              padding: "12px", borderRadius: 10, textAlign: "center",
              border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
            }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 22, fontWeight: 800,
                color: "var(--text-primary, #111)", marginBottom: 2 }}>
                {value}
              </p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
                color: "var(--text-muted, #aaa)" }}>
                {label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Confidence */}
      {profile && (
        <Card accent={profile.confidenceLevel === "high" ? "green" : profile.confidenceLevel === "low" ? "red" : undefined}>
          <SectionLabel>{ti.profileConfidence}</SectionLabel>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 700,
            color: "var(--text-primary, #111)", marginBottom: 4, textTransform: "capitalize" }}>
            {profile.confidenceLevel}
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
            color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
            {profile.confidenceLevel === "high" ? ti.confHighDesc
              : profile.confidenceLevel === "medium" ? ti.confMidDesc
              : ti.confLowDesc}
          </p>
        </Card>
      )}

      {/* Negative memory */}
      {profile && profile.negatives.length > 0 && (
        <div>
          <SectionLabel>{ti.deprioritised}</SectionLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {profile.negatives.map((n) => (
              <Pill key={n.entity}
                color={n.severity === "strong" ? "rgba(220,38,38,0.85)" : "rgba(234,88,12,0.8)"}
                bg={n.severity === "strong" ? "rgba(220,38,38,0.07)" : "rgba(234,88,12,0.07)"}>
                {`${n.entity} (${Math.round(n.overrideRate * 100)}% ${ti.overridePct.replace("% ", "")})`}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Preferred providers */}
      {profile && profile.preferredProviders.length > 0 && (
        <div>
          <SectionLabel>{ti.preferredProviders}</SectionLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {profile.preferredProviders.map((p) => (
              <Pill key={p} color="rgba(22,163,74,0.85)" bg="rgba(22,163,74,0.07)">{p}</Pill>
            ))}
          </div>
        </div>
      )}

      {/* Tolerance summary */}
      {profile && (
        <div>
          <SectionLabel>{ti.tolerance}</SectionLabel>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { label: ti.timeAdjust,  value: profile.timeAdjustTolerance === "liberal" ? 0.8 : profile.timeAdjustTolerance === "strict" ? 0.2 : 0.5,  color: "rgba(234,88,12,0.7)" },
              { label: ti.venueSwitch, value: profile.venueSwitchTolerance === "liberal" ? 0.8 : profile.venueSwitchTolerance === "strict" ? 0.2 : 0.5, color: "#6366f1" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "var(--text-muted, #aaa)", marginBottom: 4 }}>{label}</p>
                <Bar value={value} color={color} />
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "var(--text-secondary, #666)", marginTop: 3 }}>
                  {Math.round(value * 100)}% {ti.acceptancePct.replace("% ", "")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link to metrics */}
      <a href="/metrics" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 10,
        border: "0.5px solid var(--border, #e5e7eb)",
        textDecoration: "none",
      }}>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600,
          color: "var(--text-primary, #111)" }}>
          {ti.kpiLink}
        </p>
        <span style={{ color: "var(--gold, #C9A84C)", fontSize: 13 }}>→</span>
      </a>
    </div>
  );
}

// ── Scenarios tab ──────────────────────────────────────────────────────────

function ScenariosTab({ taskMemory, ti }: { taskMemory: ScenarioMemory[]; ti: Translations["insights"] }) {
  if (taskMemory.length === 0) {
    return (
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13,
        color: "var(--text-muted, #aaa)", fontStyle: "italic" }}>
        {ti.scenariosEmpty}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
        color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
        {ti.scenariosIntro}
      </p>
      {taskMemory.map((mem) => (
        <Card key={`${mem.scenario}-${mem.stepType}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <Pill color="#8b5cf6" bg="rgba(139,92,246,0.08)">{mem.scenarioLabel}</Pill>
              <Pill color="var(--text-secondary, #666)" bg="var(--border, #e5e7eb)">{mem.stepType}</Pill>
            </div>
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
              color: "var(--text-muted, #aaa)" }}>
              {mem.totalEvents} {ti.events}
            </span>
          </div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13,
            color: "var(--text-primary, #111)", marginBottom: 10, lineHeight: 1.5 }}>
            {mem.keyInsight}
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            {mem.timeAdjustAcceptance !== null && (
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
                  color: "var(--text-muted, #aaa)", marginBottom: 4 }}>{ti.timeAdjustAcceptance}</p>
                <Bar value={mem.timeAdjustAcceptance} color="rgba(234,88,12,0.7)" />
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "rgba(234,88,12,0.8)", marginTop: 3 }}>
                  {Math.round(mem.timeAdjustAcceptance * 100)}%
                </p>
              </div>
            )}
            {mem.venueSwitchAcceptance !== null && (
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
                  color: "var(--text-muted, #aaa)", marginBottom: 4 }}>{ti.venueSwitchAcceptance}</p>
                <Bar value={mem.venueSwitchAcceptance} color="#6366f1" />
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "#6366f1", marginTop: 3 }}>
                  {Math.round(mem.venueSwitchAcceptance * 100)}%
                </p>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Patterns tab ───────────────────────────────────────────────────────────

function PatternsTab({ patternMemory, ti }: { patternMemory: PatternMemory | null; ti: Translations["insights"] }) {
  if (!patternMemory) {
    return (
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13,
        color: "var(--text-muted, #aaa)", fontStyle: "italic" }}>
        {ti.patternsEmpty}
      </p>
    );
  }

  const { statedVsActual, satisfactionPredictors, overrideTriggers } = patternMemory;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Stated vs actual */}
      <div>
        <SectionLabel>{ti.statedVsActual}</SectionLabel>
        <Card accent={statedVsActual.conclusion === "more_strict" ? "red"
                   : statedVsActual.conclusion === "more_liberal" ? "green" : undefined}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13,
            color: "var(--text-primary, #111)", marginBottom: 8, lineHeight: 1.5 }}>
            {statedVsActual.insight}
          </p>
          {statedVsActual.actualAcceptanceRate !== null && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "var(--text-muted, #aaa)" }}>{ti.actualAcceptance}</span>
                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  fontWeight: 700, color: "var(--text-primary, #111)" }}>
                  {Math.round(statedVsActual.actualAcceptanceRate * 100)}%
                </span>
              </div>
              <Bar
                value={statedVsActual.actualAcceptanceRate}
                color={statedVsActual.conclusion === "more_strict"
                  ? "rgba(220,38,38,0.6)" : "rgba(22,163,74,0.7)"}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Satisfaction predictors */}
      {satisfactionPredictors.length > 0 && (
        <div>
          <SectionLabel>{ti.satisfactionDrivers}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {satisfactionPredictors.map((pred) => (
              <div key={pred.agentDecision} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 10,
                border: "0.5px solid var(--border, #e5e7eb)",
                background: "var(--card-2, #f9f9f9)",
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
                    color: "var(--text-secondary, #666)", lineHeight: 1.4 }}>
                    {pred.insight}
                  </p>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10,
                    color: "var(--text-muted, #aaa)", marginTop: 2 }}>
                    {pred.count} {ti.events}
                  </p>
                </div>
                {pred.avgScore !== null && (
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <p style={{
                      fontFamily: "var(--font-dm-sans)", fontSize: 18, fontWeight: 800,
                      color: pred.avgScore >= 0.7 ? "rgba(22,163,74,0.85)"
                           : pred.avgScore >= 0.4 ? "var(--gold, #C9A84C)"
                           : "rgba(220,38,38,0.8)",
                    }}>
                      {Math.round(pred.avgScore * 100)}%
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Override triggers */}
      {overrideTriggers.length > 0 && (
        <div>
          <SectionLabel>{ti.whenYouTakeControl}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {overrideTriggers.map((tr, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0",
                borderBottom: i < overrideTriggers.length - 1
                  ? "0.5px solid var(--border, #e5e7eb)" : "none",
              }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
                  color: "var(--text-secondary, #666)", flex: 1, paddingRight: 12 }}>
                  {tr.description}
                </p>
                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 700,
                  color: "rgba(220,38,38,0.8)", flexShrink: 0 }}>
                  {Math.round(tr.overrideRate * 100)}% {ti.overridePct.replace("% ", "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Profile tab ────────────────────────────────────────────────────────────

function ProfileTab({ sessionId, relationship, onSave, ti }: {
  sessionId: string;
  relationship: RelationshipProfile | null;
  onSave: (r: RelationshipProfile) => void;
  ti: Translations["insights"];
}) {
  const [form, setForm] = useState({
    name: relationship?.name ?? "",
    type: (relationship?.type ?? "solo") as RelationshipType,
    constraints: relationship?.constraints.join(", ") ?? "",
    avoid_types: relationship?.avoid_types.join(", ") ?? "",
    notes: relationship?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const TYPES: RelationshipType[] = ["solo", "couple", "friends", "family"];
  const TYPE_LABELS: Record<RelationshipType, string> = {
    solo: ti.solo, couple: ti.couple, friends: ti.friends, family: ti.family,
  };

  async function save() {
    setSaving(true);
    const id = relationship?.id ?? crypto.randomUUID();
    const payload: RelationshipProfile = {
      id,
      name: form.name,
      type: form.type,
      session_ids: [sessionId],
      constraints: form.constraints.split(",").map((s) => s.trim()).filter(Boolean),
      avoid_types: form.avoid_types.split(",").map((s) => s.trim()).filter(Boolean),
      notes: form.notes,
      created_at: relationship?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const url    = relationship ? `/api/relationships/${id}` : "/api/relationships";
    const method = relationship ? "PATCH" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
    onSave(payload);
    setSaving(false);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
    border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
    fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary, #111)",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600,
    color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13,
        color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
        {ti.profileHint}
      </p>

      <div>
        <p style={labelStyle}>{ti.profileName}</p>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder={ti.profileNamePlaceholder}
          style={inputStyle}
        />
      </div>

      <div>
        <p style={labelStyle}>{ti.groupType}</p>
        <div style={{ display: "flex", gap: 6 }}>
          {TYPES.map((tp) => (
            <button key={tp} onClick={() => setForm((f) => ({ ...f, type: tp }))} style={{
              flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer",
              fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: form.type === tp ? 700 : 400,
              border: form.type === tp ? "1.5px solid var(--gold, #C9A84C)" : "0.5px solid var(--border, #e5e7eb)",
              background: form.type === tp ? "rgba(201,168,76,0.08)" : "var(--card, #fff)",
              color: form.type === tp ? "var(--gold, #C9A84C)" : "var(--text-secondary, #666)",
            }}>
              {TYPE_LABELS[tp]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p style={labelStyle}>{ti.alwaysNeeds}</p>
        <input
          value={form.constraints}
          onChange={(e) => setForm((f) => ({ ...f, constraints: e.target.value }))}
          placeholder={ti.alwaysNeedsPlaceholder}
          style={inputStyle}
        />
      </div>

      <div>
        <p style={labelStyle}>{ti.alwaysAvoids}</p>
        <input
          value={form.avoid_types}
          onChange={(e) => setForm((f) => ({ ...f, avoid_types: e.target.value }))}
          placeholder={ti.alwaysAvoidsPlaceholder}
          style={inputStyle}
        />
      </div>

      <div>
        <p style={labelStyle}>{ti.notes}</p>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder={ti.notesPlaceholder}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <button
        onClick={save}
        disabled={saving || !form.name}
        style={{
          padding: "11px", borderRadius: 10, border: "none", cursor: saving ? "wait" : "pointer",
          backgroundColor: "var(--gold, #C9A84C)", color: "#fff",
          fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700,
          opacity: !form.name ? 0.5 : 1,
        }}
      >
        {saving ? ti.saving : relationship ? ti.updateProfile : ti.saveProfile}
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [stats, setStats]               = useState<AgentFeedbackStats | null>(null);
  const [policy, setPolicy]             = useState<PolicyBias | null>(null);
  const [profile, setProfile]           = useState<UserPreferenceProfile | null>(null);
  const [taskMemory, setTaskMemory]     = useState<ScenarioMemory[]>([]);
  const [patternMemory, setPatternMemory] = useState<PatternMemory | null>(null);
  const [relationship, setRelationship] = useState<RelationshipProfile | null>(null);
  const [sessionId] = useState(getSessionId);
  const { t } = useLanguage();
  const ti = t.insights;

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    Promise.all([
      fetch(`/api/booking-feedback?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()),
      fetch(`/api/memory?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()),
    ])
      .then(([feedbackData, memoryData]) => {
        setStats(feedbackData.stats ?? null);
        setPolicy(memoryData.bias ?? null);
        setProfile(memoryData.profile ?? null);
        setTaskMemory(memoryData.taskMemory ?? []);
        setPatternMemory(memoryData.patternMemory ?? null);
        setRelationship(memoryData.relationship ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview",  label: ti.tabOverview  },
    { id: "scenarios", label: ti.tabScenarios },
    { id: "patterns",  label: ti.tabPatterns  },
    { id: "profile",   label: ti.tabProfile   },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="insights" />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "var(--font-playfair, serif)", fontSize: 26, fontWeight: 700,
            color: "var(--text-primary, #111)", marginBottom: 4 }}>
            {ti.title}
          </h1>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)" }}>
            {loading ? ti.loading : stats
              ? `${stats.totalEvents} ${ti.feedbackEvents}`
              : ti.emptyHint}
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "0.5px solid var(--border, #e5e7eb)", marginBottom: 24, gap: 0 }}>
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: 1, padding: "10px 4px", background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--gold, #C9A84C)" : "2px solid transparent",
              fontFamily: "var(--font-dm-sans)", fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? "var(--gold, #C9A84C)" : "var(--text-muted, #aaa)",
              cursor: "pointer", transition: "color 0.15s",
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-muted, #aaa)" }}>
            {ti.loading}
          </p>
        ) : (
          <>
            {activeTab === "overview"  && <OverviewTab stats={stats} policy={policy} profile={profile} ti={ti} />}
            {activeTab === "scenarios" && <ScenariosTab taskMemory={taskMemory} ti={ti} />}
            {activeTab === "patterns"  && <PatternsTab patternMemory={patternMemory} ti={ti} />}
            {activeTab === "profile"   && (
              <ProfileTab
                sessionId={sessionId}
                relationship={relationship}
                onSave={setRelationship}
                ti={ti}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
