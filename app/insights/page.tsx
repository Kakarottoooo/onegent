"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";
import { LearnedSettingsTab } from "@/app/account/_components/SettingsTabs";
import { usePreferences } from "@/app/hooks/usePreferences";
import type { DiscoveredPreference } from "@/lib/types";
import type { PatternMemory, RelationshipProfile, ScenarioMemory } from "@/lib/memory";
import type {
  PolicyBias,
  UserPreferenceProfile as BehaviorProfile,
} from "@/lib/policy";
import DashboardTab from "./DashboardTab";

type MemoryTab = "dashboard" | "patterns" | "scenarios" | "evidence";

type MemoryResponse = {
  taskMemory: ScenarioMemory[];
  patternMemory: PatternMemory;
  bias: PolicyBias;
  profile: BehaviorProfile;
  relationship: RelationshipProfile | null;
  totalEvents: number;
};

type CandidateInference = {
  title: string;
  detail: string;
  strength: "high" | "medium";
};

function getSessionId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("session_id", id);
  }
  return id;
}

function resolveTab(raw: string | null): MemoryTab {
  if (raw === "patterns" || raw === "overview") return "patterns";
  if (raw === "scenarios") return "scenarios";
  if (raw === "evidence" || raw === "activity") return "evidence";
  return "dashboard";
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function humanizeTolerance(value: string | null | undefined): string {
  if (!value) return "Not learned yet";
  if (value === "strict") return "Strict";
  if (value === "moderate") return "Moderate";
  if (value === "liberal") return "Flexible";
  return value;
}

function buildCandidateInferences(data: MemoryResponse | null): CandidateInference[] {
  if (!data) return [];

  const items: CandidateInference[] = [];

  if (data.profile.timeAdjustTolerance) {
    items.push({
      title: `Time changes look ${humanizeTolerance(data.profile.timeAdjustTolerance).toLowerCase()}`,
      detail: `Based on actual acceptance behavior, not just stated settings.`,
      strength: data.profile.confidenceLevel === "high" ? "high" : "medium",
    });
  }

  if (data.profile.venueSwitchTolerance) {
    items.push({
      title: `Alternative options look ${humanizeTolerance(data.profile.venueSwitchTolerance).toLowerCase()}`,
      detail: `Derived from how often venue and option switches were accepted.`,
      strength: data.profile.confidenceLevel === "high" ? "high" : "medium",
    });
  }

  for (const provider of data.profile.preferredProviders.slice(0, 3)) {
    items.push({
      title: `Provider leaning: ${provider}`,
      detail: `This provider performs better than the user's average acceptance history.`,
      strength: "medium",
    });
  }

  for (const provider of data.profile.avoidedProviders.slice(0, 2)) {
    items.push({
      title: `Watchlist: ${provider}`,
      detail: `This provider is overridden often enough that the agent should treat it cautiously.`,
      strength: "medium",
    });
  }

  for (const negative of data.profile.negatives.slice(0, 4)) {
    items.push({
      title: `Potential avoid signal: ${negative.entity}`,
      detail: `${Math.round(negative.overrideRate * 100)}% override rate across ${negative.totalSeen} interactions.`,
      strength: negative.severity === "strong" ? "high" : "medium",
    });
  }

  return items.slice(0, 8);
}

function memoryPanelStyle(): React.CSSProperties {
  return {
    borderRadius: 22,
    border: "0.5px solid rgba(201,168,76,0.18)",
    background: "linear-gradient(180deg, rgba(40,36,31,0.96) 0%, rgba(27,24,21,0.98) 100%)",
    boxShadow: "0 20px 48px rgba(0,0,0,0.16)",
  };
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-dm-sans)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    color: "rgba(244,231,200,0.42)",
    marginBottom: 10,
  };
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "0.5px dashed rgba(201,168,76,0.2)",
        background: "rgba(255,255,255,0.02)",
        padding: 22,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 16,
          fontWeight: 700,
          color: "#F8F2E7",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 13,
          lineHeight: 1.7,
          color: "rgba(244,231,200,0.62)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}

