"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useRoomState } from "@/app/hooks/useRoomState";
import { useAuth } from "@/app/hooks/useAuth";
import type {
  ApprovalRule,
  BookingJobStep,
  DecisionRoomConstraintRow,
  DecisionRoomMessage,
  DecisionRoomProposal,
  DecisionRoomStatus,
  DecisionRoomVote,
  UserProfile,
} from "@/lib/db";
import type { RecommendationCard, FlightRecommendationCard, ActivityRecommendationCard } from "@/lib/types";
import { extractOptions, resolveAcceptedOption, tallyVotes } from "@/lib/rooms/proposal-shape";
import { CARD, CARD_MUTED, CTA, CTA_GHOST, PAGE } from "@/app/_ui/tokens";
import { EyebrowLabel } from "@/app/_shared/editorial";
import GlobalNav from "@/components/GlobalNav";
import PhotoCarousel from "@/components/PhotoCarousel";
import FlightCard from "@/components/FlightCard";
import ActivityCard from "@/components/ActivityCard";
import {
  DRTimelineList,
  deriveDREventsFromSnapshot,
  type DRTimelineInputs,
} from "@/components/dr-timeline";
import { getTaskWorkspaceHref } from "@/lib/booking-jobs/workspace";

// Leaflet pulls in `window` — force client-only so the room detail page (a
// server component by default) doesn't choke during SSR.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type MyConstraint = {
  budget_max?: number;
  cuisines_like?: string[];
  cuisines_dislike?: string[];
  dietary?: string[];
  vibe?: "casual" | "romantic" | "lively" | "quiet" | "upscale";
  time_preference?: string;
  notes?: string;
};

type MyHotelConstraint = {
  budget_max_per_night?: number;
  neighborhood?: string;
  star_rating_min?: number;
  vibe?: "quiet" | "lively" | "romantic" | "family-friendly" | "business";
  amenities?: string[];
  notes?: string;
};

type MyFlightConstraint = {
  budget_max_per_person?: number;
  max_stops?: 0 | 1 | 2;
  earliest_departure?: string;
  latest_departure?: string;
  avoid_red_eye?: boolean;
  cabin_class_min?: "economy" | "premium_economy" | "business" | "first";
  preferred_airlines?: string[];
  avoid_airlines?: string[];
  notes?: string;
};

type MyActivityConstraint = {
  budget_max_per_ticket?: number;
  seat_type?: "premium" | "standard" | "economy";
  section_preferences?: string[];
  avoid_sections?: string[];
  accessibility?: { wheelchair?: boolean; companion_seat?: boolean };
  delivery_preference?: "mobile" | "will_call" | "print";
  notes?: string;
};

const VIBES = ["casual", "romantic", "lively", "quiet", "upscale"] as const;
const DIETARY_OPTIONS = ["vegetarian", "vegan", "gluten-free", "halal", "kosher", "no raw fish"];

const HOTEL_VIBES = ["quiet", "lively", "romantic", "family-friendly", "business"] as const;
const HOTEL_AMENITIES = ["pool", "gym", "breakfast", "parking", "pet-friendly", "wifi", "spa", "airport-shuttle"];
const STAR_OPTIONS = [3, 4, 5] as const;

const FLIGHT_STOPS_OPTIONS: Array<{ value: 0 | 1 | 2; label: string }> = [
  { value: 0, label: "Nonstop only" },
  { value: 1, label: "≤ 1 stop" },
  { value: 2, label: "≤ 2 stops" },
];
const FLIGHT_CABIN_OPTIONS: Array<{ value: MyFlightConstraint["cabin_class_min"]; label: string }> = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium econ." },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

const ACTIVITY_SEAT_OPTIONS: Array<{ value: NonNullable<MyActivityConstraint["seat_type"]>; label: string }> = [
  { value: "premium", label: "Premium / front" },
  { value: "standard", label: "Standard" },
  { value: "economy", label: "Economy / upper" },
];
const ACTIVITY_DELIVERY_OPTIONS: Array<{ value: NonNullable<MyActivityConstraint["delivery_preference"]>; label: string }> = [
  { value: "mobile", label: "Mobile ticket" },
  { value: "will_call", label: "Will-call" },
  { value: "print", label: "Print-at-home" },
];

// Local input/label tokens (room-specific variants of the shared ones).
const INPUT =
  "border border-[var(--border)] rounded-xl p-2 text-sm " +
  "bg-[var(--card)] text-[var(--text-primary)] " +
  "placeholder:text-[var(--text-muted)] " +
  "focus:outline-none focus:border-[var(--gold)]";
const LABEL = "text-xs text-[var(--text-secondary)] block mb-1";
const PILL_ACTIVE =
  "border-[var(--gold)] bg-[var(--gold)] text-white";
const PILL_IDLE =
  "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--gold)]";

