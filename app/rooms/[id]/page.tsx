"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DecisionRoomVote,
  UserProfile,
} from "@/lib/db";
import type { RecommendationCard } from "@/lib/types";
import { extractOptions, tallyVotes } from "@/lib/rooms/proposal-shape";
import { CARD, CARD_MUTED, CTA, CTA_GHOST, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

type MyConstraint = {
  budget_max?: number;
  cuisines_like?: string[];
  cuisines_dislike?: string[];
  dietary?: string[];
  vibe?: "casual" | "romantic" | "lively" | "quiet" | "upscale";
  time_preference?: string;
  notes?: string;
};

const VIBES = ["casual", "romantic", "lively", "quiet", "upscale"] as const;
const DIETARY_OPTIONS = ["vegetarian", "vegan", "gluten-free", "halal", "kosher", "no raw fish"];

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
  const payerId = room.payer_id ?? room.creator_id;
  const isPayer = userId === payerId;
  const isCreator = userId === room.creator_id;

  const submittedCount = constraints.filter((c) => c.submitted).length;

  // Contact set for the "save as contact" button. Version tick triggers reload.
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [contactsVersion, setContactsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contacts");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { contacts: Array<{ contact_user_id: string }> };
        if (!cancelled) setContactIds(new Set(data.contacts.map((c) => c.contact_user_id)));
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [contactsVersion]);
  const reloadContacts = useCallback(() => setContactsVersion((v) => v + 1), []);

  return (
    <div className={`${PAGE} pb-24`}>
      <GlobalNav active="rooms" />
      <div className="max-w-md mx-auto px-5 py-6">
        <HeaderBar
          title={room.title}
          status={room.status}
          shortCode={room.short_code}
        />

        <MembersStrip
          members={members}
          memberProfiles={member_profiles}
          constraints={constraints}
          creatorId={room.creator_id}
          payerId={payerId}
          activeProposal={activeProposal}
          myUserId={userId}
          contactIds={contactIds}
          onContactAdded={reloadContacts}
        />

        {/* Constraint form — expanded while collecting; collapsed hint once
            voting opens so the proposal gets visual priority. */}
        {(room.status === "collecting" || room.status === "proposing") && (
          <ConstraintForm
            roomId={room.id}
            initial={myConstraint}
            refresh={refresh}
          />
        )}
        {room.status === "approving" && (
          <ConstraintForm
            roomId={room.id}
            initial={myConstraint}
            refresh={refresh}
            collapsedByDefault
          />
        )}

        {/* Propose button — shown while collecting once >=2 submitted */}
        {room.status === "collecting" && submittedCount >= 2 && (
          <ProposeButton roomId={room.id} refresh={refresh} />
        )}

        {room.status === "proposing" && (
          <div className={`${CARD} p-4 mb-4 text-center`}>
            <p className="text-sm text-[var(--text-secondary)]">🧭 Finding a place that works for everyone…</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">This can take up to a minute.</p>
          </div>
        )}

        {/* Active proposal + voting */}
        {activeProposal && (
          <ProposalCard
            proposal={activeProposal}
            roomId={room.id}
            userId={userId}
            memberCount={members.length}
            approvalRule={room.approval_rule ?? "unanimous"}
            memberProfiles={member_profiles}
            refresh={refresh}
          />
        )}

        {/* Accepted proposal + execute (payer only) */}
        {acceptedProposal && room.status !== "done" && (
          <AcceptedBlock
            proposal={acceptedProposal}
            roomId={room.id}
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

        {/* Chat */}
        <ChatPanel
          roomId={room.id}
          userId={userId}
          members={members}
          memberProfiles={member_profiles}
        />

        {/* Creator footnote */}
        {isCreator && room.status === "collecting" && (
          <p className="text-[11px] text-[var(--text-muted)] mt-4 text-center">
            You&apos;re the creator. {isPayer ? "You'll pay for this one." : "Partner will pay."}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Header bar ────────────────────────────────────────────────────────────────

function HeaderBar({
  title, status, shortCode,
}: { title: string; status: string; shortCode: string }) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/rooms/join/${shortCode}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
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
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-3"
      >
        ← All rooms
      </button>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] leading-tight flex-1">{title}</h1>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-1 ${s.tone}`}>
          {s.text}
        </span>
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

// ── Members strip ─────────────────────────────────────────────────────────────

function memberDisplayName(userId: string, profiles: Record<string, UserProfile>): string {
  return profiles[userId]?.display_name ?? `@${profiles[userId]?.profile_code ?? userId.slice(-6)}`;
}

function MembersStrip({
  members, memberProfiles, constraints, creatorId, payerId, activeProposal,
  myUserId, contactIds, onContactAdded,
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
  onContactAdded: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function saveContact(targetId: string) {
    setSaving(targetId);
    try {
      const res = await fetch("/api/contacts/by-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetId }),
      });
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
          }

          return (
            <div key={m.user_id} className="flex items-center gap-1.5 bg-[var(--card-2)] border border-[var(--border)] rounded-full pl-1 pr-2.5 py-1">
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
              {m.user_id !== myUserId && !contactIds.has(m.user_id) && (
                <button
                  type="button"
                  onClick={() => saveContact(m.user_id)}
                  disabled={saving === m.user_id}
                  title="Save as contact"
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-40"
                >
                  {saving === m.user_id ? "…" : "+"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Constraint form ───────────────────────────────────────────────────────────

function ConstraintForm({
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
        <p className="text-sm font-semibold text-[var(--text-primary)]">Your constraints</p>
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

// ── Propose button ────────────────────────────────────────────────────────────

function ProposeButton({ roomId, refresh }: { roomId: string; refresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function propose() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/propose`, { method: "POST" });
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
      <button
        onClick={propose}
        disabled={loading}
        className={`w-full py-3 ${CTA}`}
      >
        {loading ? "Finding a place…" : "🧭 Generate proposal →"}
      </button>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// ── Proposal card + voting ────────────────────────────────────────────────────

function ProposalCard({
  proposal, roomId, userId, memberCount, approvalRule, memberProfiles, refresh,
}: {
  proposal: DecisionRoomProposal & { votes: DecisionRoomVote[] };
  roomId: string;
  userId: string;
  memberCount: number;
  approvalRule: ApprovalRule;
  memberProfiles: Record<string, UserProfile>;
  refresh: () => void;
}) {
  const options = useMemo(() => extractOptions(proposal), [proposal]);
  const tallies = useMemo(() => tallyVotes(options, proposal.votes), [options, proposal.votes]);
  const myVote = proposal.votes.find((v) => v.user_id === userId);
  const totalVoted = proposal.votes.length;

  const [voting, setVoting] = useState<string | null>(null); // in-flight option_id or "decline"
  const [err, setErr] = useState<string | null>(null);

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

  const conflicts = Array.isArray(proposal.conflicts_json)
    ? (proposal.conflicts_json as Array<{ reason: string; affected_users?: string[] }>)
    : [];

  // For "2/3 approved" we count anyone who approved any option.
  const totalApproved = tallies.reduce((acc, t) => acc + t.approved_by.length, 0);

  return (
    <div className={`${CARD} p-4 mb-4`}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-[var(--text-muted)]">
          Agent proposes {options.length > 1 ? `${options.length} options` : "an option"}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {totalApproved}/{memberCount} approved · {approvalRule === "unanimous" ? "unanimous" : "majority"}
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

      {/* Option cards */}
      <div className="flex flex-col gap-2 mb-3">
        {options.map((o) => {
          const card = o.card;
          const tally = tallies.find((t) => t.option_id === o.id);
          const approvedBy = tally?.approved_by ?? [];
          const isMyPick = myVote?.vote === "approve" && myVote.option_id === o.id;
          const loading = voting === o.id;
          return (
            <div
              key={o.id}
              className={`rounded-xl border p-3 transition-colors ${
                isMyPick
                  ? "border-[var(--gold)] bg-[var(--gold)]/10"
                  : "border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {card.restaurant?.name ?? "—"}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    {card.restaurant?.cuisine} · {card.restaurant?.price} ·{" "}
                    {card.restaurant?.address?.split(",")[0]}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {approvedBy.map((uid) => {
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
                </div>
              </div>
              {card.why_recommended && (
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2">
                  {card.why_recommended}
                </p>
              )}
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
            </div>
          );
        })}
      </div>

      {/* Aggregate decline / request-changes (apply to the whole slate) */}
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

      {totalVoted < memberCount && (
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          Waiting on {memberCount - totalVoted} more vote{memberCount - totalVoted === 1 ? "" : "s"}.
        </p>
      )}

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// ── Accepted proposal + execute panel ─────────────────────────────────────────

function AcceptedBlock({
  proposal, roomId, isPayer, status, bookingJobId, approvalRule, memberCount, refresh,
}: {
  proposal: DecisionRoomProposal & { votes: DecisionRoomVote[] };
  roomId: string;
  isPayer: boolean;
  status: string;
  bookingJobId: string | null;
  approvalRule: ApprovalRule;
  memberCount: number;
  refresh: () => void;
}) {
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
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [covers, setCovers] = useState(2);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const router = useRouter();

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
                onClick={() => router.push(`/tasks?jobId=${bookingJobId}`)}
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
                onClick={() => router.push(`/tasks?jobId=${bookingJobId}`)}
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
            {card.restaurant?.name ?? "Restaurant"} — the reservation is locked in.
          </p>
          {isPayer && (
            <button
              onClick={() => router.push(`/tasks?jobId=${bookingJobId}`)}
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
            ? `${card.restaurant?.name ?? "Restaurant"} — the agent is filling out the reservation now. Open Tasks to see live steps and logs.`
            : `${card.restaurant?.name ?? "Restaurant"} — the payer is booking. You'll be notified when it's done.`}
        </p>
        {isPayer && (
          <button
            onClick={() => router.push(`/tasks?jobId=${bookingJobId}`)}
            className={`w-full py-2.5 ${CTA}`}
          >
            View booking status →
          </button>
        )}
      </div>
    );
  }

  async function start() {
    if (!date || !time || !covers) { setErr("Pick a date, time, and party size."); return; }
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
      const res = await fetch(`/api/rooms/${roomId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time, covers, session_id: sessionId }),
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
      router.push(`/tasks?jobId=${job_id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-4">
      <p className="text-sm font-medium text-emerald-600 mb-1">
        ✅ Everyone approved — {card.restaurant?.name ?? "restaurant"}
      </p>
      {!isPayer && (
        <p className="text-xs text-emerald-600/80">
          Waiting on the payer to confirm date/time and trigger the booking.
        </p>
      )}

      {isPayer && status !== "executing" && (
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
                href="/permissions"
                className="inline-block py-2 px-3 rounded-lg bg-[var(--gold)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Open Settings → My Profile
              </Link>
            </div>
          )}
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
    <div className={`${CARD} p-3 mb-4`}>
      <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Chat</p>
      <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5 mb-2">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">No messages yet.</p>
        )}
        {messages.map((m) => {
          const agent = m.sender_id === null;
          const mine = m.sender_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit",
          });
          return (
            <div
              key={m.id}
              className={`text-xs rounded-xl px-2.5 py-1.5 max-w-[85%] ${
                agent
                  ? "bg-blue-500/10 text-blue-600 border border-blue-500/20 self-start italic"
                  : mine
                    ? "bg-[var(--text-primary)] text-[var(--bg)] self-end"
                    : "bg-[var(--card-2)] text-[var(--text-primary)] border border-[var(--border)] self-start"
              }`}
              title={time}
            >
              {agent && <span className="mr-1">🤖</span>}
              {!agent && !mine && (
                <span className="block text-[10px] opacity-60 mb-0.5">
                  {memberShort[m.sender_id ?? ""] ?? "user"} · {time}
                </span>
              )}
              {m.content}
              {mine && (
                <span className="block text-[10px] opacity-60 mt-0.5 text-right">{time}</span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Say something…"
          maxLength={2000}
          className={`flex-1 ${INPUT}`}
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className={`px-4 py-2 ${CTA}`}
        >
          Send
        </button>
      </div>
    </div>
  );
}
