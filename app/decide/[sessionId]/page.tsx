"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";
import AddContactPrompt from "@/components/AddContactPrompt";
import type { DecisionSession } from "@/lib/db";
import type { RecommendationCard } from "@/lib/types";

type Role = "initiator" | "partner";

interface PeerProfile {
  user_id?: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_code: string | null;
  username: string | null;
}
type InitiatorProfile = PeerProfile;

/**
 * Resolve role with priority:
 *   1. logged-in user matches session.initiator_user_id → initiator
 *   2. logged-in user matches session.invitee_user_id   → partner
 *   3. ?role=initiator query param (legacy behavior)    → initiator
 *   4. default                                          → partner
 */
function resolveRole(
  session: DecisionSession | null,
  currentUserId: string | null,
): Role {
  if (!session) return "partner";
  if (currentUserId && session.initiator_user_id === currentUserId) return "initiator";
  if (currentUserId && session.invitee_user_id === currentUserId) return "partner";
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("role") === "initiator") return "initiator";
  }
  return "partner";
}

export default function DecidePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { isSignedIn, userId: currentUserId } = useAuth();

  const [session, setSession] = useState<DecisionSession | null>(null);
  const [initiatorProfile, setInitiatorProfile] = useState<InitiatorProfile | null>(null);
  const [inviteeProfile, setInviteeProfile] = useState<PeerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerInput, setPartnerInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [myVotes, setMyVotes] = useState<Record<string, boolean>>({});
  const [feedbackSent, setFeedbackSent] = useState(false);

  const role = useMemo(
    () => resolveRole(session, currentUserId ?? null),
    [session, currentUserId],
  );

  // Show "Invited by X" banner only when:
  //  - this user is the partner (and not the initiator themselves)
  //  - session has an initiator_user_id (legacy anonymous DRs don't)
  //  - we have a profile to render
  const showInviteBanner =
    role === "partner" &&
    !!session?.initiator_user_id &&
    session?.status === "waiting_partner" &&
    !!initiatorProfile;

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/decision-session/${sessionId}`);
      if (res.status === 404) { setError("This session doesn't exist or has expired."); return; }
      if (res.status === 410) { setError("This session has expired. Ask the initiator to start a new one."); return; }
      if (!res.ok) { setError("Something went wrong. Please try refreshing."); return; }
      const data = await res.json() as {
        session: DecisionSession;
        initiator_profile?: InitiatorProfile | null;
        invitee_profile?: PeerProfile | null;
      };
      setSession(data.session);
      if (data.initiator_profile !== undefined) {
        setInitiatorProfile(data.initiator_profile);
      }
      if (data.invitee_profile !== undefined) {
        setInviteeProfile(data.invitee_profile);
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Initial load
  useEffect(() => { fetchSession(); }, [fetchSession]);

  // Poll every 4s when in waiting_partner or voting state
  useEffect(() => {
    if (!session) return;
    if (session.status === "decided" || session.status === "expired") return;
    const interval = setInterval(fetchSession, 4000);
    return () => clearInterval(interval);
  }, [session, fetchSession]);

  async function submitPartnerConstraints() {
    if (!partnerInput.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/decision-session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_partner_constraints",
          partnerConstraints: partnerInput.trim(),
        }),
      });
      if (res.status === 409) {
        setError("Voting has already started — constraints are locked.");
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json() as { session: DecisionSession };
      setSession(data.session);
    } catch {
      setError("Couldn't submit your constraints. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(cardId: string, approved: boolean) {
    setMyVotes((prev) => ({ ...prev, [cardId]: approved }));
    try {
      const res = await fetch(`/api/decision-session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vote", cardId, approved }),
      });
      if (!res.ok) return;
      const data = await res.json() as { session: DecisionSession };
      setSession(data.session);
    } catch {
      // Revert optimistic update
      setMyVotes((prev) => { const n = { ...prev }; delete n[cardId]; return n; });
    }
  }

  async function submitFeedback(feedback: "loved" | "fine" | "never") {
    setFeedbackSent(true);
    await fetch(`/api/decision-session/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "feedback", feedback, feedbackRole: role }),
    }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
        <div className="text-center max-w-sm">
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <a href="/" className="text-sm font-medium text-gray-900 underline">Start a new search</a>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const cards = (session.merged_options ?? []) as RecommendationCard[];
  const myVoteList = role === "initiator" ? session.initiator_vote : session.partner_vote;
  const theirVoteList = role === "initiator" ? session.partner_vote : session.initiator_vote;
  const decidedCard = session.decided_card_id
    ? cards.find((c) => c.restaurant?.id === session.decided_card_id)
    : null;

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
      <div className="max-w-md mx-auto px-4 pt-10 pb-20">

        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-7 h-7 rounded-full border-2 border-gray-900 bg-gray-900 flex items-center justify-center text-white text-xs font-bold"
          >
            {role === "initiator" ? "You" : "P"}
          </div>
          <div className="w-7 h-7 rounded-full border-2 border-gray-300 bg-gray-100 flex items-center justify-center text-gray-500 text-xs">
            {role === "initiator" ? "P" : "A"}
          </div>
          <span className="text-xs text-gray-400 ml-1">Decision Room</span>
        </div>

        {/* "Invited by X" banner — shows when an authenticated initiator
            specifically invited this account, or a logged-out user opens a
            link from a known initiator. Helps the partner know who they're
            deciding with rather than meeting an anonymous magic link. */}
        {showInviteBanner && initiatorProfile && (
          <div
            className="flex items-center gap-3 p-3 mb-5 rounded-2xl border"
            style={{
              borderColor: "var(--gold, #C9A84C)",
              background: "var(--gold-soft, #F5E9C8)",
            }}
          >
            {initiatorProfile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={initiatorProfile.avatar_url}
                alt=""
                className="w-10 h-10 rounded-full flex-shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                style={{ background: "var(--gold, #C9A84C)", color: "white" }}
              >
                {(initiatorProfile.display_name ?? initiatorProfile.username ?? initiatorProfile.profile_code ?? "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p
                className="text-xs font-semibold tracking-wide uppercase mb-0.5"
                style={{ color: "var(--gold-text, #5A4416)", letterSpacing: "0.12em" }}
              >
                Invited you
              </p>
              <p className="text-sm font-medium text-gray-900 truncate">
                {initiatorProfile.display_name ??
                  `@${initiatorProfile.username ?? initiatorProfile.profile_code ?? "user"}`}
              </p>
              {currentUserId &&
                session?.invitee_user_id &&
                session.invitee_user_id === currentUserId && (
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    They picked you from their contacts.
                  </p>
                )}
            </div>
            {!isSignedIn && (
              <a
                href="/"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg flex-shrink-0"
                style={{ background: "var(--gold, #C9A84C)", color: "white" }}
              >
                Sign in
              </a>
            )}
          </div>
        )}

        {/* ── SCREEN: Decided ── */}
        {session.status === "decided" && decidedCard && (
          <div>
            {/* "Add as contact" nudge — render only when both sides are known
                accounts and the viewer is logged in. The other side's profile
                depends on viewer role. */}
            {isSignedIn && currentUserId && (() => {
              const peer = role === "initiator" ? inviteeProfile : initiatorProfile;
              const peerIsMe =
                peer?.user_id != null && peer.user_id === currentUserId;
              if (!peer || peerIsMe) return null;
              return (
                <AddContactPrompt
                  peerDisplayName={peer.display_name}
                  peerCode={peer.username ?? peer.profile_code}
                  peerAvatarUrl={peer.avatar_url}
                />
              );
            })()}

            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🎉</span>
              <h1 className="text-base font-semibold text-gray-900">You both agreed</h1>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
              <p className="text-base font-semibold text-gray-900 mb-1">{decidedCard.restaurant?.name}</p>
              <p className="text-xs text-gray-500 mb-1">
                {decidedCard.restaurant?.cuisine} ·{" "}
                {decidedCard.restaurant?.price} ·{" "}
                {decidedCard.restaurant?.address?.split(",")[0]}
              </p>
              {decidedCard.why_recommended && (
                <p className="text-xs text-gray-600 leading-relaxed mt-2">{decidedCard.why_recommended}</p>
              )}
            </div>

            <div className="bg-gray-900 rounded-2xl p-4 text-white text-center mb-6">
              <p className="font-semibold text-sm">You&apos;re going here</p>
              {decidedCard.restaurant?.address && (
                <p className="text-xs text-gray-300 mt-1">{decidedCard.restaurant.address}</p>
              )}
            </div>

            {/* Feedback */}
            {!feedbackSent ? (
              <div>
                <p className="text-xs text-gray-500 text-center mb-3">How was it? (takes 5 seconds)</p>
                <div className="flex gap-2">
                  {(["loved", "fine", "never"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => submitFeedback(f)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {f === "loved" ? "❤️ Loved it" : f === "fine" ? "😐 Fine" : "❌ Never again"}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center">Thanks for the feedback!</p>
            )}

            <div className="mt-6 text-center">
              <a href="/" className="text-sm text-gray-400 hover:text-gray-600">
                Start a new decision →
              </a>
            </div>
          </div>
        )}

        {/* ── SCREEN: Partner adds constraints ── */}
        {role === "partner" && session.status === "waiting_partner" && (
          <div>
            <h1 className="text-base font-semibold text-gray-900 mb-1">
              You&apos;ve been invited to decide together
            </h1>
            <p className="text-sm text-gray-500 mb-5">
              Their request:{" "}
              <span className="text-gray-700 font-medium">&ldquo;{session.initiator_constraints}&rdquo;</span>
            </p>

            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-2">
                Add your constraints
              </label>
              <textarea
                value={partnerInput}
                onChange={(e) => setPartnerInput(e.target.value)}
                placeholder="e.g. no raw fish, quieter than last time, under $50"
                rows={3}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-900 resize-none focus:outline-none focus:border-gray-400"
              />
            </div>

            <button
              onClick={submitPartnerConstraints}
              disabled={!partnerInput.trim() || submitting}
              className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Finding options for both of you…" : "Find options for both of us →"}
            </button>
          </div>
        )}

        {/* ── SCREEN: Initiator waiting for partner ── */}
        {role === "initiator" && session.status === "waiting_partner" && (
          <div className="text-center py-12">
            <div className="text-3xl mb-4">⏳</div>
            <h1 className="text-base font-semibold text-gray-900 mb-2">Waiting for your partner</h1>
            <p className="text-sm text-gray-500">
              Once they add their constraints, you&apos;ll both see options here.
            </p>
          </div>
        )}

        {/* ── SCREEN: Conflict ── */}
        {session.status === "conflict" && (
          <div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
              <p className="text-sm font-medium text-amber-800 mb-1">Your constraints don&apos;t fully overlap</p>
              {session.conflict_reason && (
                <p className="text-xs text-amber-700">{session.conflict_reason}</p>
              )}
              <p className="text-xs text-amber-600 mt-2">Here are the closest options we could find:</p>
            </div>
            {/* Fall through to voting UI with the closest options */}
          </div>
        )}

        {/* ── SCREEN: Voting ── */}
        {(session.status === "voting" || session.status === "conflict") && cards.length > 0 && (
          <div>
            {session.status === "voting" && (
              <>
                <h1 className="text-base font-semibold text-gray-900 mb-1">
                  {cards.length} option{cards.length !== 1 ? "s" : ""} you&apos;ll both like
                </h1>
                <p className="text-sm text-gray-500 mb-5">
                  Tap &ldquo;Works for me&rdquo; on any that work. First mutual yes = done.
                </p>
              </>
            )}

            <div className="flex flex-col gap-3">
              {cards.map((card) => {
                const cardId = card.restaurant?.id ?? "";
                const myVoteForCard = myVoteList?.find((v) => v.card_id === cardId);
                const theirVoteForCard = theirVoteList?.find((v) => v.card_id === cardId);
                const optimisticVote = myVotes[cardId];
                const voted = myVoteForCard !== undefined || optimisticVote !== undefined;
                const approved = myVoteForCard?.approved ?? optimisticVote;
                const theyApproved = theirVoteForCard?.approved;

                return (
                  <div
                    key={cardId}
                    className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm"
                  >
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">{card.restaurant?.name}</p>
                    <p className="text-xs text-gray-500 mb-2">
                      {card.restaurant?.cuisine} · {card.restaurant?.price} ·{" "}
                      {card.restaurant?.address?.split(",")[0]}
                    </p>
                    {card.why_recommended && (
                      <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">
                        {card.why_recommended}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => vote(cardId, true)}
                        className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-colors ${
                          approved
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Works for me
                      </button>
                      <button
                        onClick={() => vote(cardId, false)}
                        className={`flex-1 py-2 rounded-xl border text-sm transition-colors ${
                          voted && !approved
                            ? "border-gray-300 text-gray-400 bg-gray-50"
                            : "border-gray-200 text-gray-400 hover:bg-gray-50"
                        }`}
                      >
                        Pass
                      </button>
                    </div>

                    {/* Vote status indicators */}
                    <p className="text-xs text-gray-400 mt-2">
                      {approved ? "You ✓" : voted ? "You ✗" : "You haven't voted"} ·{" "}
                      {theyApproved === true ? "Partner ✓" : theyApproved === false ? "Partner ✗" : "Waiting for partner"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SCREEN: Processing (partner just submitted constraints) ── */}
        {session.status === "waiting_partner" && role === "partner" && session.partner_constraints && (
          <div className="text-center py-8 mt-4">
            <p className="text-sm text-gray-400">Finding options for both of you…</p>
          </div>
        )}
      </div>
    </div>
  );
}