export default function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const router = useRouter();
  const { userId, isSignedIn } = useAuth();
  const { snapshot, loading, error, refresh } = useRoomState(roomId);

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="rooms" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">Sign in to open this Decision Room.</p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">Go to sign in →</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className={PAGE}>
        <GlobalNav active="rooms" />
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-[var(--text-muted)]">Loading room…</p>
        </div>
      </div>
    );
  }
  if (error || !snapshot) {
    return (
      <div className={PAGE}>
        <GlobalNav active="rooms" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">{error ?? "Couldn't load room."}</p>
            <button
              onClick={() => router.push("/rooms")}
              className="text-sm font-medium text-[var(--gold)] underline"
            >
              Back to rooms
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <RoomView snapshot={snapshot} userId={userId ?? ""} refresh={refresh} />;
}

function RoomView({
  snapshot,
  userId,
  refresh,
}: {
  snapshot: NonNullable<ReturnType<typeof useRoomState>["snapshot"]>;
  userId: string;
  refresh: () => void;
}) {
  const { room, members, member_profiles, constraints, proposals } = snapshot;
  const myConstraint = constraints.find((c) => c.user_id === userId);
  const activeProposal = proposals.find((p) => p.status === "active") ?? null;
  const acceptedProposal = proposals.find((p) => p.status === "accepted") ?? null;
  // Most-recent rejected proposal — surfaced (read-only) above the regenerate
  // button while the room is back in `collecting` after a split vote, so
  // members can see what was proposed / who voted for what before they
  // decide to tweak constraints and re-propose.
  const lastRejectedProposal =
    [...proposals]
      .filter((p) => p.status === "rejected")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  const payerId = room.payer_id ?? room.creator_id;
  const isPayer = userId === payerId;
  const isCreator = userId === room.creator_id;

  // ── DR Activity Timeline ──────────────────────────────────────────────────
  // Derive a chronological event feed from the existing snapshot. No new API
  // calls — feeds entirely off room / members / constraints / proposals data
  // we already fetch via useRoomState. Updates each refresh tick automatically.
  const drTimelineEvents = useMemo(() => {
    const member_names: Record<string, string> = {};
    for (const [uid, profile] of Object.entries(member_profiles)) {
      member_names[uid] = profile.display_name ?? `@${profile.profile_code ?? uid.slice(-6)}`;
    }
    const inputs: DRTimelineInputs = {
      room: {
        id: room.id,
        title: room.title,
        status: room.status,
        creator_id: room.creator_id,
        created_at: room.created_at,
        updated_at: room.updated_at,
        booking_job_id: room.booking_job_id,
        approval_rule: room.approval_rule ?? "unanimous",
      },
      members: members.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        status: m.status,
        joined_at: m.joined_at,
      })),
      constraints: constraints.map((c) => ({
        user_id: c.user_id,
        submitted: c.submitted,
        updated_at: c.updated_at,
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        status: p.status,
        created_at: p.created_at,
        venue: extractProposalVenue(p),
        votes: p.votes.map((v) => ({
          user_id: v.user_id,
          vote: v.vote,
          voted_at: v.voted_at,
        })),
      })),
      member_names,
    };
    return deriveDREventsFromSnapshot(inputs);
  }, [room, members, member_profiles, constraints, proposals]);

  const submittedCount = constraints.filter((c) => c.submitted).length;
  const roomStatusMeta: Record<string, { text: string; tone: string }> = {
    collecting: { text: "Collecting", tone: "bg-[var(--card-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
    proposing: { text: "Proposing", tone: "bg-blue-500/15 text-blue-600 border border-blue-500/30" },
    approving: { text: "Voting", tone: "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/40" },
    executing: { text: "Booking", tone: "bg-indigo-500/15 text-indigo-600 border border-indigo-500/30" },
    done: { text: "Done", tone: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" },
    abandoned: { text: "Abandoned", tone: "bg-[var(--card-2)] text-[var(--text-muted)] border border-[var(--border)]" },
  };
  const roomStatus = roomStatusMeta[room.status] ?? roomStatusMeta.collecting;

  // Contact set + pending-request state for the "add as contact" button.
  // Version tick triggers reload.
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  type PendingState = "pending_outgoing" | "pending_incoming";
  const [pendingByUser, setPendingByUser] = useState<Record<string, { state: PendingState; requestId: string }>>({});
  const [contactsVersion, setContactsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, oRes, iRes] = await Promise.all([
          fetch("/api/contacts"),
          fetch("/api/contacts/requests/outgoing"),
          fetch("/api/contacts/requests/incoming"),
        ]);
        if (cancelled) return;
        if (cRes.ok) {
          const data = (await cRes.json()) as { contacts: Array<{ contact_user_id: string }> };
          setContactIds(new Set(data.contacts.map((c) => c.contact_user_id)));
        }
        const nextPending: Record<string, { state: PendingState; requestId: string }> = {};
        if (oRes.ok) {
          const data = (await oRes.json()) as {
            requests: Array<{ id: string; to_user_id: string; status: string }>;
          };
          for (const r of data.requests) {
            if (r.status === "pending") {
              nextPending[r.to_user_id] = { state: "pending_outgoing", requestId: r.id };
            }
          }
        }
        if (iRes.ok) {
          const data = (await iRes.json()) as {
            requests: Array<{ id: string; from_user_id: string; status: string }>;
          };
          for (const r of data.requests) {
            if (r.status === "pending") {
              nextPending[r.from_user_id] = { state: "pending_incoming", requestId: r.id };
            }
          }
        }
        if (!cancelled) setPendingByUser(nextPending);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [contactsVersion]);
  const reloadContacts = useCallback(() => setContactsVersion((v) => v + 1), []);

  // If the user removes a contact on /contacts and navigates back, the cached
  // set here goes stale and the "+" button stays hidden. Re-fetch whenever
  // this tab regains visibility or focus.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") reloadContacts();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reloadContacts);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reloadContacts);
    };
  }, [reloadContacts]);

  return (
    <div className={`${PAGE} pb-24`}>
      <GlobalNav active="rooms" />
      <div className="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-8 py-6">
        <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              <div className={`${CARD} p-5`}>
                <span
                  className="inline-flex items-center text-[11px] font-semibold uppercase mb-3 tracking-[0.18em]"
                  style={{
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "5px 12px",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  Room
                </span>
                <p
                  className="leading-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontSize: "clamp(22px, 2.5vw, 28px)",
                    fontWeight: 600,
                    color: "var(--ink-9)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15,
                    margin: 0,
                  }}
                >
                  {room.title}
                </p>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${roomStatus.tone}`}>
                    {roomStatus.text}
                  </span>
                  <span
                    className={
                      "text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap " +
                      ((room.approval_rule ?? "unanimous") === "unanimous"
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                        : "bg-blue-500/10 text-blue-600 border-blue-500/30")
                    }
                  >
                    {(room.approval_rule ?? "unanimous") === "unanimous" ? "Unanimous" : "Majority"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Members</p>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{members.length}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Submitted</p>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{submittedCount}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Invite code</p>
                  <p className="text-sm font-mono font-semibold text-[var(--text-primary)]">{room.short_code}</p>
                </div>
                <p className="mt-3 text-xs text-[var(--text-secondary)]">
                  {isPayer ? "You are the payer for this room." : "Another member is the payer for this room."}
                </p>
              </div>

              <div className={`${CARD} p-3`}>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2 px-1">Sections</p>
                <div className="flex flex-col gap-1">
                  <a href="#room-overview" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Overview</a>
                  <a href="#room-members" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">People</a>
                  <a href="#room-preferences" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Preferences</a>
                  <a href="#room-proposal" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Proposal</a>
                  {(acceptedProposal || room.status === "executing" || room.status === "done") && (
                    <a href="#room-booking" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Booking</a>
                  )}
                  <a href="#room-activity" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Activity</a>
                  <a href="#room-chat" className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--card-2)] hover:text-[var(--text-primary)] transition-colors">Chat</a>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0">
        <div id="room-overview" className="scroll-mt-24">
        <HeaderBar
          roomId={room.id}
          title={room.title}
          status={room.status}
          shortCode={room.short_code}
          approvalRule={room.approval_rule ?? "unanimous"}
          memberCount={members.length}
          isCreator={isCreator}
          refresh={refresh}
        />
        </div>

        <RoomActionsMenu
          roomId={room.id}
          creatorId={room.creator_id}
          myUserId={userId}
          status={room.status}
          members={members}
          memberProfiles={member_profiles}
          refresh={refresh}
        />

        <div id="room-members" className="scroll-mt-24">
        <MembersStrip
          members={members}
          memberProfiles={member_profiles}
          constraints={constraints}
          creatorId={room.creator_id}
          payerId={payerId}
          activeProposal={activeProposal}
          myUserId={userId}
          contactIds={contactIds}
          pendingByUser={pendingByUser}
          onContactAdded={reloadContacts}
        />
        </div>

        {/* Constraint form — expanded while collecting; collapsed hint once
            voting opens so the proposal gets visual priority. */}
        <div id="room-preferences" className="scroll-mt-24">
        {(room.status === "collecting" || room.status === "proposing") && (
          <ConstraintForm
            roomId={room.id}
            roomType={room.type}
            initial={myConstraint}
            refresh={refresh}
          />
        )}
        {room.status === "approving" && (
          <ConstraintForm
            roomId={room.id}
            roomType={room.type}
            initial={myConstraint}
            refresh={refresh}
            collapsedByDefault
          />
        )}
        </div>

        {/* Last rejected round — shown while the room is back in collecting
            so members can see what was proposed / who voted for what before
            deciding to regenerate. Must sit ABOVE ProposeButton so the
            "Generate proposal" CTA appears below the rejected option cards. */}
        <div id="room-proposal" className="scroll-mt-24">
        {!activeProposal && !acceptedProposal && lastRejectedProposal && room.status === "collecting" && (
          <ProposalCard
            proposal={lastRejectedProposal}
            roomId={room.id}
            roomType={room.type}
            userId={userId}
            memberCount={members.length}
            approvalRule={room.approval_rule ?? "unanimous"}
            memberProfiles={member_profiles}
            isCreator={isCreator}
            refresh={refresh}
            mode="rejected"
          />
        )}

        {/* Propose panel — always shown while collecting; gates itself on counts + role */}
        {room.status === "collecting" && (
          <ProposeButton
            roomId={room.id}
            refresh={refresh}
            submittedCount={submittedCount}
            memberCount={members.length}
            isCreator={isCreator}
          />
        )}

        {room.status === "proposing" && (
          <div className={`${CARD} p-4 mb-4 text-center`}>
            <p className="text-sm text-[var(--text-secondary)]">🧭 Finding a place that works for everyone…</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">This can take up to a minute.</p>
          </div>
        )}

        {/* Proposal card — stays visible through voting AND after acceptance
            so the group can see which restaurant won (read-only), instead of
            the options disappearing the moment a winner is picked. */}
        {(activeProposal ?? acceptedProposal) && (
          <ProposalCard
            proposal={(activeProposal ?? acceptedProposal)!}
            roomId={room.id}
            roomType={room.type}
            userId={userId}
            memberCount={members.length}
            approvalRule={room.approval_rule ?? "unanimous"}
            memberProfiles={member_profiles}
            isCreator={isCreator}
            refresh={refresh}
            mode={acceptedProposal && !activeProposal ? "accepted" : "active"}
          />
        )}
        </div>

        {/* Accepted proposal + execute (payer only) */}
        <div id="room-booking" className="scroll-mt-24">
        {acceptedProposal && room.status !== "done" && (
          <AcceptedBlock
            proposal={acceptedProposal}
            roomId={room.id}
            roomType={room.type}
            context={room.context_json ?? {}}
            isPayer={isPayer}
            status={room.status}
            bookingJobId={room.booking_job_id}
            approvalRule={room.approval_rule ?? "unanimous"}
            memberCount={members.length}
            refresh={refresh}
          />
        )}

        {/* Done */}
        {room.status === "done" && acceptedProposal && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-4 text-center">
            <div className="text-2xl mb-1">✅</div>
            <p className="text-sm font-medium text-emerald-600">Booked — you&apos;re all set.</p>
          </div>
        )}

        {/* Abandoned (creator only can trigger; Phase 1 no UI for it yet) */}
        {room.status === "abandoned" && (
          <div className={`${CARD_MUTED} p-4 mb-4 text-center`}>
            <p className="text-sm text-[var(--text-secondary)]">This room was abandoned.</p>
          </div>
        )}
        </div>

        {/* Activity timeline — chronological event feed derived from snapshot */}
        <div id="room-activity" className="scroll-mt-24 mb-4">
        <DRTimelineList
          events={drTimelineEvents}
          subtitle={`${drTimelineEvents.length} ${drTimelineEvents.length === 1 ? "event" : "events"}`}
          emptyMessage="Room just created"
        />
        </div>

        {/* Chat */}
        <div id="room-chat" className="scroll-mt-24">
        <ChatPanel
          roomId={room.id}
          userId={userId}
          members={members}
          memberProfiles={member_profiles}
        />
        </div>

        {/* Creator footnote */}
        {isCreator && room.status === "collecting" && (
          <p className="text-[11px] text-[var(--text-muted)] mt-4 text-center">
            You&apos;re the creator. {isPayer ? "You'll pay for this one." : "Partner will pay."}
          </p>
        )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ── Header bar ────────────────────────────────────────────────────────────────

function HeaderBar({
  roomId, title, status, shortCode, approvalRule, memberCount, isCreator, refresh,
}: {
  roomId: string;
  title: string;
  status: string;
  shortCode: string;
  approvalRule: ApprovalRule;
  memberCount: number;
  isCreator: boolean;
  refresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [changingRule, setChangingRule] = useState(false);
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const router = useRouter();
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/rooms/join/${shortCode}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  // Creator-only: flip the rule while still collecting (no proposal yet).
  // <3 members is forced unanimous server-side so the button stays hidden.
  const canChangeRule = isCreator && status === "collecting" && memberCount >= 3;
  async function flipRule() {
    const next: ApprovalRule = approvalRule === "unanimous" ? "majority" : "unanimous";
    const warn = next === "unanimous"
      ? "Switch to Unanimous? A single member can veto every option."
      : "Switch to Majority? More than half of members must approve.";
    if (!confirm(warn)) return;
    setChangingRule(true);
    setRuleErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/approval-rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_rule: next }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Change failed" }));
        setRuleErr(msg ?? "Couldn't change the rule.");
        return;
      }
      refresh();
    } finally {
      setChangingRule(false);
    }
  }

  // Semi-transparent colored pills survive both light and dark modes.
  const statusLabel: Record<string, { text: string; tone: string }> = {
    collecting: { text: "Collecting",  tone: "bg-[var(--card-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
    proposing:  { text: "Proposing",   tone: "bg-blue-500/15 text-blue-600 border border-blue-500/30" },
    approving:  { text: "Voting",      tone: "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/40" },
    executing:  { text: "Booking",     tone: "bg-indigo-500/15 text-indigo-600 border border-indigo-500/30" },
    done:       { text: "Done",        tone: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" },
    abandoned:  { text: "Abandoned",   tone: "bg-[var(--card-2)] text-[var(--text-muted)] border border-[var(--border)]" },
  };
  const s = statusLabel[status] ?? { text: status, tone: "bg-[var(--card-2)] text-[var(--text-secondary)] border border-[var(--border)]" };

  return (
    <>
      <button
        onClick={() => router.push("/rooms")}
        className="mb-6 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors"
        style={{
          borderColor: "var(--gold)",
          background: "transparent",
          color: "var(--gold)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(201,168,76,0.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <span aria-hidden>←</span>
        <span>Back to rooms</span>
      </button>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0 flex-1">
          <EyebrowLabel variant="filled">Room</EyebrowLabel>
          <h1
            className="leading-tight mt-3"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              fontSize: "clamp(28px, 4vw, 44px)",
              fontWeight: 600,
              color: "var(--ink-9)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {title}
          </h1>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-2 ${s.tone}`}>
          {s.text}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className={
            "text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap " +
            (approvalRule === "unanimous"
              ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
              : "bg-blue-500/10 text-blue-600 border-blue-500/30")
          }
          title={
            approvalRule === "unanimous"
              ? "Everyone must approve the same option"
              : "More than half of members must approve"
          }
        >
          {approvalRule === "unanimous" ? "🫱 Unanimous" : "🗳 Majority"}
        </span>
        {canChangeRule && (
          <button
            type="button"
            onClick={flipRule}
            disabled={changingRule}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline decoration-[var(--border)] hover:decoration-[var(--gold)] disabled:opacity-40"
          >
            {changingRule ? "…" : `Change to ${approvalRule === "unanimous" ? "Majority" : "Unanimous"}`}
          </button>
        )}
        {ruleErr && <span className="text-[10px] text-red-600">{ruleErr}</span>}
      </div>
      <div className="flex items-center gap-2 mb-4">
        <div className={`flex-1 ${CARD} px-3 py-2 flex items-center justify-between rounded-xl`}>
          <span className="text-xs text-[var(--text-muted)]">Code</span>
          <span className="text-sm font-mono font-semibold text-[var(--text-primary)]">{shortCode}</span>
        </div>
        <button
          onClick={copy}
          className={`py-2 px-3 ${CTA} text-xs`}
          title={inviteUrl}
        >
          {copied ? "Copied ✓" : "Copy invite"}
        </button>
      </div>
    </>
  );
}

// ── Room actions menu (leave / cancel / transfer / delete) ──────────────────