function SignalChip({ signal }: { signal: DiscoveredPreference }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "0.5px solid rgba(201,168,76,0.16)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            fontWeight: 600,
            color: "#F8F2E7",
          }}
        >
          {signal.label}
        </div>
        <div
          style={{
            borderRadius: 999,
            padding: "2px 8px",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 10,
            fontWeight: 700,
            color: signal.user_confirmed ? "#1B1712" : "#C9A84C",
            background: signal.user_confirmed ? "var(--gold, #C9A84C)" : "rgba(201,168,76,0.12)",
            whiteSpace: "nowrap",
          }}
        >
          {signal.user_confirmed ? "Confirmed" : `Seen ${signal.seen_count}x`}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 12,
          lineHeight: 1.6,
          color: "rgba(244,231,200,0.58)",
        }}
      >
        {signal.source}
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "rgba(201,168,76,0.12)" : "transparent",
        color: active ? "var(--gold, #C9A84C)" : "rgba(244,231,200,0.58)",
        fontFamily: "var(--font-dm-sans)",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        padding: "10px 12px",
        borderRadius: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function InsightsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile: learnedProfile } = usePreferences();

  const [activeTab, setActiveTab] = useState<MemoryTab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [memory, setMemory] = useState<MemoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(resolveTab(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMemory() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/memory?session_id=${encodeURIComponent(sessionId)}`);
        const payload = (await response.json()) as MemoryResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Failed to load memory");
        if (!cancelled) setMemory(payload);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load memory");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMemory();

    return () => {
      cancelled = true;
    };
  }, []);

  const adoptedSignals = useMemo(
    () =>
      [...(learnedProfile.discovered ?? [])].sort(
        (a, b) =>
          Number(Boolean(b.user_confirmed)) - Number(Boolean(a.user_confirmed)) ||
          b.seen_count - a.seen_count,
      ),
    [learnedProfile.discovered],
  );

  const candidateInferences = useMemo(() => buildCandidateInferences(memory), [memory]);

  const topProviders = memory?.bias.providerRanking.slice(0, 4) ?? [];
  const scenarioMemory = memory?.taskMemory ?? [];
  const evidenceTriggers = memory?.patternMemory.overrideTriggers ?? [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="insights" />

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
        <div
          style={{
            ...memoryPanelStyle(),
            padding: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            <TabButton
              active={activeTab === "dashboard"}
              label="Dashboard"
              onClick={() => {
                setActiveTab("dashboard");
                router.replace("/insights?tab=dashboard");
              }}
            />
            <TabButton
              active={activeTab === "patterns"}
              label="Patterns"
              onClick={() => {
                setActiveTab("patterns");
                router.replace("/insights?tab=patterns");
              }}
            />
            <TabButton
              active={activeTab === "scenarios"}
              label="Scenarios"
              onClick={() => {
                setActiveTab("scenarios");
                router.replace("/insights?tab=scenarios");
              }}
            />
            <TabButton
              active={activeTab === "evidence"}
              label="Evidence"
              onClick={() => {
                setActiveTab("evidence");
                router.replace("/insights?tab=evidence");
              }}
            />
          </div>
        </div>

        {activeTab === "dashboard" && <DashboardTab />}

        {loading && activeTab !== "dashboard" && (
          <EmptyState
            title="Loading memory"
            detail="Pulling together learned defaults, behavioral patterns, and evidence traces."
          />
        )}

        {!loading && error && activeTab !== "dashboard" && (
          <EmptyState title="Memory unavailable" detail={error} />
        )}

        {!loading && !error && activeTab === "patterns" && (
          <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
            <div style={{ ...memoryPanelStyle(), padding: 22 }}>
              <div style={sectionTitleStyle()}>Currently applied defaults</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    borderRadius: 16,
                    border: "0.5px solid rgba(201,168,76,0.16)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 16,
                  }}
                >
                  <div style={sectionTitleStyle()}>Operating policy</div>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: "#F8F2E7",
                    }}
                  >
                    <div>Time changes: {humanizeTolerance(memory?.profile.timeAdjustTolerance)}</div>
                    <div>Option switches: {humanizeTolerance(memory?.profile.venueSwitchTolerance)}</div>
                    <div>
                      Preferred providers: {memory?.profile.preferredProviders.slice(0, 3).join(", ") || "Not stable yet"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 16,
                    border: "0.5px solid rgba(201,168,76,0.16)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 16,
                  }}
                >
                  <div style={sectionTitleStyle()}>Relationship defaults</div>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: "#F8F2E7",
                    }}
                  >
                    {memory?.relationship ? (
                      <>
                        <div>{memory.relationship.name} ({memory.relationship.type})</div>
                        <div>
                          Needs: {memory.relationship.constraints.join(", ") || "None saved"}
                        </div>
                        <div>
                          Avoids: {memory.relationship.avoid_types.join(", ") || "None saved"}
                        </div>
                      </>
                    ) : (
                      <div>No persistent group profile saved yet.</div>
                    )}
                  </div>
                </div>
              </div>

              {adoptedSignals.length > 0 || learnedProfile.dietary_restrictions.length > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {adoptedSignals.length > 0 && (
                    <div>
                      <div style={sectionTitleStyle()}>Adopted learned signals</div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                          gap: 10,
                        }}
                      >
                        {adoptedSignals.slice(0, 8).map((signal) => (
                          <SignalChip key={signal.id} signal={signal} />
                        ))}
                      </div>
                    </div>
                  )}

                  {learnedProfile.dietary_restrictions.length > 0 && (
                    <div>
                      <div style={sectionTitleStyle()}>Hard constraints</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {learnedProfile.dietary_restrictions.map((item) => (
                          <div
                            key={item}
                            style={{
                              borderRadius: 999,
                              padding: "6px 12px",
                              background: "rgba(201,168,76,0.12)",
                              color: "var(--gold, #C9A84C)",
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  title="No adopted defaults yet"
                  detail="The agent has not locked in many direct preference signals yet. Behavioral inferences below are still available."
                />
              )}
            </div>

            <div style={{ ...memoryPanelStyle(), padding: 22 }}>
              <div style={sectionTitleStyle()}>Candidate inferences</div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: "rgba(244,231,200,0.62)",
                  marginBottom: 14,
                }}
              >
                These are higher-order conclusions from behavior history and feedback. They explain
                how the system currently leans, even when the user has not explicitly confirmed a
                preference.
              </div>

              {candidateInferences.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 12,
                  }}
                >
                  {candidateInferences.map((item) => (
                    <div
                      key={`${item.title}-${item.detail}`}
                      style={{
                        borderRadius: 16,
                        border: "0.5px solid rgba(201,168,76,0.16)",
                        background: "rgba(255,255,255,0.03)",
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#F8F2E7",
                          }}
                        >
                          {item.title}
                        </div>
                        <div
                          style={{
                            borderRadius: 999,
                            padding: "2px 8px",
                            background:
                              item.strength === "high"
                                ? "rgba(201,168,76,0.18)"
                                : "rgba(255,255,255,0.06)",
                            color:
                              item.strength === "high"
                                ? "var(--gold, #C9A84C)"
                                : "rgba(244,231,200,0.58)",
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {item.strength}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                          lineHeight: 1.7,
                          color: "rgba(244,231,200,0.58)",
                        }}
                      >
                        {item.detail}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No behavioral inferences yet"
                  detail="More accepted or rejected agent actions are needed before the system can form strong candidate conclusions."
                />
              )}
            </div>

            <div style={{ ...memoryPanelStyle(), padding: 22 }}>
              <div style={sectionTitleStyle()}>Edit adopted defaults</div>
              <LearnedSettingsTab />
            </div>
          </div>
        )}

        {!loading && !error && activeTab === "patterns" && (
          <div style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              <div style={{ ...memoryPanelStyle(), padding: 20 }}>
                <div style={sectionTitleStyle()}>Stated vs actual</div>
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#F8F2E7",
                    marginBottom: 8,
                  }}
                >
                  {memory?.patternMemory.statedVsActual.conclusion ?? "unknown"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: "rgba(244,231,200,0.62)",
                  }}
                >
                  {memory?.patternMemory.statedVsActual.insight ?? "No pattern yet."}
                </div>
              </div>

              <div style={{ ...memoryPanelStyle(), padding: 20 }}>
                <div style={sectionTitleStyle()}>Behavioral tolerances</div>
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                    lineHeight: 1.9,
                    color: "#F8F2E7",
                  }}
                >
                  <div>
                    Time adjustments: {humanizeTolerance(memory?.bias.personalTolerance?.timeAdjust)}
                    {" "}
                    ({formatPercent(memory?.bias.personalTolerance?.timeAdjustRate)})
                  </div>
                  <div>
                    Option switching: {humanizeTolerance(memory?.bias.personalTolerance?.venueSwitch)}
                    {" "}
                    ({formatPercent(memory?.bias.personalTolerance?.venueSwitchRate)})
                  </div>
                </div>
              </div>
            </div>

            <div style={{ ...memoryPanelStyle(), padding: 20 }}>
              <div style={sectionTitleStyle()}>Provider ranking</div>
              {topProviders.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {topProviders.map((provider) => (
                    <div
                      key={provider.provider}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px, 1.5fr) 80px 80px 1fr",
                        gap: 10,
                        alignItems: "center",
                        borderRadius: 14,
                        border: "0.5px solid rgba(201,168,76,0.14)",
                        background: "rgba(255,255,255,0.03)",
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "#F8F2E7" }}>
                        {provider.preferenceRank}. {provider.provider}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.62)" }}>
                        Score {provider.score.toFixed(2)}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.62)" }}>
                        {formatPercent(provider.acceptanceRate)}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.52)" }}>
                        {provider.eventCount} observations
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No stable provider ranking yet"
                  detail="The agent needs more accepted or rejected runs before provider ordering becomes meaningful."
                />
              )}
            </div>

            <div style={{ ...memoryPanelStyle(), padding: 20 }}>
              <div style={sectionTitleStyle()}>Satisfaction predictors</div>
              {memory?.patternMemory.satisfactionPredictors.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {memory.patternMemory.satisfactionPredictors.map((item) => (
                    <div
                      key={item.agentDecision}
                      style={{
                        borderRadius: 14,
                        border: "0.5px solid rgba(201,168,76,0.14)",
                        background: "rgba(255,255,255,0.03)",
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "#F8F2E7" }}>
                          {item.agentDecision}
                        </div>
                        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.62)" }}>
                          Avg {item.avgScore != null ? item.avgScore.toFixed(2) : "n/a"}
                        </div>
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, lineHeight: 1.7, color: "rgba(244,231,200,0.58)" }}>
                        {item.insight} across {item.count} rated jobs.
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No satisfaction model yet"
                  detail="The agent has not collected enough explicit satisfaction feedback to rank decision styles."
                />
              )}
            </div>
          </div>
        )}

        {!loading && !error && activeTab === "scenarios" && (
          <div style={{ ...memoryPanelStyle(), padding: 22 }}>
            <div style={sectionTitleStyle()}>Scenario memory</div>
            {scenarioMemory.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {scenarioMemory.map((item) => (
                  <div
                    key={`${item.scenario}-${item.stepType}`}
                    style={{
                      borderRadius: 16,
                      border: "0.5px solid rgba(201,168,76,0.16)",
                      background: "rgba(255,255,255,0.03)",
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 700, color: "#F8F2E7" }}>
                        {item.scenarioLabel}
                      </div>
                      <div
                        style={{
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: "rgba(201,168,76,0.12)",
                          color: "var(--gold, #C9A84C)",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {item.stepType}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 12,
                        lineHeight: 1.8,
                        color: "rgba(244,231,200,0.62)",
                        marginBottom: 10,
                      }}
                    >
                      {item.keyInsight}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "#F8F2E7" }}>
                        Accept {formatPercent(item.acceptanceRate)}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "#F8F2E7" }}>
                        Override {formatPercent(item.overrideRate)}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.58)" }}>
                        Time shift {formatPercent(item.timeAdjustAcceptance)}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.58)" }}>
                        Switch {formatPercent(item.venueSwitchAcceptance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No scenario differentiation yet"
                detail="The system needs repeated decisions inside identifiable contexts like date night, family, or business before it can split memory by scenario."
              />
            )}
          </div>
        )}

        {!loading && !error && activeTab === "evidence" && (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ ...memoryPanelStyle(), padding: 22 }}>
              <div style={sectionTitleStyle()}>Why the system thinks this</div>
              {evidenceTriggers.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {evidenceTriggers.map((item) => (
                    <div
                      key={`${item.context}-${item.trigger}`}
                      style={{
                        borderRadius: 14,
                        border: "0.5px solid rgba(201,168,76,0.14)",
                        background: "rgba(255,255,255,0.03)",
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "#F8F2E7", marginBottom: 6 }}>
                        {item.context} / {item.trigger}
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, lineHeight: 1.7, color: "rgba(244,231,200,0.58)" }}>
                        {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No override triggers yet"
                  detail="Once specific agent actions repeatedly trigger manual overrides, they will show up here as explainable evidence."
                />
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              <div style={{ ...memoryPanelStyle(), padding: 20 }}>
                <div style={sectionTitleStyle()}>Trusted venues</div>
                {memory?.bias.topVenues.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {memory.bias.topVenues.map((venue) => (
                      <div key={venue.venueName} style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, lineHeight: 1.8, color: "#F8F2E7" }}>
                        {venue.venueName} <span style={{ color: "rgba(244,231,200,0.58)" }}>({venue.eventCount} events, {venue.score.toFixed(2)})</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.58)" }}>
                    No venue has enough positive history yet.
                  </div>
                )}
              </div>

              <div style={{ ...memoryPanelStyle(), padding: 20 }}>
                <div style={sectionTitleStyle()}>Flagged venues</div>
                {memory?.bias.flaggedVenues.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {memory.bias.flaggedVenues.map((venue) => (
                      <div key={venue.venueName} style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, lineHeight: 1.8, color: "#F8F2E7" }}>
                        {venue.venueName} <span style={{ color: "rgba(244,231,200,0.58)" }}>({venue.eventCount} events, {venue.score.toFixed(2)})</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(244,231,200,0.58)" }}>
                    No venue has been flagged strongly enough yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsPageInner />
    </Suspense>
  );
}
