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
  DecisionRoomStatus,
  DecisionRoomVote,
  UserProfile,
} from "@/lib/db";
import type { RecommendationCard } from "@/lib/types";
import { extractOptions, resolveAcceptedOption, tallyVotes } from "@/lib/rooms/proposal-shape";
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

  const submittedCount = constraints.filter((c) => c.submitted).length;

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
      <div className="max-w-md mx-auto px-5 py-6">
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

        <RoomActionsMenu
          roomId={room.id}
          creatorId={room.creator_id}
          myUserId={userId}
          status={room.status}
          members={members}
          memberProfiles={member_profiles}
          refresh={refresh}
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
          pendingByUser={pendingByUser}
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

        {/* Last rejected round — shown while the room is back in collecting
            so members can see what was proposed / who voted for what before
            deciding to regenerate. Must sit ABOVE ProposeButton so the
            "Generate proposal" CTA appears below the rejected option cards. */}
        {!activeProposal && !acceptedProposal && lastRejectedProposal && room.status === "collecting" && (
          <ProposalCard
            proposal={lastRejectedProposal}
            roomId={room.id}
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
            userId={userId}
            memberCount={members.length}
            approvalRule={room.approval_rule ?? "unanimous"}
            memberProfiles={member_profiles}
            isCreator={isCreator}
            refresh={refresh}
            mode={acceptedProposal && !activeProposal ? "accepted" : "active"}
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
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-3"
      >
        ← All rooms
      </button>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] leading-tight flex-1">{title}</h1>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-1 ${s.tone}`}>
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
  const canDelete = isCreator && isArchived;
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

  return (
    <div className="relative mb-3 flex justify-end">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setTransferPickerOpen(false); }}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded-lg border border-[var(--border)]"
        aria-label="Room actions"
      >
        ⋯ Actions
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 z-20 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
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
  proposal, roomId, userId, memberCount, approvalRule, memberProfiles, isCreator, refresh, mode = "active",
}: {
  proposal: DecisionRoomProposal & { votes: DecisionRoomVote[] };
  roomId: string;
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

      {/* Option cards */}
      <div className="flex flex-col gap-2 mb-3">
        {options.map((o) => {
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
          return (
            <div
              key={o.id}
              className={`rounded-xl border p-3 transition-colors ${
                isWinner
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : isMyPick
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
          );
        })}
      </div>

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
  // Default covers = current joined count. Payer can still override for
  // cases like bringing a child (no seat) or a non-member joining on site.
  const [covers, setCovers] = useState(Math.max(1, memberCount));
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
        ✅ Ready to book — {card.restaurant?.name ?? "restaurant"}
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