function RoomActionsMenu({
  roomId, creatorId, myUserId, status, members, memberProfiles, refresh,
}: {
  roomId: string;
  creatorId: string;
  myUserId: string;
  status: DecisionRoomStatus;
  members: { user_id: string }[];
  memberProfiles: Record<string, UserProfile>;
  refresh: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);

  const isCreator = creatorId === myUserId;
  const isExecuting = status === "executing";
  const isArchived = status === "done" || status === "abandoned";
  const canCancel = isCreator && !isExecuting && !isArchived;
  const canTransfer = isCreator && !isExecuting && members.filter((m) => m.user_id !== myUserId).length > 0;
  const canDelete = isCreator && !isExecuting;
  const canLeave = !isCreator && !isExecuting;

  const otherMembers = members.filter((m) => m.user_id !== myUserId);

  if (!isCreator && !canLeave) return null; // nothing actionable

  async function run(
    url: string,
    opts: RequestInit = {},
    onOk?: (res: Response) => void | Promise<void>
  ) {
    setBusy(url);
    setErr(null);
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Action failed" }));
        setErr(msg ?? "Action failed");
        return;
      }
      if (onOk) await onOk(res);
      else refresh();
    } finally {
      setBusy(null);
    }
  }

  async function cancelRoom() {
    if (!confirm("Cancel this room? It will move to History and voting stops.")) return;
    await run(`/api/rooms/${roomId}/abandon`, { method: "POST" }, () => {
      setOpen(false);
      refresh();
    });
  }

  async function leaveRoom() {
    if (!confirm("Leave this room? You won't see new proposals or votes.")) return;
    await run(`/api/rooms/${roomId}/leave`, { method: "POST" }, () => {
      router.push("/rooms");
    });
  }

  async function deleteRoom() {
    if (!confirm("Permanently delete this room and all its history? This can't be undone.")) return;
    await run(`/api/rooms/${roomId}`, { method: "DELETE" }, () => {
      router.push("/rooms");
    });
  }

  async function transferTo(toUserId: string) {
    const peerName = memberDisplayName(toUserId, memberProfiles);
    if (!confirm(`Hand ownership to ${peerName}? They'll become creator and (if you were paying) payer.`)) return;
    await run(
      `/api/rooms/${roomId}/transfer-creator`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_user_id: toUserId }),
      },
      () => {
        setTransferPickerOpen(false);
        setOpen(false);
        refresh();
      }
    );
  }

  // Non-creator sees a prominent standalone "Leave room" button (no dropdown).
  if (!isCreator && canLeave) {
    return (
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={leaveRoom}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 border border-red-500/40 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500 px-3 py-1.5 rounded-xl disabled:opacity-40 transition-colors"
          aria-label="Leave room"
        >
          <span aria-hidden>↩</span>
          Leave room
        </button>
        {err && (
          <div className="ml-2 text-[11px] text-red-600 self-center">{err}</div>
        )}
      </div>
    );
  }

  return (
    <div className="relative mb-3 flex justify-end">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setTransferPickerOpen(false); }}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--gold)] border border-[var(--gold)]/50 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/10 hover:border-[var(--gold)] px-3 py-1.5 rounded-xl transition-colors"
        aria-label="Manage room"
        aria-expanded={open}
      >
        <span aria-hidden>⚙</span>
        Manage room
        <span aria-hidden className="text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 z-20 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
          {canCancel && (
            <button
              type="button"
              onClick={cancelRoom}
              disabled={busy !== null}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--card-2)] disabled:opacity-40"
            >
              Cancel room
              <p className="text-[10px] text-[var(--text-muted)]">Move to History, stop voting.</p>
            </button>
          )}
          {canTransfer && (
            <button
              type="button"
              onClick={() => setTransferPickerOpen((v) => !v)}
              disabled={busy !== null}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--card-2)] border-t border-[var(--border)] disabled:opacity-40"
            >
              Transfer ownership {transferPickerOpen ? "▾" : "▸"}
              <p className="text-[10px] text-[var(--text-muted)]">Hand creator role to another member.</p>
            </button>
          )}
          {transferPickerOpen && canTransfer && (
            <div className="border-t border-[var(--border)] bg-[var(--card-2)]">
              {otherMembers.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => transferTo(m.user_id)}
                  disabled={busy !== null}
                  className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--card)] disabled:opacity-40"
                >
                  → {memberDisplayName(m.user_id, memberProfiles)}
                </button>
              ))}
            </div>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={deleteRoom}
              disabled={busy !== null}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 border-t border-[var(--border)] disabled:opacity-40"
            >
              Delete permanently
              <p className="text-[10px] text-[var(--text-muted)]">Wipes all messages, votes, constraints. Irreversible.</p>
            </button>
          )}
          {canLeave && (
            <button
              type="button"
              onClick={leaveRoom}
              disabled={busy !== null}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--card-2)] disabled:opacity-40"
            >
              Leave room
              <p className="text-[10px] text-[var(--text-muted)]">You&apos;ll stop getting updates. History stays.</p>
            </button>
          )}
          {isExecuting && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--border)]">
              Booking is in progress — clear it from the proposal to unlock these actions.
            </div>
          )}
          {err && (
            <div className="px-3 py-2 text-[11px] text-red-600 border-t border-[var(--border)]">
              {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Members strip ─────────────────────────────────────────────────────────────

function memberDisplayName(userId: string, profiles: Record<string, UserProfile>): string {
  return profiles[userId]?.display_name ?? `@${profiles[userId]?.profile_code ?? userId.slice(-6)}`;
}

/**
 * Best-effort label extractor for a proposal's primary option. Used by the
 * DR Activity Timeline to surface "accepted: Carbone" instead of "accepted".
 * Tolerates the multi-shape content_json (options[].card vs legacy single-
 * card) — returns undefined when nothing useful is found.
 */
function extractProposalVenue(proposal: { content_json: Record<string, unknown> | null }): string | undefined {
  const content = proposal.content_json;
  if (!content || typeof content !== "object") return undefined;
  // Prefer .options[0].card.{name,title,airline} when present.
  const options = (content as { options?: unknown }).options;
  if (Array.isArray(options) && options[0] && typeof options[0] === "object") {
    const card = (options[0] as { card?: unknown }).card;
    if (card && typeof card === "object") {
      const c = card as { name?: unknown; title?: unknown; airline?: unknown };
      if (typeof c.name === "string" && c.name) return c.name;
      if (typeof c.title === "string" && c.title) return c.title;
      if (typeof c.airline === "string" && c.airline) return c.airline;
    }
  }
  // Fall back to top-level fields on legacy single-card proposals.
  const c = content as { name?: unknown; title?: unknown };
  if (typeof c.name === "string" && c.name) return c.name;
  if (typeof c.title === "string" && c.title) return c.title;
  return undefined;
}

function MembersStrip({
  members, memberProfiles, constraints, creatorId, payerId, activeProposal,
  myUserId, contactIds, pendingByUser, onContactAdded,
}: {
  members: { user_id: string }[];
  memberProfiles: Record<string, UserProfile>;
  constraints: DecisionRoomConstraintRow[];
  creatorId: string;
  payerId: string;
  activeProposal:
    | (DecisionRoomProposal & { votes: DecisionRoomVote[] })
    | null;
  myUserId: string;
  contactIds: Set<string>;
  pendingByUser: Record<string, { state: "pending_outgoing" | "pending_incoming"; requestId: string }>;
  onContactAdded: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function sendRequest(targetId: string) {
    setSaving(targetId);
    setErrMsg(null);
    try {
      const res = await fetch("/api/contacts/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetId }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Request failed" }));
        setErrMsg(error ?? "Request failed");
        setTimeout(() => setErrMsg(null), 3000);
        return;
      }
      onContactAdded();
    } finally {
      setSaving(null);
    }
  }

  async function cancelPending(requestId: string, targetId: string) {
    setSaving(targetId);
    try {
      const res = await fetch(`/api/contacts/requests/${requestId}/cancel`, { method: "POST" });
      if (res.ok) onContactAdded();
    } finally {
      setSaving(null);
    }
  }

  const voteByUser = new Map<string, DecisionRoomVote>();
  if (activeProposal) {
    for (const v of activeProposal.votes) voteByUser.set(v.user_id, v);
  }
  const showVoteState = Boolean(activeProposal);

  return (
    <div className={`${CARD} p-3 mb-4`}>
      <p className="text-xs text-[var(--text-muted)] mb-2">
        Members ({members.length})
        {showVoteState && <span className="ml-1 text-[var(--text-muted)]">· voting</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const submitted = constraints.find((c) => c.user_id === m.user_id)?.submitted;
          const isCreator = m.user_id === creatorId;
          const isPayer = m.user_id === payerId;
          const profile = memberProfiles[m.user_id];
          const name = memberDisplayName(m.user_id, memberProfiles);
          const vote = voteByUser.get(m.user_id);

          // In voting phase, show vote symbol. Otherwise, show constraint-submit state.
          let statusEmoji = "…";
          let statusTone = "text-[var(--text-muted)]";
          let statusTitle = "Hasn't submitted yet";
          let pendingConstraint = false;
          if (showVoteState) {
            if (vote?.vote === "approve") {
              statusEmoji = "✓";
              statusTone = "text-emerald-600";
              statusTitle = "Approved";
            } else if (vote?.vote === "decline") {
              statusEmoji = "✗";
              statusTone = "text-red-600";
              statusTitle = "Declined";
            } else if (vote?.vote === "request_changes") {
              statusEmoji = "⟳";
              statusTone = "text-[var(--gold)]";
              statusTitle = "Wants changes";
            } else {
              statusEmoji = "…";
              statusTone = "text-[var(--text-muted)]";
              statusTitle = "Waiting to vote";
            }
          } else if (submitted) {
            statusEmoji = "✓";
            statusTone = "text-emerald-600";
            statusTitle = "Submitted constraints";
          } else {
            // Collecting phase, not yet submitted — highlight the pill.
            statusEmoji = "●";
            statusTone = "text-amber-500";
            statusTitle = "Hasn't submitted yet";
            pendingConstraint = true;
          }

          return (
            <div
              key={m.user_id}
              className={
                "flex items-center gap-1.5 bg-[var(--card-2)] rounded-full pl-1 pr-2.5 py-1 border " +
                (pendingConstraint ? "border-amber-500/60" : "border-[var(--border)]")
              }
            >
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)]">
                  {name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[100px]">{name}</span>
              {isCreator && <span className="text-[9px] text-[var(--text-muted)]">creator</span>}
              {isPayer && <span className="text-[9px] text-[var(--gold)]">💰</span>}
              <span className={`text-[9px] ${statusTone}`} title={statusTitle}>
                {statusEmoji}
              </span>
              {m.user_id !== myUserId && !contactIds.has(m.user_id) && (() => {
                const pending = pendingByUser[m.user_id];
                if (!pending) {
                  return (
                    <button
                      type="button"
                      onClick={() => sendRequest(m.user_id)}
                      disabled={saving === m.user_id}
                      title="Send contact request"
                      className="ml-0.5 w-5 h-5 rounded-full border border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)] text-sm font-bold leading-none flex items-center justify-center hover:bg-[var(--gold)] hover:text-white hover:border-[var(--gold)] disabled:opacity-40 transition-colors"
                    >
                      {saving === m.user_id ? "…" : "+"}
                    </button>
                  );
                }
                if (pending.state === "pending_outgoing") {
                  return (
                    <button
                      type="button"
                      onClick={() => cancelPending(pending.requestId, m.user_id)}
                      disabled={saving === m.user_id}
                      title="Pending — click to cancel"
                      className="ml-0.5 px-1.5 h-5 rounded-full border border-[var(--border)] bg-[var(--card)] text-[9px] text-[var(--text-muted)] hover:text-red-600 disabled:opacity-40"
                    >
                      {saving === m.user_id ? "…" : "pending ✕"}
                    </button>
                  );
                }
                // pending_incoming — they already sent me one; point to /contacts.
                return (
                  <Link
                    href="/contacts"
                    title="Respond in your inbox"
                    className="ml-0.5 px-1.5 h-5 rounded-full border border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[9px] text-[var(--gold)] flex items-center hover:bg-[var(--gold)] hover:text-white"
                  >
                    respond →
                  </Link>
                );
              })()}
            </div>
          );
        })}
      </div>
      {errMsg && (
        <p className="text-[11px] text-red-600 mt-2">{errMsg}</p>
      )}
    </div>
  );
}

// ── Constraint form dispatcher ────────────────────────────────────────────────
// Picks per-scenario editor by room.type. Restaurant/hotel each have their own
// shape (see lib/rooms/constraint-types.ts). The propose-route flattener
// dispatches on the same room.type, so these two sides must stay in sync.
function ConstraintForm(props: {
  roomId: string;
  roomType: string;
  initial: DecisionRoomConstraintRow | undefined;
  refresh: () => void;
  collapsedByDefault?: boolean;
}) {
  if (props.roomType === "hotel") {
    return <HotelConstraintForm {...props} />;
  }
  if (props.roomType === "flight") {
    return <FlightConstraintForm {...props} />;
  }
  if (props.roomType === "activity") {
    return <ActivityConstraintForm {...props} />;
  }
  return <RestaurantConstraintForm {...props} />;
}

// ── Restaurant constraint form ────────────────────────────────────────────────

