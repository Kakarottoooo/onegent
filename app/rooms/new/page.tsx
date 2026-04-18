"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CITIES_SORTED, DEFAULT_CITY } from "@/lib/cities";
import { useAuth } from "@/app/hooks/useAuth";
import { CARD, CTA, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

interface Contact {
  contact_user_id: string;
  nickname: string | null;
  profile_code: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Group {
  id: string;
  name: string;
  member_count: number;
}

interface GroupDetail {
  members: Contact[];
}

const ALLOWED_TYPES = [
  { id: "restaurant", label: "Restaurant", emoji: "🍽️", phase: 1 },
  { id: "hotel",      label: "Hotel",      emoji: "🏨", phase: 2 },
  { id: "flight",     label: "Flight",     emoji: "✈️", phase: 2 },
  { id: "activity",   label: "Activity",   emoji: "🎟️", phase: 2 },
] as const;

type RoomType = typeof ALLOWED_TYPES[number]["id"];
type ApprovalRule = "unanimous" | "majority";

// Larger input variant — p-3 instead of tokens.ts INPUT's p-2.
const INPUT_LG =
  "w-full border border-[var(--border)] rounded-xl p-3 text-sm " +
  "bg-[var(--card)] text-[var(--text-primary)] " +
  "placeholder:text-[var(--text-muted)] " +
  "focus:outline-none focus:border-[var(--gold)]";

const LABEL = "text-xs font-medium text-[var(--text-secondary)] block mb-2";

// Selectable option button (active / inactive / disabled).
const OPTION_ACTIVE =
  "border-[var(--gold)] bg-[var(--gold)] text-white";
const OPTION_IDLE =
  "border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] hover:border-[var(--gold)]";
const OPTION_DISABLED =
  "border-[var(--border)] bg-[var(--card-2)] text-[var(--text-muted)] cursor-not-allowed opacity-60";

export default function NewRoomPage() {
  const router = useRouter();
  const { isSignedIn, userId } = useAuth();

  const [type, setType] = useState<RoomType>("restaurant");
  const [title, setTitle] = useState("");
  const [city, setCity] = useState<string>(DEFAULT_CITY);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [payerIsSelf, setPayerIsSelf] = useState(true);

  // Multi-contact + group picker
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [expandingGroupId, setExpandingGroupId] = useState<string | null>(null);

  // Approval rule — auto-default based on expected member count; creator can override.
  const [ruleOverride, setRuleOverride] = useState<ApprovalRule | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    Promise.all([
      fetch("/api/contacts").then((r) => r.ok ? r.json() : { contacts: [] }),
      fetch("/api/groups").then((r) => r.ok ? r.json() : { groups: [] }),
    ])
      .then(([cData, gData]: [{ contacts: Contact[] }, { groups: Group[] }]) => {
        setContacts(cData.contacts ?? []);
        setGroups(gData.groups ?? []);
      })
      .catch(() => { /* noop */ });
  }, [isSignedIn]);

  const totalMembers = selectedContactIds.size + 1; // +1 for creator
  // For N<3, majority (>50%) collapses to "1 of 2 = win" which is essentially
  // unilateral — force unanimous in that case. N≥3 defaults to majority.
  const effectiveRule: ApprovalRule =
    totalMembers < 3
      ? "unanimous"
      : ruleOverride ?? "majority";

  const toggleContact = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandGroup = async (groupId: string) => {
    setExpandingGroupId(groupId);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`);
      if (!res.ok) return;
      const data = (await res.json()) as GroupDetail;
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        for (const m of data.members ?? []) next.add(m.contact_user_id);
        return next;
      });
    } finally {
      setExpandingGroupId(null);
    }
  };

  const contactLabel = useMemo(() => {
    return (c: Contact) => c.nickname ?? c.display_name ?? `@${c.profile_code}`;
  }, []);

  async function submit() {
    if (!title.trim()) { setError("Give it a title so people know what they're joining."); return; }
    if (type !== "restaurant") { setError("Only Restaurant rooms are supported right now."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title.trim(),
          context: {
            city_id: city,
            date_window: dateFrom || dateTo ? { from: dateFrom || null, to: dateTo || null } : null,
            party_size: partySize,
          },
          payer_id: payerIsSelf ? userId : null,
          approval_rule: effectiveRule,
        }),
      });
      if (res.status === 401) { setError("Please sign in first."); return; }
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Couldn't create the room." }));
        setError(msg ?? "Couldn't create the room.");
        return;
      }
      const { room } = await res.json() as { room: { id: string } };

      // Bulk-add selected contacts as members (non-fatal — creator can fall back to short code).
      const toAdd = Array.from(selectedContactIds);
      if (toAdd.length > 0) {
        await Promise.all(
          toAdd.map((cid) =>
            fetch(`/api/rooms/${room.id}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contact_user_id: cid }),
            }).catch(() => { /* non-fatal */ })
          )
        );
      }

      router.push(`/rooms/${room.id}`);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="rooms" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Sign in to create a Decision Room.
            </p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">
              Go to sign in →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <GlobalNav active="rooms" />
      <div className="max-w-md mx-auto px-5 py-8">
        <button
          onClick={() => router.back()}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4"
        >
          ← Back
        </button>

        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
          Start a Decision Room
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          Invite friends or a group. Everyone adds constraints. Agent proposes. You approve. Then it books.
        </p>

        {/* Type */}
        <label className={LABEL}>What are you deciding?</label>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {ALLOWED_TYPES.map((t) => {
            const disabled = t.phase !== 1;
            const active = type === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => setType(t.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  active ? OPTION_ACTIVE : disabled ? OPTION_DISABLED : OPTION_IDLE
                }`}
              >
                <div className="text-lg mb-1">{t.emoji}</div>
                <div className="text-sm font-medium">{t.label}</div>
                {disabled && <div className="text-[10px] mt-0.5 opacity-70">Coming soon</div>}
              </button>
            );
          })}
        </div>

        {/* Title */}
        <label className={LABEL}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Friday date night, anniversary dinner"
          maxLength={80}
          className={`${INPUT_LG} mb-5`}
        />

        {/* City */}
        <label className={LABEL}>City</label>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={`${INPUT_LG} mb-5`}
        >
          {CITIES_SORTED.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        {/* Date window (optional) */}
        <label className={LABEL}>
          When? <span className="text-[var(--text-muted)]">(optional)</span>
        </label>
        <div className="flex gap-2 mb-5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`flex-1 ${INPUT_LG}`}
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={`flex-1 ${INPUT_LG}`}
          />
        </div>

        {/* Groups — one-tap expand */}
        {groups.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Groups <span className="text-[var(--text-muted)]">(adds everyone)</span>
              </label>
              <Link
                href="/contacts"
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
              >
                Manage groups
              </Link>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={expandingGroupId === g.id}
                  onClick={() => expandGroup(g.id)}
                  className="px-2.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--text-primary)] hover:border-[var(--gold)] disabled:opacity-50 transition-colors"
                >
                  👥 {g.name}{" "}
                  <span className="text-[var(--text-muted)]">({g.member_count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Multi-contact picker */}
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Invite contacts{" "}
            {selectedContactIds.size > 0 && (
              <span className="text-[var(--text-primary)]">
                · {selectedContactIds.size} selected
              </span>
            )}
          </label>
          <Link
            href="/contacts"
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
          >
            Manage contacts
          </Link>
        </div>
        {contacts.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)] mb-5">
            No contacts yet. You can still share the invite code after creating the room.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {contacts.map((c) => {
              const active = selectedContactIds.has(c.contact_user_id);
              return (
                <button
                  key={c.contact_user_id}
                  type="button"
                  onClick={() => toggleContact(c.contact_user_id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-colors ${
                    active ? OPTION_ACTIVE : OPTION_IDLE
                  }`}
                >
                  {c.avatar_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="truncate max-w-[120px]">{contactLabel(c)}</span>
                  {active && <span>✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Approval rule — auto-default w/ override. Toggle hidden for N<3. */}
        <label className={LABEL}>
          Approval rule{" "}
          <span className="text-[var(--text-muted)]">
            · {totalMembers} {totalMembers === 1 ? "person" : "people"} total
          </span>
        </label>
        {totalMembers < 3 ? (
          <div className="mb-5">
            <div className={`py-2.5 rounded-xl border text-sm font-medium text-center ${OPTION_ACTIVE}`}>
              Unanimous
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              With {totalMembers === 1 ? "one person" : "two people"}, both must approve. Add a third contact to unlock majority voting.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                onClick={() => setRuleOverride("unanimous")}
                className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  effectiveRule === "unanimous" ? OPTION_ACTIVE : OPTION_IDLE
                }`}
              >
                Unanimous
              </button>
              <button
                type="button"
                onClick={() => setRuleOverride("majority")}
                className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  effectiveRule === "majority" ? OPTION_ACTIVE : OPTION_IDLE
                }`}
              >
                Majority ({'>'}50%)
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-5">
              {effectiveRule === "unanimous"
                ? "Everyone must approve the proposal."
                : "More than half of members must approve."}
              {ruleOverride === null && " Default for groups is majority."}
            </p>
          </>
        )}

        {/* Party size */}
        <label className={LABEL}>Party size</label>
        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => setPartySize(Math.max(1, partySize - 1))}
            className="w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] hover:border-[var(--gold)] transition-colors"
          >
            −
          </button>
          <span className="text-sm font-medium text-[var(--text-primary)] w-8 text-center">
            {partySize}
          </span>
          <button
            type="button"
            onClick={() => setPartySize(Math.min(12, partySize + 1))}
            className="w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--text-primary)] hover:border-[var(--gold)] transition-colors"
          >
            +
          </button>
        </div>

        {/* Payer */}
        <label className={LABEL}>Who&apos;s paying?</label>
        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            type="button"
            onClick={() => setPayerIsSelf(true)}
            className={`py-3 rounded-xl border text-sm font-medium transition-colors ${
              payerIsSelf ? OPTION_ACTIVE : OPTION_IDLE
            }`}
          >
            I am
          </button>
          <button
            type="button"
            onClick={() => setPayerIsSelf(false)}
            className={`py-3 rounded-xl border text-sm font-medium transition-colors ${
              !payerIsSelf ? OPTION_ACTIVE : OPTION_IDLE
            }`}
          >
            They are
          </button>
        </div>
        {!payerIsSelf && (
          <p className="text-xs text-[var(--text-secondary)] -mt-4 mb-5">
            Heads up — only the payer can trigger the final booking. You can change this later.
          </p>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-600 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting || !title.trim()}
          className={`w-full py-3 ${CTA}`}
        >
          {submitting ? "Creating…" : "Create room →"}
        </button>
      </div>
    </div>
  );
}
