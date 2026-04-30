"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";
import AddContactPrompt from "@/components/AddContactPrompt";
import ShareTripModal from "@/components/ShareTripModal";
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

interface MemberRow {
  user_id: string;
  is_initiator: boolean;
  has_submitted: boolean;
  has_voted: boolean;
  votes: { card_id: string; approved: boolean }[];
  profile: PeerProfile | null;
}

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
  const [shareOpen, setShareOpen] = useState(false);
  const [ownShare, setOwnShare] = useState<{ slug: string; view_count: number; visibility: string } | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  const isGroup = members.length > 0;
  const myMembership = useMemo(
    () => (currentUserId ? members.find((m) => m.user_id === currentUserId) ?? null : null),
    [members, currentUserId],
  );

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
        own_share?: { slug: string; view_count: number; visibility: string } | null;
        members?: MemberRow[];
      };
      setSession(data.session);
      if (data.initiator_profile !== undefined) {
        setInitiatorProfile(data.initiator_profile);
      }
      if (data.invitee_profile !== undefined) {
        setInviteeProfile(data.invitee_profile);
      }
      if (data.own_share !== undefined) {
        setOwnShare(data.own_share);
      }
      setMembers(data.members ?? []);
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

  /** Direct-book the decided restaurant. Creates a booking_job and
   *  bounces the user to /tasks for the actual autopilot run.
   *  Closes the "we agreed but how do we book" gap that made share-link
   *  feel like the only forward action. */
  async function bookDecided() {
    if (!sessionId) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await fetch(`/api/decision-session/${sessionId}/book`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setBookError(data?.error ?? "Couldn't start booking. Try the share link instead.");
        return;
      }
      const data = (await res.json()) as { redirectTo?: string };
      if (data.redirectTo) {
        window.location.href = data.redirectTo;
      }
    } catch {
      setBookError("Network error.");
    } finally {
      setBooking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
        <div className="text-center max-w-sm">
          <p className="text-sm text-[var(--text-muted)] mb-4">{error}</p>
          <a href="/" className="text-sm font-medium text-[var(--text-primary)] underline">Start a new search</a>
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
    <div className="min-h-screen bg-[var(--bg)]" style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}>
      <div className="max-w-md mx-auto px-4 pt-6 pb-20">

        {/* Back link — every state of /decide should have an escape hatch.
            Without this, the Waiting screen ("hourglass + Once they add
            their constraints") stranded users with no nav. */}
        <a
          href="/"
          className="inline-flex items-center gap-1 text-xs mb-4 transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          <span>←</span>
          <span>返回首页</span>
        </a>

        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-7 h-7 rounded-full border-2 border-[var(--text-primary)] bg-[var(--text-primary)] flex items-center justify-center text-white text-xs font-bold"
          >
            {role === "initiator" ? "You" : "P"}
          </div>
          <div className="w-7 h-7 rounded-full border-2 border-[var(--border)] bg-[var(--card-2)] flex items-center justify-center text-[var(--text-muted)] text-xs">
            {role === "initiator" ? "P" : "A"}
          </div>
          <span className="text-xs text-[var(--text-muted)] ml-1">Decision Room</span>
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
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {initiatorProfile.display_name ??
                  `@${initiatorProfile.username ?? initiatorProfile.profile_code ?? "user"}`}
              </p>
              {currentUserId &&
                session?.invitee_user_id &&
                session.invitee_user_id === currentUserId && (
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
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
              <h1 className="text-base font-semibold text-[var(--text-primary)]">
                {isGroup ? `All ${members.length} agreed` : "You both agreed"}
              </h1>
            </div>
            <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-4 mb-4 shadow-sm">
              <p className="text-base font-semibold text-[var(--text-primary)] mb-1">{decidedCard.restaurant?.name}</p>
              <p className="text-xs text-[var(--text-muted)] mb-1">
                {decidedCard.restaurant?.cuisine} ·{" "}
                {decidedCard.restaurant?.price} ·{" "}
                {decidedCard.restaurant?.address?.split(",")[0]}
              </p>
              {decidedCard.why_recommended && (
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-2">{decidedCard.why_recommended}</p>
              )}
            </div>

            <div className="bg-[var(--text-primary)] rounded-2xl p-4 text-white text-center mb-4">
              <p className="font-semibold text-sm">You&apos;re going here</p>
              {decidedCard.restaurant?.address && (
                <p className="text-xs text-[var(--text-muted)] mt-1">{decidedCard.restaurant.address}</p>
              )}
            </div>

            {/* Primary CTA: Book this restaurant directly inside Onegent.
                Previously the only forward action was a share link, which
                forced the user out to a third-party app — a UX dead-end. */}
            {isSignedIn && (
              <button
                type="button"
                onClick={bookDecided}
                disabled={booking}
                className="w-full py-3 rounded-2xl text-sm font-semibold mb-3 transition-colors"
                style={{
                  background: "var(--gold, #C9A84C)",
                  color: "white",
                  border: "none",
                  cursor: booking ? "default" : "pointer",
                  opacity: booking ? 0.6 : 1,
                }}
              >
                {booking ? "Setting up booking…" : "Book this on Onegent →"}
              </button>
            )}
            {bookError && (
              <p className="text-xs text-red-600 mb-3">{bookError}</p>
            )}

            {/* Secondary: show this off via a public/private share link.
                Reframed as proud-share, not as the partner-handoff. */}
            {isSignedIn && role === "initiator" && ownShare ? (
              <a
                href={`/s/${ownShare.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2 text-xs text-center transition-colors mb-5"
                style={{ color: "var(--gold-text, #5A4416)" }}
              >
                ↗ Shared · {ownShare.view_count}{" "}
                {ownShare.view_count === 1 ? "view" : "views"} · Open public page
              </a>
            ) : isSignedIn && role === "initiator" ? (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full py-2 text-xs transition-colors mb-5"
                style={{ color: "var(--text-muted)", background: "transparent", border: "none" }}
              >
                ↗ Show this off — share a link
              </button>
            ) : null}

            {/* Feedback */}
            {!feedbackSent ? (
              <div>
                <p className="text-xs text-[var(--text-muted)] text-center mb-3">How was it? (takes 5 seconds)</p>
                <div className="flex gap-2">
                  {(["loved", "fine", "never"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => submitFeedback(f)}
                      className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg)]"
                    >
                      {f === "loved" ? "❤️ Loved it" : f === "fine" ? "😐 Fine" : "❌ Never again"}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center">Thanks for the feedback!</p>
            )}

            <div className="mt-6 text-center">
              <a href="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                Start a new decision →
              </a>
            </div>
          </div>
        )}

        {/* ── PANEL: Group members status (multi-party DRs only) ── */}
        {isGroup && session.status === "waiting_partner" && (
          <GroupMembersPanel members={members} currentUserId={currentUserId} />
        )}

        {/* ── SCREEN: Group member needs to submit constraints ── */}
        {isGroup && session.status === "waiting_partner" && myMembership && !myMembership.has_submitted && !myMembership.is_initiator && (
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              You&apos;re in a group decision
            </h1>
            <p className="text-sm text-[var(--text-muted)] mb-5">
              Initiator&apos;s request:{" "}
              <span className="text-[var(--text-primary)] font-medium">&ldquo;{session.initiator_constraints}&rdquo;</span>
            </p>
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--text-secondary)] block mb-2">
                Add your constraints
              </label>
              <textarea
                value={partnerInput}
                onChange={(e) => setPartnerInput(e.target.value)}
                placeholder="e.g. no raw fish, quieter than last time, under $50"
                rows={3}
                className="w-full border border-[var(--border)] rounded-xl p-3 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--gold)]"
              />
            </div>
            <button
              onClick={submitPartnerConstraints}
              disabled={!partnerInput.trim() || submitting}
              className="w-full py-3 rounded-xl bg-[var(--text-primary)] text-white text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Saving…" : "Submit my constraints →"}
            </button>
            <p className="text-xs text-[var(--text-muted)] mt-3 text-center">
              Voting starts when everyone has submitted.
            </p>
          </div>
        )}

        {/* ── SCREEN: Group member already submitted, waiting on others ── */}
        {isGroup && session.status === "waiting_partner" && myMembership?.has_submitted && (
          <div className="text-center py-10">
            <div className="text-3xl mb-4">⏳</div>
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2">
              Waiting for your group
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              {`${members.filter((m) => !m.has_submitted).length} of ${members.length} still need to submit constraints.`}
            </p>
          </div>
        )}

        {/* ── SCREEN: Group viewer not invited ── */}
        {isGroup && session.status === "waiting_partner" && currentUserId && !myMembership && (
          <div className="text-center py-10">
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2">
              You weren&apos;t invited to this group
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Ask the initiator to send you the link from a group with you in it.
            </p>
          </div>
        )}

        {/* ── SCREEN: Group viewer not signed in ── */}
        {isGroup && session.status === "waiting_partner" && !currentUserId && (
          <div className="text-center py-10">
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2">
              Sign in to join this group decision
            </h1>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Group rooms need everyone signed in so we can keep votes straight.
            </p>
            <a
              href="/"
              className="inline-block py-2.5 px-5 rounded-xl bg-[var(--text-primary)] text-white text-sm font-medium"
            >
              Sign in →
            </a>
          </div>
        )}

        {/* ── SCREEN: Partner adds constraints (legacy 2-party only) ── */}
        {!isGroup && role === "partner" && session.status === "waiting_partner" && (
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              You&apos;ve been invited to decide together
            </h1>
            <p className="text-sm text-[var(--text-muted)] mb-5">
              Their request:{" "}
              <span className="text-[var(--text-primary)] font-medium">&ldquo;{session.initiator_constraints}&rdquo;</span>
            </p>

            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--text-secondary)] block mb-2">
                Add your constraints
              </label>
              <textarea
                value={partnerInput}
                onChange={(e) => setPartnerInput(e.target.value)}
                placeholder="e.g. no raw fish, quieter than last time, under $50"
                rows={3}
                className="w-full border border-[var(--border)] rounded-xl p-3 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--gold)]"
              />
            </div>

            <button
              onClick={submitPartnerConstraints}
              disabled={!partnerInput.trim() || submitting}
              className="w-full py-3 rounded-xl bg-[var(--text-primary)] text-white text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Finding options for both of you…" : "Find options for both of us →"}
            </button>
          </div>
        )}

        {/* ── SCREEN: Initiator waiting for partner (legacy 2-party only) ── */}
        {!isGroup && role === "initiator" && session.status === "waiting_partner" && (
          <div className="text-center py-12">
            <div className="text-3xl mb-4">⏳</div>
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2">Waiting for your partner</h1>
            <p className="text-sm text-[var(--text-muted)]">
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
                <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                  {cards.length} option{cards.length !== 1 ? "s" : ""} you&apos;ll both like
                </h1>
                <p className="text-sm text-[var(--text-muted)] mb-5">
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
                    className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-4 shadow-sm"
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{card.restaurant?.name}</p>
                    <p className="text-xs text-[var(--text-muted)] mb-2">
                      {card.restaurant?.cuisine} · {card.restaurant?.price} ·{" "}
                      {card.restaurant?.address?.split(",")[0]}
                    </p>
                    {card.why_recommended && (
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3 line-clamp-2">
                        {card.why_recommended}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => vote(cardId, true)}
                        className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-colors ${
                          approved
                            ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-white"
                            : "border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg)]"
                        }`}
                      >
                        Works for me
                      </button>
                      <button
                        onClick={() => vote(cardId, false)}
                        className={`flex-1 py-2 rounded-xl border text-sm transition-colors ${
                          voted && !approved
                            ? "border-[var(--border)] text-[var(--text-muted)] bg-[var(--bg)]"
                            : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]"
                        }`}
                      >
                        Pass
                      </button>
                    </div>

                    {/* Vote status indicators */}
                    {isGroup ? (
                      <GroupVoteStatus
                        members={members}
                        cardId={cardId}
                        currentUserId={currentUserId ?? null}
                      />
                    ) : (
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        {approved ? "You ✓" : voted ? "You ✗" : "You haven't voted"} ·{" "}
                        {theyApproved === true ? "Partner ✓" : theyApproved === false ? "Partner ✗" : "Waiting for partner"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SCREEN: Processing (partner just submitted constraints) ── */}
        {session.status === "waiting_partner" && role === "partner" && session.partner_constraints && (
          <div className="text-center py-8 mt-4">
            <p className="text-sm text-[var(--text-muted)]">Finding options for both of you…</p>
          </div>
        )}
      </div>

      {/* Share modal — initiator-only, mounted at page level so it floats
          above all decision screens. */}
      <ShareTripModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        kind="dr_outcome"
        refId={String(sessionId ?? "")}
      />
    </div>
  );
}

/**
 * Per-card vote pips for group rooms — one initial-circle per member with
 * color-coded state (gold = ✓, gray-strike = ✗, hollow = waiting).
 */
function GroupVoteStatus({
  members,
  cardId,
  currentUserId,
}: {
  members: MemberRow[];
  cardId: string;
  currentUserId: string | null;
}) {
  const approveCount = members.filter((m) => m.votes.find((v) => v.card_id === cardId && v.approved)).length;
  const totalCount = members.length;
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <div className="flex items-center" style={{ marginLeft: 2 }}>
        {members.map((m, idx) => {
          const v = m.votes.find((vt) => vt.card_id === cardId);
          const state: "approved" | "passed" | "waiting" =
            v?.approved === true ? "approved" : v?.approved === false ? "passed" : "waiting";
          const label =
            m.profile?.display_name ?? m.profile?.username ?? m.profile?.profile_code ?? "?";
          const initial = label.slice(0, 1).toUpperCase();
          const isMe = currentUserId && m.user_id === currentUserId;
          const bg =
            state === "approved"
              ? "var(--gold, #C9A84C)"
              : state === "passed"
                ? "#d1d5db"
                : "transparent";
          const color = state === "waiting" ? "var(--text-muted)" : "white";
          const border =
            state === "waiting" ? "2px dashed #d1d5db" : "2px solid transparent";
          return (
            <div
              key={m.user_id}
              title={`${label}${isMe ? " (you)" : ""} · ${state}`}
              style={{
                width: 22,
                height: 22,
                marginLeft: idx === 0 ? 0 : -6,
                borderRadius: "50%",
                background: bg,
                border,
                color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "var(--font-dm-sans)",
                position: "relative",
                zIndex: 8 - idx,
              }}
            >
              {initial}
            </div>
          );
        })}
      </div>
      <span className="text-[11px] text-[var(--text-muted)]">
        {approveCount} of {totalCount} ✓
      </span>
    </div>
  );
}

/**
 * Compact members panel: avatar row with submitted/voted state pips.
 * Used at the top of the constraint phase so each viewer sees the group's
 * progress at a glance.
 */
function GroupMembersPanel({
  members,
  currentUserId,
}: {
  members: MemberRow[];
  currentUserId: string | null | undefined;
}) {
  const submittedCount = members.filter((m) => m.has_submitted).length;
  return (
    <div
      className="flex items-center gap-3 p-3 mb-5 rounded-2xl border"
      style={{
        borderColor: "var(--border, #e5e7eb)",
        background: "white",
      }}
    >
      <div className="flex items-center" style={{ marginLeft: 4 }}>
        {members.slice(0, 8).map((m, idx) => {
          const label = m.profile?.display_name ?? m.profile?.username ?? m.profile?.profile_code ?? "?";
          const initial = label.slice(0, 1).toUpperCase();
          const isMe = currentUserId && m.user_id === currentUserId;
          return (
            <div
              key={m.user_id}
              title={`${label}${isMe ? " (you)" : ""}${m.has_submitted ? " · submitted" : " · waiting"}`}
              style={{
                width: 32,
                height: 32,
                marginLeft: idx === 0 ? 0 : -8,
                borderRadius: "50%",
                border: m.has_submitted
                  ? "2px solid var(--gold, #C9A84C)"
                  : "2px dashed #d1d5db",
                background: m.profile?.avatar_url
                  ? `center / cover no-repeat url(${m.profile.avatar_url})`
                  : "linear-gradient(135deg, #C9A84C 0%, #5A4416 100%)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-dm-sans)",
                position: "relative",
                zIndex: 8 - idx,
              }}
            >
              {!m.profile?.avatar_url && initial}
            </div>
          );
        })}
      </div>
      <div className="flex-1 min-w-0">
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Group room · {members.length} {members.length === 1 ? "person" : "people"}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          {submittedCount} of {members.length} submitted
        </p>
      </div>
    </div>
  );
}