function RestaurantConstraintForm({
  roomId, initial, refresh, collapsedByDefault = false,
}: {
  roomId: string;
  initial: DecisionRoomConstraintRow | undefined;
  refresh: () => void;
  collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const initialData = (initial?.data_json ?? {}) as MyConstraint;
  const [budget, setBudget] = useState<string>(
    initialData.budget_max ? String(initialData.budget_max) : ""
  );
  const [likes, setLikes] = useState<string>((initialData.cuisines_like ?? []).join(", "));
  const [dislikes, setDislikes] = useState<string>((initialData.cuisines_dislike ?? []).join(", "));
  const [dietary, setDietary] = useState<string[]>(initialData.dietary ?? []);
  const [vibe, setVibe] = useState<MyConstraint["vibe"]>(initialData.vibe);
  const [timePref, setTimePref] = useState<string>(initialData.time_preference ?? "");
  const [notes, setNotes] = useState<string>(initialData.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitted = Boolean(initial?.submitted);

  function buildData(): MyConstraint {
    const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    return {
      budget_max: budget ? Number(budget) : undefined,
      cuisines_like: splitList(likes),
      cuisines_dislike: splitList(dislikes),
      dietary: dietary.length ? dietary : undefined,
      vibe,
      time_preference: timePref || undefined,
      notes: notes || undefined,
    };
  }

  async function save(markSubmitted: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/constraints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildData(), submitted: markSubmitted }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Save failed" }));
        setErr(msg ?? "Save failed");
        return;
      }
      refresh();
    } finally {
      setSaving(false);
    }
  }

  function toggleDietary(opt: string) {
    setDietary((prev) => prev.includes(opt) ? prev.filter((p) => p !== opt) : [...prev, opt]);
  }

  return (
    <div className={`${CARD} p-4 mb-4`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-3 text-left"
      >
        <p className="text-base font-semibold text-[var(--ink-9)]" style={{ letterSpacing: "-0.005em" }}>Your constraints</p>
        <div className="flex items-center gap-2">
          {submitted && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
              Submitted
            </span>
          )}
          <span className="text-[var(--text-muted)] text-xs">{open ? "▲" : "▼ edit"}</span>
        </div>
      </button>

      {!open ? null : (<>
      <label className={LABEL}>Budget ceiling (per person)</label>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-[var(--text-muted)]">$</span>
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="e.g. 50"
          className={`flex-1 ${INPUT}`}
        />
      </div>

      <label className={LABEL}>Cuisines you like</label>
      <input
        value={likes}
        onChange={(e) => setLikes(e.target.value)}
        placeholder="italian, japanese, thai"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className={LABEL}>Cuisines to avoid</label>
      <input
        value={dislikes}
        onChange={(e) => setDislikes(e.target.value)}
        placeholder="indian, spicy"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Dietary</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {DIETARY_OPTIONS.map((opt) => {
          const active = dietary.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleDietary(opt)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Vibe</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {VIBES.map((v) => {
          const active = vibe === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setVibe(active ? undefined : v)}
              className={`text-xs px-2.5 py-1 rounded-full border capitalize transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>

      <label className={LABEL}>Time preference</label>
      <input
        value={timePref}
        onChange={(e) => setTimePref(e.target.value)}
        placeholder="e.g. 7pm Friday, early dinner"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className={LABEL}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Anything else? allergies, special occasion, parking…"
        className={`w-full resize-none mb-3 ${INPUT}`}
      />

      {err && (
        <p className="text-xs text-red-600 mb-2">{err}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl border border-[var(--border)] bg-transparent text-sm font-medium text-[var(--text-primary)] hover:border-[var(--gold)] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving}
          className={`flex-1 py-2.5 ${CTA}`}
        >
          {submitted ? "Update" : "Submit"}
        </button>
      </div>
      </>)}
    </div>
  );
}

// ── Hotel constraint form ─────────────────────────────────────────────────────
// Dates and guest count are Room-level (set at creation), NOT per-member — they
// live in room.context_json. Only soft preferences go here.
function HotelConstraintForm({
  roomId, initial, refresh, collapsedByDefault = false,
}: {
  roomId: string;
  initial: DecisionRoomConstraintRow | undefined;
  refresh: () => void;
  collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const initialData = (initial?.data_json ?? {}) as MyHotelConstraint;
  const [budget, setBudget] = useState<string>(
    initialData.budget_max_per_night ? String(initialData.budget_max_per_night) : ""
  );
  const [neighborhood, setNeighborhood] = useState<string>(initialData.neighborhood ?? "");
  const [starMin, setStarMin] = useState<number | undefined>(initialData.star_rating_min);
  const [vibe, setVibe] = useState<MyHotelConstraint["vibe"]>(initialData.vibe);
  const [amenities, setAmenities] = useState<string[]>(initialData.amenities ?? []);
  const [notes, setNotes] = useState<string>(initialData.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitted = Boolean(initial?.submitted);

  function buildData(): MyHotelConstraint {
    return {
      budget_max_per_night: budget ? Number(budget) : undefined,
      neighborhood: neighborhood.trim() || undefined,
      star_rating_min: starMin,
      vibe,
      amenities: amenities.length ? amenities : undefined,
      notes: notes || undefined,
    };
  }

  async function save(markSubmitted: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/constraints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildData(), submitted: markSubmitted }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Save failed" }));
        setErr(msg ?? "Save failed");
        return;
      }
      refresh();
    } finally {
      setSaving(false);
    }
  }

  function toggleAmenity(opt: string) {
    setAmenities((prev) => prev.includes(opt) ? prev.filter((p) => p !== opt) : [...prev, opt]);
  }

  return (
    <div className={`${CARD} p-4 mb-4`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-3 text-left"
      >
        <p className="text-base font-semibold text-[var(--ink-9)]" style={{ letterSpacing: "-0.005em" }}>Your hotel preferences</p>
        <div className="flex items-center gap-2">
          {submitted && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
              Submitted
            </span>
          )}
          <span className="text-[var(--text-muted)] text-xs">{open ? "▲" : "▼ edit"}</span>
        </div>
      </button>

      {!open ? null : (<>
      <label className={LABEL}>Budget ceiling (per night)</label>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-[var(--text-muted)]">$</span>
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="e.g. 250"
          className={`flex-1 ${INPUT}`}
        />
      </div>

      <label className={LABEL}>Neighborhood</label>
      <input
        value={neighborhood}
        onChange={(e) => setNeighborhood(e.target.value)}
        placeholder="e.g. downtown, near airport, Shinjuku"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Minimum stars</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {STAR_OPTIONS.map((s) => {
          const active = starMin === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStarMin(active ? undefined : s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {s}★ or better
            </button>
          );
        })}
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Vibe</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {HOTEL_VIBES.map((v) => {
          const active = vibe === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setVibe(active ? undefined : v)}
              className={`text-xs px-2.5 py-1 rounded-full border capitalize transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Amenities</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {HOTEL_AMENITIES.map((opt) => {
          const active = amenities.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleAmenity(opt)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <label className={LABEL}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Anything else? wheelchair accessible, honeymoon suite, late check-in…"
        className={`w-full resize-none mb-3 ${INPUT}`}
      />

      {err && (
        <p className="text-xs text-red-600 mb-2">{err}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl border border-[var(--border)] bg-transparent text-sm font-medium text-[var(--text-primary)] hover:border-[var(--gold)] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving}
          className={`flex-1 py-2.5 ${CTA}`}
        >
          {submitted ? "Update" : "Submit"}
        </button>
      </div>
      </>)}
    </div>
  );
}

// ── Flight constraint form ───────────────────────────────────────────────────

function FlightConstraintForm({
  roomId, initial, refresh, collapsedByDefault = false,
}: {
  roomId: string;
  initial: DecisionRoomConstraintRow | undefined;
  refresh: () => void;
  collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const initialData = (initial?.data_json ?? {}) as MyFlightConstraint;
  const [budget, setBudget] = useState<string>(
    initialData.budget_max_per_person ? String(initialData.budget_max_per_person) : ""
  );
  const [maxStops, setMaxStops] = useState<MyFlightConstraint["max_stops"]>(initialData.max_stops);
  const [cabinMin, setCabinMin] = useState<MyFlightConstraint["cabin_class_min"]>(initialData.cabin_class_min);
  const [earliest, setEarliest] = useState<string>(initialData.earliest_departure ?? "");
  const [latest, setLatest] = useState<string>(initialData.latest_departure ?? "");
  const [avoidRedEye, setAvoidRedEye] = useState<boolean>(Boolean(initialData.avoid_red_eye));
  const [preferred, setPreferred] = useState<string>((initialData.preferred_airlines ?? []).join(", "));
  const [avoid, setAvoid] = useState<string>((initialData.avoid_airlines ?? []).join(", "));
  const [notes, setNotes] = useState<string>(initialData.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitted = Boolean(initial?.submitted);

  function buildData(): MyFlightConstraint {
    const toList = (s: string) => {
      const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    };
    return {
      budget_max_per_person: budget ? Number(budget) : undefined,
      max_stops: maxStops,
      earliest_departure: earliest || undefined,
      latest_departure: latest || undefined,
      avoid_red_eye: avoidRedEye || undefined,
      cabin_class_min: cabinMin,
      preferred_airlines: toList(preferred),
      avoid_airlines: toList(avoid),
      notes: notes || undefined,
    };
  }

  async function save(markSubmitted: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/constraints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildData(), submitted: markSubmitted }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Save failed" }));
        setErr(msg ?? "Save failed");
        return;
      }
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${CARD} p-4 mb-4`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-3 text-left"
      >
        <p className="text-base font-semibold text-[var(--ink-9)]" style={{ letterSpacing: "-0.005em" }}>Your flight preferences</p>
        <div className="flex items-center gap-2">
          {submitted && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
              Submitted
            </span>
          )}
          <span className="text-[var(--text-muted)] text-xs">{open ? "▲" : "▼ edit"}</span>
        </div>
      </button>

      {!open ? null : (<>
      <label className={LABEL}>Budget ceiling (per person)</label>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-[var(--text-muted)]">$</span>
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="e.g. 450"
          className={`flex-1 ${INPUT}`}
        />
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Max stops</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {FLIGHT_STOPS_OPTIONS.map((opt) => {
          const active = maxStops === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMaxStops(active ? undefined : opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Minimum cabin class</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {FLIGHT_CABIN_OPTIONS.map((opt) => {
          const active = cabinMin === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCabinMin(active ? undefined : opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className={LABEL}>Earliest departure</label>
          <input
            type="time"
            value={earliest}
            onChange={(e) => setEarliest(e.target.value)}
            className={`w-full ${INPUT}`}
          />
        </div>
        <div>
          <label className={LABEL}>Latest departure</label>
          <input
            type="time"
            value={latest}
            onChange={(e) => setLatest(e.target.value)}
            className={`w-full ${INPUT}`}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={avoidRedEye}
          onChange={(e) => setAvoidRedEye(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        <span className="text-xs text-[var(--text-secondary)]">Avoid red-eye (midnight – 5am departures)</span>
      </label>

      <label className={LABEL}>Preferred airlines <span className="text-[var(--text-muted)]">(comma-separated)</span></label>
      <input
        value={preferred}
        onChange={(e) => setPreferred(e.target.value)}
        placeholder="e.g. Delta, United"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className={LABEL}>Avoid airlines <span className="text-[var(--text-muted)]">(comma-separated)</span></label>
      <input
        value={avoid}
        onChange={(e) => setAvoid(e.target.value)}
        placeholder="e.g. Spirit, Frontier"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className={LABEL}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Anything else? window seat, extra legroom, need wifi…"
        className={`w-full resize-none mb-3 ${INPUT}`}
      />

      {err && (
        <p className="text-xs text-red-600 mb-2">{err}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl border border-[var(--border)] bg-transparent text-sm font-medium text-[var(--text-primary)] hover:border-[var(--gold)] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving}
          className={`flex-1 py-2.5 ${CTA}`}
        >
          {submitted ? "Update" : "Submit"}
        </button>
      </div>
      </>)}
    </div>
  );
}

// ── Activity constraint form ──────────────────────────────────────────────────

function ActivityConstraintForm({
  roomId, initial, refresh, collapsedByDefault = false,
}: {
  roomId: string;
  initial: DecisionRoomConstraintRow | undefined;
  refresh: () => void;
  collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const initialData = (initial?.data_json ?? {}) as MyActivityConstraint;
  const [budget, setBudget] = useState<string>(
    initialData.budget_max_per_ticket ? String(initialData.budget_max_per_ticket) : ""
  );
  const [seatType, setSeatType] = useState<MyActivityConstraint["seat_type"]>(initialData.seat_type);
  const [sections, setSections] = useState<string>((initialData.section_preferences ?? []).join(", "));
  const [avoidSections, setAvoidSections] = useState<string>((initialData.avoid_sections ?? []).join(", "));
  const [wheelchair, setWheelchair] = useState<boolean>(Boolean(initialData.accessibility?.wheelchair));
  const [companionSeat, setCompanionSeat] = useState<boolean>(Boolean(initialData.accessibility?.companion_seat));
  const [delivery, setDelivery] = useState<MyActivityConstraint["delivery_preference"]>(initialData.delivery_preference);
  const [notes, setNotes] = useState<string>(initialData.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitted = Boolean(initial?.submitted);

  function buildData(): MyActivityConstraint {
    const toList = (s: string) => {
      const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    };
    const accessibility =
      wheelchair || companionSeat
        ? {
            wheelchair: wheelchair || undefined,
            companion_seat: companionSeat || undefined,
          }
        : undefined;
    return {
      budget_max_per_ticket: budget ? Number(budget) : undefined,
      seat_type: seatType,
      section_preferences: toList(sections),
      avoid_sections: toList(avoidSections),
      accessibility,
      delivery_preference: delivery,
      notes: notes || undefined,
    };
  }

  async function save(markSubmitted: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/constraints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildData(), submitted: markSubmitted }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Save failed" }));
        setErr(msg ?? "Save failed");
        return;
      }
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${CARD} p-4 mb-4`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-3 text-left"
      >
        <p className="text-base font-semibold text-[var(--ink-9)]" style={{ letterSpacing: "-0.005em" }}>Your event preferences</p>
        <div className="flex items-center gap-2">
          {submitted && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
              Submitted
            </span>
          )}
          <span className="text-[var(--text-muted)] text-xs">{open ? "▲" : "▼ edit"}</span>
        </div>
      </button>

      {!open ? null : (<>
      <label className={LABEL}>Budget ceiling (per ticket)</label>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-[var(--text-muted)]">$</span>
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="e.g. 250"
          className={`flex-1 ${INPUT}`}
        />
      </div>

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Seat tier</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ACTIVITY_SEAT_OPTIONS.map((opt) => {
          const active = seatType === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSeatType(active ? undefined : opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label className={LABEL}>Preferred sections <span className="text-[var(--text-muted)]">(comma-separated)</span></label>
      <input
        value={sections}
        onChange={(e) => setSections(e.target.value)}
        placeholder="e.g. Orchestra, Mezzanine"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className={LABEL}>Avoid sections <span className="text-[var(--text-muted)]">(comma-separated)</span></label>
      <input
        value={avoidSections}
        onChange={(e) => setAvoidSections(e.target.value)}
        placeholder="e.g. Upper Balcony"
        className={`w-full mb-3 ${INPUT}`}
      />

      <label className="text-xs text-[var(--text-secondary)] block mb-2">Delivery</label>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ACTIVITY_DELIVERY_OPTIONS.map((opt) => {
          const active = delivery === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDelivery(active ? undefined : opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={wheelchair}
          onChange={(e) => setWheelchair(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        <span className="text-xs text-[var(--text-secondary)]">Wheelchair accessible seating required</span>
      </label>
      <label className="flex items-center gap-2 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={companionSeat}
          onChange={(e) => setCompanionSeat(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        <span className="text-xs text-[var(--text-secondary)]">Need companion seat next to wheelchair</span>
      </label>

      <label className={LABEL}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Anything else? aisle seat, no obstructed view, arriving late…"
        className={`w-full resize-none mb-3 ${INPUT}`}
      />

      {err && (
        <p className="text-xs text-red-600 mb-2">{err}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl border border-[var(--border)] bg-transparent text-sm font-medium text-[var(--text-primary)] hover:border-[var(--gold)] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving}
          className={`flex-1 py-2.5 ${CTA}`}
        >
          {submitted ? "Update" : "Submit"}
        </button>
      </div>
      </>)}
    </div>
  );
}

// ── Propose button ────────────────────────────────────────────────────────────

function ProposeButton({
  roomId,
  refresh,
  submittedCount,
  memberCount,
  isCreator,
}: {
  roomId: string;
  refresh: () => void;
  submittedCount: number;
  memberCount: number;
  isCreator: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const missing = Math.max(0, memberCount - submittedCount);
  const allSubmitted = missing === 0 && submittedCount > 0;
  // Creator escape hatch: at least 2 submitted but not everyone.
  const canForce = isCreator && !allSubmitted && submittedCount >= 2;

  async function propose(force: boolean) {
    if (force) {
      const ok = confirm(
        `${missing} member${missing === 1 ? "" : "s"} haven${"\u2019"}t submitted preferences yet. Their input will be ignored. Continue?`
      );
      if (!ok) return;
    }
    setLoading(true);
    setErr(null);
    try {
      const url = force ? `/api/rooms/${roomId}/propose?force=1` : `/api/rooms/${roomId}/propose`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Propose failed" }));
        setErr(msg ?? "Couldn't generate a proposal.");
        return;
      }
      refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4">
      <p className="text-xs text-[var(--text-muted)] mb-2 text-center">
        {submittedCount}/{memberCount} submitted
        {missing > 0 && <span> · {missing} still waiting</span>}
      </p>
      <button
        onClick={() => propose(false)}
        disabled={loading || !allSubmitted}
        className={`w-full py-3 ${CTA} disabled:opacity-50`}
        title={allSubmitted ? undefined : "Waiting for everyone to submit"}
      >
        {loading ? "Finding a place…" : allSubmitted ? "🧭 Generate proposal →" : "Waiting for all members"}
      </button>
      {canForce && (
        <button
          type="button"
          onClick={() => propose(true)}
          disabled={loading}
          className="mt-2 w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline decoration-[var(--border)] hover:decoration-[var(--gold)] disabled:opacity-40"
        >
          Propose without waiting →
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// ── Proposal card + voting ────────────────────────────────────────────────────

function ProposalCard({
  proposal, roomId, roomType, userId, memberCount, approvalRule, memberProfiles, isCreator, refresh, mode = "active",
}: {
  proposal: DecisionRoomProposal & { votes: DecisionRoomVote[] };
  roomId: string;
  roomType: string;
  userId: string;
  memberCount: number;
  approvalRule: ApprovalRule;
  memberProfiles: Record<string, UserProfile>;
  isCreator: boolean;
  refresh: () => void;
  /**
   * - "active" (default): voting in progress, buttons enabled
   * - "accepted": winner highlighted emerald, option picks still mutable
   * - "rejected": read-only historical snapshot of a prior round that failed
   *   to converge — shows tallies so members can see who picked what before
   *   they regenerate.
   */
  mode?: "active" | "accepted" | "rejected";
}) {
  const historical = mode === "rejected";
  const canPickOption = mode === "active" || mode === "accepted";
  const options = useMemo(() => extractOptions(proposal), [proposal]);
  const tallies = useMemo(() => tallyVotes(options, proposal.votes), [options, proposal.votes]);
  // Flight proposals can switch between card list and map view (routes + airports).
  // Hotel/restaurant stays in list mode for now — MapView already supports those
  // via pins but the room layout doesn't have a natural map slot yet.
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const showMapToggle = roomType === "flight";
  const myVote = proposal.votes.find((v) => v.user_id === userId);
  // Unique voters — approve / decline / request_changes all count as "voted".
  const voterCount = new Set(proposal.votes.map((v) => v.user_id)).size;
  const missingVoters = Math.max(0, memberCount - voterCount);
  // Only accepted proposals have a winner to highlight.
  const winnerId = useMemo(
    () => (mode === "accepted" ? resolveAcceptedOption(approvalRule, memberCount, tallies) : null),
    [mode, approvalRule, memberCount, tallies],
  );

  const [voting, setVoting] = useState<string | null>(null); // in-flight option_id or "decline"
  const [err, setErr] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function finalizeNow() {
    const ok = confirm(
      `${missingVoters} member${missingVoters === 1 ? "" : "s"} haven${"\u2019"}t voted yet. Finalize with current votes?`
    );
    if (!ok) return;
    setFinalizing(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/proposals/${proposal.id}/finalize`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Finalize failed" }));
        setErr(msg ?? "Couldn't finalize voting.");
        return;
      }
      refresh();
    } finally {
      setFinalizing(false);
    }
  }

  async function vote(kind: "approve" | "decline" | "request_changes", optionId: string | null) {
    setVoting(kind === "approve" ? (optionId ?? "approve") : kind);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/proposals/${proposal.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: kind, option_id: optionId }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Vote failed" }));
        setErr(msg ?? "Vote failed");
        return;
      }
      refresh();
    } finally {
      setVoting(null);
    }
  }

  async function withdrawVote(optionId: string) {
    setVoting(optionId);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/proposals/${proposal.id}/vote`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Withdraw failed" }));
        setErr(msg ?? "Withdraw failed");
        return;
      }
      refresh();
    } finally {
      setVoting(null);
    }
  }

  const conflicts = Array.isArray(proposal.conflicts_json)
    ? (proposal.conflicts_json as Array<{ reason: string; affected_users?: string[] }>)
    : [];

  // For "2/3 approved" we count anyone who approved any option.
  const totalApproved = tallies.reduce((acc, t) => acc + t.approved_by.length, 0);

  return (
    <div
      className={`${CARD} p-4 mb-4 ${mode === "rejected" ? "opacity-80" : ""}`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-[var(--text-muted)]">
          {mode === "rejected"
            ? `Last round — rejected · ${options.length > 1 ? `${options.length} options` : "1 option"}`
            : mode === "accepted"
              ? `Accepted — ${options.length > 1 ? `${options.length} options` : "1 option"}`
              : `Agent proposes ${options.length > 1 ? `${options.length} options` : "an option"}`}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {voterCount}/{memberCount} voted · {totalApproved} approved · {approvalRule === "unanimous" ? "unanimous" : "majority"}
        </p>
      </div>

      {/* Conflict banner (A2) */}
      {conflicts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-3">
          <p className="text-[11px] text-red-600 uppercase tracking-wide mb-1">
            ⚠ Constraint conflict
          </p>
          {conflicts.map((c, i) => (
            <div key={i} className="mb-1 last:mb-0">
              <p className="text-xs text-red-600">{c.reason}</p>
              {c.affected_users && c.affected_users.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  {c.affected_users.map((uid) => {
                    const p = memberProfiles[uid];
                    const name = p?.display_name ?? `@${p?.profile_code ?? uid.slice(-6)}`;
                    return p?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={uid}
                        src={p.avatar_url}
                        alt={name}
                        title={name}
                        className="w-5 h-5 rounded-full ring-2 ring-red-500/40"
                      />
                    ) : (
                      <div
                        key={uid}
                        title={name}
                        className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[9px] text-red-600 ring-2 ring-red-500/40"
                      >
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {proposal.rationale && (
        <div className={`${CARD_MUTED} p-2.5 mb-3 rounded-xl`}>
          <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide mb-1">Rationale</p>
          <p className="text-xs text-[var(--text-secondary)]">{proposal.rationale}</p>
        </div>
      )}

      {/* List / Map toggle — flight only (MapView already supports flightCards). */}
      {showMapToggle && (
        <div className="flex justify-end mb-2">
          <div
            className="flex gap-1 rounded-xl p-1"
            style={{ backgroundColor: "var(--card)", border: "0.5px solid var(--border)" }}
          >
            {(["list", "map"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                aria-pressed={viewMode === m}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize"
                style={{
                  backgroundColor: viewMode === m ? "var(--gold)" : "transparent",
                  color: viewMode === m ? "#fff" : "var(--text-secondary)",
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {showMapToggle && viewMode === "map" && (
        <div
          className="mb-3 rounded-2xl overflow-hidden border"
          style={{ borderColor: "var(--border)", height: 480 }}
        >
          <MapView
            pins={[]}
            label="Flight"
            flightCards={options
              .map((o) => o.card as unknown as FlightRecommendationCard)
              .filter((c) => c?.flight)}
          />
        </div>
      )}

      {/* Option cards */}
      {!(showMapToggle && viewMode === "map") && (
      <div className="flex flex-col gap-2 mb-3">
        {options.map((o, idx) => {
          const card = o.card;
          const tally = tallies.find((t) => t.option_id === o.id);
          const approvedBy = tally?.approved_by ?? [];
          const approvedCount = approvedBy.length;
          const approvedPct = memberCount > 0 ? Math.round((approvedCount / memberCount) * 100) : 0;
          const shownAvatars = approvedBy.slice(0, 3);
          const overflowAvatars = approvedCount - shownAvatars.length;
          const isMyPick = myVote?.vote === "approve" && myVote.option_id === o.id;
          const isWinner = mode === "accepted" && winnerId === o.id;
          const loading = voting === o.id;

          if (roomType === "flight") {
            const fCard = card as unknown as FlightRecommendationCard;
            const flight = fCard.flight;
            const clickable = canPickOption && voting === null;
            const handleCardClick = () => {
              if (!clickable) return;
              if (isMyPick) {
                withdrawVote(o.id);
              } else {
                vote("approve", o.id);
              }
            };
            return (
              <div
                key={o.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-pressed={clickable ? isMyPick : undefined}
                onClick={handleCardClick}
                onKeyDown={(e) => {
                  if (!clickable) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCardClick();
                  }
                }}
                className={`rounded-2xl transition-shadow ${clickable ? "cursor-pointer hover:ring-2 hover:ring-[var(--gold)]/40" : ""} ${
                  isWinner
                    ? "ring-2 ring-emerald-500/60"
                    : isMyPick
                      ? "ring-2 ring-[var(--gold)]"
                      : ""
                } ${loading ? "opacity-60" : ""}`}
              >
                <FlightCard card={fCard} index={idx} hideBookingActions />
                <div className="px-4 pb-3 pt-1 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isWinner && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white whitespace-nowrap"
                        title="Group picked this option"
                      >
                        ✓ Picked
                      </span>
                    )}
                    {isMyPick && !isWinner && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--gold)] text-white whitespace-nowrap"
                        title="You picked this — click card again to unpick"
                      >
                        ✓ Your pick
                      </span>
                    )}
                    {approvedCount > 0 && (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 whitespace-nowrap"
                        title={`${approvedCount} of ${memberCount} picked this`}
                      >
                        {approvedCount} · {approvedPct}%
                      </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      {shownAvatars.map((uid) => {
                        const p = memberProfiles[uid];
                        const name = p?.display_name ?? `@${p?.profile_code ?? uid.slice(-6)}`;
                        return p?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={uid}
                            src={p.avatar_url}
                            alt={name}
                            title={`${name} picked this`}
                            className="w-5 h-5 rounded-full ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                          />
                        ) : (
                          <div
                            key={uid}
                            title={`${name} picked this`}
                            className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                          >
                            {name.slice(0, 1).toUpperCase()}
                          </div>
                        );
                      })}
                      {overflowAvatars > 0 && (
                        <div
                          title={`${overflowAvatars} more picked this`}
                          className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1"
                        >
                          +{overflowAvatars}
                        </div>
                      )}
                    </div>
                  </div>
                  {flight?.booking_link && (
                    <a
                      href={flight.booking_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[13px] font-semibold text-[var(--gold)] hover:underline whitespace-nowrap"
                    >
                      View details ↗
                    </a>
                  )}
                </div>
              </div>
            );
          }

          if (roomType === "activity") {
            const aCard = card as unknown as ActivityRecommendationCard;
            const activity = aCard.activity;
            const clickable = canPickOption && voting === null;
            const handleCardClick = () => {
              if (!clickable) return;
              if (isMyPick) {
                withdrawVote(o.id);
              } else {
                vote("approve", o.id);
              }
            };
            return (
              <div
                key={o.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-pressed={clickable ? isMyPick : undefined}
                onClick={handleCardClick}
                onKeyDown={(e) => {
                  if (!clickable) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCardClick();
                  }
                }}
                className={`rounded-2xl transition-shadow ${clickable ? "cursor-pointer hover:ring-2 hover:ring-[var(--gold)]/40" : ""} ${
                  isWinner
                    ? "ring-2 ring-emerald-500/60"
                    : isMyPick
                      ? "ring-2 ring-[var(--gold)]"
                      : ""
                } ${loading ? "opacity-60" : ""}`}
              >
                <ActivityCard card={aCard} index={idx} hideBookingActions />
                <div className="px-4 pb-3 pt-1 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isWinner && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white whitespace-nowrap"
                        title="Group picked this option"
                      >
                        ✓ Picked
                      </span>
                    )}
                    {isMyPick && !isWinner && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--gold)] text-white whitespace-nowrap"
                        title="You picked this — click card again to unpick"
                      >
                        ✓ Your pick
                      </span>
                    )}
                    {approvedCount > 0 && (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 whitespace-nowrap"
                        title={`${approvedCount} of ${memberCount} picked this`}
                      >
                        {approvedCount} · {approvedPct}%
                      </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      {shownAvatars.map((uid) => {
                        const p = memberProfiles[uid];
                        const name = p?.display_name ?? `@${p?.profile_code ?? uid.slice(-6)}`;
                        return p?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={uid}
                            src={p.avatar_url}
                            alt={name}
                            title={`${name} picked this`}
                            className="w-5 h-5 rounded-full ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                          />
                        ) : (
                          <div
                            key={uid}
                            title={`${name} picked this`}
                            className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                          >
                            {name.slice(0, 1).toUpperCase()}
                          </div>
                        );
                      })}
                      {overflowAvatars > 0 && (
                        <div
                          title={`${overflowAvatars} more picked this`}
                          className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1"
                        >
                          +{overflowAvatars}
                        </div>
                      )}
                    </div>
                  </div>
                  {activity?.booking_link && (
                    <a
                      href={activity.booking_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[13px] font-semibold text-[var(--gold)] hover:underline whitespace-nowrap"
                    >
                      View on SeatGeek ↗
                    </a>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={o.id}
              className={`rounded-xl border overflow-hidden transition-colors ${
                isWinner
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : isMyPick
                    ? "border-[var(--gold)] bg-[var(--gold)]/10"
                    : "border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              {roomType === "hotel" && (() => {
                const h = (card as { hotel?: { name?: string; thumbnail?: string; images?: string[]; booking_link?: string } }).hotel;
                const imgs = (h?.images && h.images.length > 0)
                  ? h.images
                  : (h?.thumbnail ? [h.thumbnail] : []);
                const link = h?.booking_link;
                return (
                  <div className="border-b border-[var(--border)]">
                    <PhotoCarousel
                      images={imgs}
                      alt={h?.name ?? "Hotel"}
                      heightClass="h-40"
                      emptyEmoji="🏨"
                      cornerAction={
                        link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="View hotel details"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[11px] font-medium ring-1 ring-white/20 shadow-lg transition-colors"
                          >
                            <span aria-hidden>↗</span>
                            <span>View details</span>
                          </a>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })()}
              {roomType === "restaurant" && (() => {
                const r = (card as { restaurant?: { name?: string; image_url?: string; images?: string[] } }).restaurant;
                const imgs = (r?.images && r.images.length > 0)
                  ? r.images
                  : (r?.image_url ? [r.image_url] : []);
                return (
                  <div className="border-b border-[var(--border)]">
                    <PhotoCarousel images={imgs} alt={r?.name ?? "Restaurant"} heightClass="h-40" emptyEmoji="🍽️" />
                  </div>
                );
              })()}
              <div className="p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                {roomType === "hotel" ? (
                  (() => {
                    const h = (card as { hotel?: { name?: string; star_rating?: number; neighborhood?: string; address?: string; price_per_night?: number; rating?: number; review_count?: number } }).hotel;
                    const starCount = typeof h?.star_rating === "number" ? Math.min(5, Math.max(0, Math.round(h.star_rating))) : 0;
                    const area = h?.neighborhood || h?.address?.split(",")[0];
                    const price = typeof h?.price_per_night === "number" && h.price_per_night > 0 ? `$${h.price_per_night}/night` : null;
                    return (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {h?.name ?? "—"}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {starCount > 0 && (
                            <span className="text-[11px] text-[var(--gold)]">
                              {"★".repeat(starCount)}{"☆".repeat(5 - starCount)}
                            </span>
                          )}
                          {typeof h?.rating === "number" && h.rating > 0 && (
                            <span className="text-[11px] text-[var(--gold)]">
                              ⭐ {h.rating.toFixed(1)}
                              {h.review_count ? (
                                <span className="text-[var(--text-muted)]"> ({h.review_count.toLocaleString()})</span>
                              ) : null}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                          {[area, price].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {card.restaurant?.name ?? "—"}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {card.restaurant?.cuisine} · {card.restaurant?.price} ·{" "}
                      {card.restaurant?.address?.split(",")[0]}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isWinner && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white whitespace-nowrap"
                      title="Group picked this option"
                    >
                      ✓ Picked
                    </span>
                  )}
                  {approvedCount > 0 && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 whitespace-nowrap"
                      title={`${approvedCount} of ${memberCount} picked this`}
                    >
                      {approvedCount} · {approvedPct}%
                    </span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {shownAvatars.map((uid) => {
                      const p = memberProfiles[uid];
                      const name = p?.display_name ?? `@${p?.profile_code ?? uid.slice(-6)}`;
                      return p?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={uid}
                          src={p.avatar_url}
                          alt={name}
                          title={`${name} picked this`}
                          className="w-5 h-5 rounded-full ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                        />
                      ) : (
                        <div
                          key={uid}
                          title={`${name} picked this`}
                          className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                        >
                          {name.slice(0, 1).toUpperCase()}
                        </div>
                      );
                    })}
                    {overflowAvatars > 0 && (
                      <div
                        title={`${overflowAvatars} more picked this`}
                        className="w-5 h-5 rounded-full bg-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-secondary)] ring-2 ring-[var(--card)] -ml-1"
                      >
                        +{overflowAvatars}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {card.why_recommended && (
                <p className={`text-[11px] text-[var(--text-secondary)] leading-relaxed ${historical ? "" : "mb-2"}`}>
                  {card.why_recommended}
                </p>
              )}
              {canPickOption && (
                <button
                  onClick={() => vote("approve", o.id)}
                  disabled={voting !== null}
                  className={`w-full py-2 rounded-xl border text-xs font-medium disabled:opacity-40 transition-colors ${
                    isMyPick
                      ? "border-[var(--gold)] bg-[var(--gold)] text-white"
                      : "border-[var(--border)] text-[var(--text-secondary)] bg-[var(--card)] hover:border-[var(--gold)]"
                  }`}
                >
                  {loading ? "…" : isMyPick ? "Picked ✓ — click to change below" : "Pick this one"}
                </button>
              )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Aggregate decline / request-changes (apply to the whole slate) */}
      {mode === "active" && (
      <div className="flex gap-2">
        <button
          onClick={() => vote("decline", null)}
          disabled={voting !== null}
          className={`flex-1 py-2 rounded-xl border text-xs transition-colors ${
            myVote?.vote === "decline"
              ? "border-red-500/40 bg-red-500/10 text-red-600"
              : "border-[var(--border)] text-[var(--text-muted)] hover:border-red-500/40"
          } disabled:opacity-40`}
        >
          {voting === "decline" ? "…" : myVote?.vote === "decline" ? "Declined all" : "Decline all"}
        </button>
        <button
          onClick={() => vote("request_changes", null)}
          disabled={voting !== null}
          className={`flex-1 py-2 rounded-xl border text-xs transition-colors ${
            myVote?.vote === "request_changes"
              ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--gold)]/40"
          } disabled:opacity-40`}
        >
          {voting === "request_changes" ? "…" : myVote?.vote === "request_changes" ? "Change requested" : "Request changes"}
        </button>
      </div>
      )}

      {mode === "active" && missingVoters > 0 && (
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          Waiting on {missingVoters} more vote{missingVoters === 1 ? "" : "s"}.
        </p>
      )}

      {mode === "active" && isCreator && missingVoters > 0 && voterCount >= 1 && (
        <button
          type="button"
          onClick={finalizeNow}
          disabled={finalizing}
          className="mt-2 w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline decoration-[var(--border)] hover:decoration-[var(--gold)] disabled:opacity-40"
        >
          {finalizing ? "Finalizing…" : "Finalize now →"}
        </button>
      )}

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// ── Accepted proposal + execute panel ─────────────────────────────────────────

function AcceptedBlock({
  proposal, roomId, roomType, context, isPayer, status, bookingJobId, approvalRule, memberCount, refresh,
}: {
  proposal: DecisionRoomProposal & { votes: DecisionRoomVote[] };
  roomId: string;
  roomType: string;
  context: Record<string, unknown>;
  isPayer: boolean;
  status: string;
  bookingJobId: string | null;
  approvalRule: ApprovalRule;
  memberCount: number;
  refresh: () => void;
}) {
  const isHotel = roomType === "hotel";
  const isFlight = roomType === "flight";
  const isActivity = roomType === "activity";
  // Pick the winning option from the tallies; fall back to the first option
  // (legacy single-card proposals are treated as a single option by extractOptions).
  const options = extractOptions(proposal);
  const tallies = tallyVotes(options, proposal.votes);
  let winnerId: string | null = null;
  if (approvalRule === "unanimous") {
    winnerId = tallies.find((t) => t.approved_by.length === memberCount)?.option_id ?? null;
  } else {
    let best: (typeof tallies)[number] | null = null;
    for (const t of tallies) {
      if (t.approved_by.length * 2 > memberCount) {
        if (!best || t.approved_by.length > best.approved_by.length) best = t;
      }
    }
    winnerId = best?.option_id ?? null;
  }
  const card =
    (options.find((o) => o.id === winnerId)?.card as RecommendationCard | undefined) ??
    (options[0]?.card as RecommendationCard | undefined) ??
    ({} as RecommendationCard);
  // Per-scenario display label — used in status banners and CTA copy.
  const hotelCard = card as unknown as { hotel?: { name?: string } };
  const flightCard = card as unknown as {
    flight?: { airline?: string; flight_number?: string; departure_airport?: string; arrival_airport?: string };
  };
  const activityCard = card as unknown as {
    activity?: { title?: string; short_title?: string; datetime_display?: string; venue_name?: string };
  };
  const flightLabel = (() => {
    const f = flightCard.flight;
    if (!f) return "flight";
    const airline = f.airline ?? "Flight";
    const route = f.departure_airport && f.arrival_airport ? ` ${f.departure_airport}→${f.arrival_airport}` : "";
    const num = f.flight_number ? ` ${f.flight_number}` : "";
    return `${airline}${num}${route}`.trim();
  })();
  const activityLabel = (() => {
    const a = activityCard.activity;
    if (!a) return "event";
    return a.short_title ?? a.title ?? "event";
  })();
  const targetName = isHotel
    ? hotelCard.hotel?.name ?? "hotel"
    : isFlight
      ? flightLabel
      : isActivity
        ? activityLabel
        : card.restaurant?.name ?? "restaurant";
  const targetNameCapitalized = isHotel
    ? hotelCard.hotel?.name ?? "Hotel"
    : isFlight
      ? flightLabel
      : isActivity
        ? activityLabel
        : card.restaurant?.name ?? "Restaurant";
  // Hotel stays are group-level defaults from room.context_json. The payer
  // can still tweak them here before kicking off the booking — saves a trip
  // back to the room editor for a one-day typo.
  const hotelInitial = useMemo(() => {
    if (!isHotel) return { checkIn: "", checkOut: "", guests: Math.max(1, memberCount) };
    const ctx = context as {
      check_in?: string;
      check_out?: string;
      guests?: number;
      date_window?: { from?: string | null; to?: string | null } | null;
    };
    return {
      checkIn: ctx.check_in ?? ctx.date_window?.from ?? "",
      checkOut: ctx.check_out ?? ctx.date_window?.to ?? "",
      guests: ctx.guests ?? Math.max(1, memberCount),
    };
  }, [isHotel, context, memberCount]);
  const [checkIn, setCheckIn] = useState(hotelInitial.checkIn);
  const [checkOut, setCheckOut] = useState(hotelInitial.checkOut);
  const [guests, setGuests] = useState(hotelInitial.guests);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  // Default covers = current joined count. Payer can still override for
  // cases like bringing a child (no seat) or a non-member joining on site.
  const [covers, setCovers] = useState(Math.max(1, memberCount));

  // Flight defaults — mirror the hotel pattern. Authoritative source is
  // room.context_json (set at creation); Payer can still tweak here.
  const flightInitial = useMemo(() => {
    if (!isFlight) return { depDate: "", retDate: "", isRT: false, passengers: Math.max(1, memberCount) };
    const ctx = context as {
      departure_date?: string;
      return_date?: string;
      is_round_trip?: boolean;
      passengers?: number;
      date_window?: { from?: string | null; to?: string | null } | null;
    };
    return {
      depDate: ctx.departure_date ?? ctx.date_window?.from ?? "",
      retDate: ctx.return_date ?? ctx.date_window?.to ?? "",
      isRT: Boolean(ctx.is_round_trip),
      passengers: ctx.passengers ?? Math.max(1, memberCount),
    };
  }, [isFlight, context, memberCount]);
  const [depDate, setDepDate] = useState(flightInitial.depDate);
  const [retDate, setRetDate] = useState(flightInitial.retDate);
  const [isRT, setIsRT] = useState(flightInitial.isRT);
  const [flightPassengers, setFlightPassengers] = useState(flightInitial.passengers);

  // Activity defaults — num_tickets from context_json; Payer can bump for
  // guest or dependent tickets. Event identity / date is fixed by the accepted
  // proposal card, so there's nothing date-related to override here.
  const activityInitial = useMemo(() => {
    if (!isActivity) return { numTickets: Math.max(1, memberCount) };
    const ctx = context as { num_tickets?: number };
    return { numTickets: ctx.num_tickets ?? Math.max(1, memberCount) };
  }, [isActivity, context, memberCount]);
  const [numTickets, setNumTickets] = useState(activityInitial.numTickets);

  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const router = useRouter();

  async function undoApproval() {
    if (undoing) return;
    setUndoing(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/proposals/${proposal.id}/vote`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Undo failed" }));
        setErr(msg ?? "Couldn't undo approval.");
        return;
      }
      refresh();
    } finally {
      setUndoing(false);
    }
  }

  // Live-fetch the referenced booking job (if any) so the UI can distinguish
  // "running" from "failed" from "deleted" instead of blindly showing
  // "Booking in progress" forever.
  type LiveJob = {
    id: string;
    status: "pending" | "running" | "done" | "failed";
    steps: BookingJobStep[];
  };
  const [liveJob, setLiveJob] = useState<LiveJob | null | "missing" | "loading">(
    bookingJobId ? "loading" : null
  );
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!bookingJobId) { setLiveJob(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function poll() {
      try {
        const res = await fetch(`/api/booking-jobs/${bookingJobId}`);
        if (cancelled) return;
        if (res.status === 404) {
          setLiveJob("missing");
          if (timer) clearInterval(timer);
          // Auto-clean: tell the server to drop the dangling reference so
          // refreshing the room state renders the date form again.
          if (isPayer) {
            fetch(`/api/rooms/${roomId}/clear-booking`, { method: "POST" })
              .then(() => refresh())
              .catch(() => { /* best effort */ });
          }
          return;
        }
        if (!res.ok) return;
        const { job } = await res.json() as { job: LiveJob };
        setLiveJob(job);
        // Stop polling once terminal.
        if ((job.status === "done" || job.status === "failed") && timer) {
          clearInterval(timer);
        }
      } catch { /* network hiccup — try again next tick */ }
    }
    poll();
    timer = setInterval(poll, 4000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [bookingJobId, roomId, isPayer, refresh]);

  async function retryBooking() {
    if (!isPayer || clearing) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/clear-booking`, { method: "POST" });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Clear failed" }));
        setErr(msg ?? "Couldn't clear previous booking.");
        return;
      }
      refresh();
    } finally {
      setClearing(false);
    }
  }

  // Booking started — branch by job status.
  if (bookingJobId) {
    const step = liveJob && typeof liveJob === "object" ? liveJob.steps?.[0] : undefined;
    const jobStatus = liveJob && typeof liveJob === "object" ? liveJob.status : null;
    const stepStatus = step?.status;
    const failed =
      jobStatus === "failed" ||
      stepStatus === "error" ||
      stepStatus === "no_availability";
    const needsConfirm = stepStatus === "awaiting_confirmation";
    const succeeded = jobStatus === "done" || stepStatus === "done";

    if (failed) {
      return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 mb-4">
          <p className="text-sm font-medium text-red-600 mb-1">
            ⚠️ Booking didn&apos;t complete
          </p>
          <p className="text-xs text-red-500/90 mb-3">
            {step?.error ?? "The agent couldn't finish the reservation."}
            {isPayer ? " You can retry below or open Tasks for the full log." : ""}
          </p>
          {isPayer && (
            <div className="flex gap-2">
              <button
                onClick={retryBooking}
                disabled={clearing}
                className={`flex-1 py-2.5 ${CTA}`}
              >
                {clearing ? "Resetting…" : "🔄 Retry booking"}
              </button>
              <button
                onClick={() => router.push(getTaskWorkspaceHref({ id: bookingJobId, status: "failed" }))}
                className={`flex-1 py-2.5 ${CTA_GHOST}`}
              >
                View log →
              </button>
            </div>
          )}
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>
      );
    }

    if (needsConfirm) {
      return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-4">
          <p className="text-sm font-medium text-amber-600 mb-1">
            ⏸ Awaiting your confirmation
          </p>
          <p className="text-xs text-amber-600/90 mb-3">
            {isPayer
              ? "The form is pre-filled in the browser — review and submit it there. The window stays open for 15 minutes."
              : "The payer is reviewing the pre-filled form."}
          </p>
          {isPayer && (
            <div className="flex gap-2">
              <button
                onClick={() => router.push(getTaskWorkspaceHref({
                  id: bookingJobId,
                  status: "done",
                  awaiting_confirmation_count: 1,
                }))}
                className={`flex-1 py-2.5 ${CTA}`}
              >
                Open Tasks →
              </button>
              <button
                onClick={retryBooking}
                disabled={clearing}
                className={`flex-1 py-2.5 ${CTA_GHOST}`}
              >
                {clearing ? "Resetting…" : "Retry from scratch"}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (succeeded) {
      return (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-4">
          <p className="text-sm font-medium text-emerald-600 mb-1">
            ✅ Booking confirmed
          </p>
          <p className="text-xs text-emerald-600/90 mb-3">
            {targetNameCapitalized} — the reservation is locked in.
          </p>
          {isPayer && (
            <button
              onClick={() => router.push(getTaskWorkspaceHref({ id: bookingJobId, status: "done" }))}
              className={`w-full py-2.5 ${CTA_GHOST}`}
            >
              View details →
            </button>
          )}
        </div>
      );
    }

    // Default: still running / pending / status unknown.
    return (
      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 mb-4">
        <p className="text-sm font-medium text-indigo-600 mb-1">
          🤖 Booking in progress
        </p>
        <p className="text-xs text-indigo-500 mb-3">
          {isPayer
            ? `${targetNameCapitalized} — the agent is filling out the reservation now. Open Tasks to see live steps and logs.`
            : `${targetNameCapitalized} — the payer is booking. You'll be notified when it's done.`}
        </p>
        {isPayer && (
          <button
            onClick={() => router.push(getTaskWorkspaceHref({ id: bookingJobId, status: "running" }))}
            className={`w-full py-2.5 ${CTA}`}
          >
            View booking status →
          </button>
        )}
      </div>
    );
  }

  async function start() {
    if (isHotel) {
      if (!checkIn || !checkOut) { setErr("Pick check-in and check-out dates."); return; }
      if (checkIn >= checkOut) { setErr("Check-out must be after check-in."); return; }
      if (!guests || guests < 1) { setErr("Guests must be at least 1."); return; }
    } else if (isFlight) {
      if (!depDate) { setErr("Pick a departure date."); return; }
      if (isRT && !retDate) { setErr("Round-trip needs a return date."); return; }
      if (isRT && retDate && retDate <= depDate) { setErr("Return date must be after departure."); return; }
      if (!flightPassengers || flightPassengers < 1) { setErr("Passengers must be at least 1."); return; }
    } else if (isActivity) {
      if (!numTickets || numTickets < 1) { setErr("Need at least 1 ticket."); return; }
    } else {
      if (!date || !time || !covers) { setErr("Pick a date, time, and party size."); return; }
    }
    setStarting(true);
    setErr(null);
    setNeedsProfile(false);
    try {
      // Reuse the payer's persistent session_id (same key /tasks reads from)
      // so this booking job shows up in the "Tasks" list with full step logs.
      let sessionId = window.localStorage.getItem("session_id");
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        window.localStorage.setItem("session_id", sessionId);
      }
      const payload: Record<string, unknown> = { session_id: sessionId };
      if (isHotel) {
        payload.check_in = checkIn;
        payload.check_out = checkOut;
        payload.guests = guests;
      } else if (isFlight) {
        payload.departure_date = depDate;
        payload.is_round_trip = isRT;
        if (isRT) payload.return_date = retDate;
        payload.passengers = flightPassengers;
      } else if (isActivity) {
        payload.num_tickets = numTickets;
      } else {
        payload.date = date;
        payload.time = time;
        payload.covers = covers;
      }
      const res = await fetch(`/api/rooms/${roomId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Start failed" }));
        if (res.status === 412) {
          setNeedsProfile(true);
          setErr(null);
        } else {
          setErr(msg ?? "Couldn't start booking.");
        }
        return;
      }
      const { job_id } = await res.json() as { job_id: string };
      router.push(getTaskWorkspaceHref({ id: job_id, status: "running" }));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-4">
      <p className="text-sm font-medium text-emerald-600 mb-1">
        ✅ Ready to book — {targetName}
      </p>
      {!isPayer && (
        <p className="text-xs text-emerald-600/80">
          {isHotel
            ? "Waiting on the payer to trigger the booking."
            : isFlight
              ? "Waiting on the payer to confirm dates and trigger the booking."
              : isActivity
                ? "Waiting on the payer to confirm ticket count and trigger the booking."
                : "Waiting on the payer to confirm date/time and trigger the booking."}
        </p>
      )}

      {isPayer && status !== "executing" && isHotel && (
        <div className="mt-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 mb-2">
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Check-in</span>
                <input
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Check-out</span>
                <input
                  type="date"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Guests</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={guests}
                  onChange={(e) => setGuests(Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))}
                  className={INPUT}
                />
              </label>
            </div>
            <p className="text-[10px] text-emerald-600/70 mt-2">
              Defaults come from the room context — tweak here if anything&apos;s off.
            </p>
          </div>
          <button
            onClick={start}
            disabled={starting}
            className={`w-full py-2.5 ${CTA}`}
          >
            {starting ? "Starting…" : "🤖 Start booking →"}
          </button>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          {needsProfile && (
            <div className="mt-3 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl p-3">
              <p className="text-xs font-medium text-[var(--gold)] mb-1">
                Booking profile missing
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                You need a default booking profile (name / email / phone) before
                the agent can fill the reservation form. Takes 30 seconds.
              </p>
              <Link
                href="/account?tab=profiles"
                className="inline-block py-2 px-3 rounded-lg bg-[var(--gold)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Open Settings → My Profile
              </Link>
            </div>
          )}
        </div>
      )}

      {isPayer && status !== "executing" && isFlight && (
        <div className="mt-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setIsRT(false)}
                className={`flex-1 py-1.5 rounded-lg border text-xs transition-colors ${
                  !isRT ? "border-emerald-500 bg-emerald-500/15 text-emerald-600" : "border-[var(--border)] text-[var(--text-muted)] hover:border-emerald-500/40"
                }`}
              >
                One-way
              </button>
              <button
                type="button"
                onClick={() => setIsRT(true)}
                className={`flex-1 py-1.5 rounded-lg border text-xs transition-colors ${
                  isRT ? "border-emerald-500 bg-emerald-500/15 text-emerald-600" : "border-[var(--border)] text-[var(--text-muted)] hover:border-emerald-500/40"
                }`}
              >
                Round-trip
              </button>
            </div>
            <div className={`grid gap-2 ${isRT ? "grid-cols-3" : "grid-cols-2"}`}>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Departure</span>
                <input
                  type="date"
                  value={depDate}
                  onChange={(e) => setDepDate(e.target.value)}
                  className={INPUT}
                />
              </label>
              {isRT && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Return</span>
                  <input
                    type="date"
                    value={retDate}
                    onChange={(e) => setRetDate(e.target.value)}
                    className={INPUT}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-emerald-600/80">Passengers</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={flightPassengers}
                  onChange={(e) => setFlightPassengers(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
                  className={INPUT}
                />
              </label>
            </div>
            <p className="text-[10px] text-emerald-600/70 mt-2">
              Defaults come from the room context — tweak here if anything&apos;s off.
            </p>
          </div>
          <button
            onClick={start}
            disabled={starting}
            className={`w-full py-2.5 ${CTA}`}
          >
            {starting ? "Starting…" : "🤖 Start booking →"}
          </button>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          {needsProfile && (
            <div className="mt-3 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl p-3">
              <p className="text-xs font-medium text-[var(--gold)] mb-1">
                Booking profile missing
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                You need a default booking profile (name / email / phone) before
                the agent can fill the reservation form. Takes 30 seconds.
              </p>
              <Link
                href="/account?tab=profiles"
                className="inline-block py-2 px-3 rounded-lg bg-[var(--gold)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Open Settings → My Profile
              </Link>
            </div>
          )}
        </div>
      )}

      {isPayer && status !== "executing" && isActivity && (
        <div className="mt-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 mb-2">
            {activityCard.activity?.datetime_display && (
              <p className="text-[11px] text-emerald-600/80 mb-2">
                🗓️ {activityCard.activity.datetime_display}
                {activityCard.activity.venue_name ? ` · ${activityCard.activity.venue_name}` : ""}
              </p>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-emerald-600 flex-1">Number of tickets</label>
              <button
                type="button"
                onClick={() => setNumTickets(Math.max(1, numTickets - 1))}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] text-sm hover:border-[var(--gold)] transition-colors"
              >−</button>
              <span className="text-sm font-medium w-6 text-center text-[var(--text-primary)]">{numTickets}</span>
              <button
                type="button"
                onClick={() => setNumTickets(Math.min(10, numTickets + 1))}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] text-sm hover:border-[var(--gold)] transition-colors"
              >+</button>
            </div>
            <p className="text-[10px] text-emerald-600/70 mt-2">
              Event and date are locked to the accepted option — change ticket count only.
            </p>
          </div>
          <button
            onClick={start}
            disabled={starting}
            className={`w-full py-2.5 ${CTA}`}
          >
            {starting ? "Starting…" : "🤖 Start booking →"}
          </button>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          {needsProfile && (
            <div className="mt-3 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl p-3">
              <p className="text-xs font-medium text-[var(--gold)] mb-1">
                Booking profile missing
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                You need a default booking profile (name / email / phone) before
                the agent can buy the tickets. Takes 30 seconds.
              </p>
              <Link
                href="/account?tab=profiles"
                className="inline-block py-2 px-3 rounded-lg bg-[var(--gold)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Open Settings → My Profile
              </Link>
            </div>
          )}
        </div>
      )}

      {isPayer && status !== "executing" && !isHotel && !isFlight && !isActivity && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-emerald-600 flex-1">Party size</label>
            <button
              type="button"
              onClick={() => setCovers(Math.max(1, covers - 1))}
              className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] text-sm hover:border-[var(--gold)] transition-colors"
            >−</button>
            <span className="text-sm font-medium w-6 text-center text-[var(--text-primary)]">{covers}</span>
            <button
              type="button"
              onClick={() => setCovers(Math.min(12, covers + 1))}
              className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] text-sm hover:border-[var(--gold)] transition-colors"
            >+</button>
          </div>
          <button
            onClick={start}
            disabled={starting}
            className={`w-full py-2.5 ${CTA}`}
          >
            {starting ? "Starting…" : "🤖 Start booking →"}
          </button>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          {needsProfile && (
            <div className="mt-3 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl p-3">
              <p className="text-xs font-medium text-[var(--gold)] mb-1">
                Booking profile missing
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                You need a default booking profile (name / email / phone) before
                the agent can fill the reservation form. Takes 30 seconds.
              </p>
              <Link
                href="/account?tab=profiles"
                className="inline-block py-2 px-3 rounded-lg bg-[var(--gold)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Open Settings → My Profile
              </Link>
            </div>
          )}
        </div>
      )}

      {status !== "executing" && status !== "done" && (
        <div className="mt-3 pt-3 border-t border-emerald-500/20">
          <button
            onClick={undoApproval}
            disabled={undoing}
            className="text-[11px] text-emerald-600/70 hover:text-emerald-600 underline underline-offset-2 disabled:opacity-40"
          >
            {undoing ? "Reopening voting…" : "↶ Change my pick — reopen voting"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

function ChatPanel({
  roomId, userId, members, memberProfiles,
}: {
  roomId: string;
  userId: string;
  members: { user_id: string }[];
  memberProfiles: Record<string, UserProfile>;
}) {
  const [messages, setMessages] = useState<DecisionRoomMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const memberShort = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.user_id] = memberDisplayName(m.user_id, memberProfiles);
    }
    return map;
  }, [members, memberProfiles]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`);
      if (!res.ok) return;
      const data = await res.json() as { messages: DecisionRoomMessage[] };
      setMessages(data.messages);
    } catch { /* noop */ }
  }, [roomId]);

  useEffect(() => {
    fetchMessages();
    const i = setInterval(fetchMessages, 4000);
    return () => clearInterval(i);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
      });
      if (res.ok) {
        setText("");
        fetchMessages();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`${CARD} p-4 mb-4`}>
      {/* Header — eyebrow + member count */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            Chat
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {members.length} {members.length === 1 ? "member" : "members"}
            {messages.length > 0 && (
              <>
                <span className="mx-1.5 opacity-40">·</span>
                {messages.length} {messages.length === 1 ? "message" : "messages"}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Messages — taller, breathable, with avatars */}
      <div className="min-h-[280px] max-h-[60vh] overflow-y-auto flex flex-col gap-3 mb-3 pr-1 -mr-1">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-8 text-center">
            <div>
              <p className="text-3xl opacity-25 mb-2">💬</p>
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                No messages yet
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[240px]">
                Anyone in the room can chat here. The agent will narrate what it&apos;s doing too.
              </p>
            </div>
          </div>
        )}
        {messages.map((m) => {
          const agent = m.sender_id === null;
          const mine = m.sender_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], {
            hour: "numeric", minute: "2-digit", hour12: true,
          });
          const otherName = agent
            ? "Onegent"
            : memberShort[m.sender_id ?? ""] ?? "Member";
          const initial = otherName.charAt(0).toUpperCase();
          return (
            <div
              key={m.id}
              className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"} items-start`}
            >
              {/* Avatar — agent / other (not shown for self) */}
              {!mine && (
                <div
                  className={`mt-4 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${
                    agent
                      ? "bg-blue-500/15 border border-blue-500/30 text-blue-600"
                      : "bg-[var(--card-2)] border border-[var(--border)] text-[var(--text-secondary)]"
                  }`}
                  aria-hidden
                >
                  {agent ? "🤖" : initial}
                </div>
              )}

              {/* Bubble + meta column */}
              <div className={`flex flex-col max-w-[78%] min-w-0 ${mine ? "items-end" : "items-start"}`}>
                {!mine && (
                  <span
                    className={`text-[10px] font-semibold mb-1 px-1 ${
                      agent
                        ? "text-blue-600 uppercase tracking-[0.08em]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {otherName}
                  </span>
                )}
                <div
                  className={`text-[13px] leading-relaxed rounded-2xl px-3.5 py-2 break-words ${
                    agent
                      ? "bg-blue-500/10 text-blue-700 border border-blue-500/15"
                      : mine
                        ? "bg-[var(--text-primary)] text-[var(--bg)]"
                        : "bg-[var(--card-2)] text-[var(--text-primary)] border border-[var(--border)]"
                  }`}
                  title={new Date(m.created_at).toLocaleString()}
                >
                  {m.content}
                </div>
                <span className={`text-[10px] text-[var(--text-muted)] mt-1 px-1 ${mine ? "text-right" : ""}`}>
                  {time}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="flex gap-2 items-stretch">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Say something…  (Enter to send)"
          maxLength={2000}
          className={`flex-1 ${INPUT}`}
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className={`px-5 py-2 ${CTA}`}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
