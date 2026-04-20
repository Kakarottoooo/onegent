"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CITIES_SORTED, DEFAULT_CITY } from "@/lib/cities";
import { useAuth } from "@/app/hooks/useAuth";
import { CARD, CTA, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";
import AirportAutocomplete from "@/components/AirportAutocomplete";

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
  { id: "hotel",      label: "Hotel",      emoji: "🏨", phase: 1 },
  { id: "flight",     label: "Flight",     emoji: "✈️", phase: 1 },
  { id: "activity",   label: "Activity",   emoji: "🎟️", phase: 2 },
] as const;

type CabinClass = "economy" | "premium_economy" | "business" | "first";

const CABIN_OPTIONS: Array<{ id: CabinClass; label: string }> = [
  { id: "economy", label: "Economy" },
  { id: "premium_economy", label: "Premium" },
  { id: "business", label: "Business" },
  { id: "first", label: "First" },
];

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
  const [guests, setGuests] = useState<number>(2); // hotel-only — defaults to 2, UI caps at 8
  // Flight-only state
  const [departureCity, setDepartureCity] = useState("");
  const [arrivalCity, setArrivalCity] = useState("");
  const [isRoundTrip, setIsRoundTrip] = useState(true);
  const [passengers, setPassengers] = useState<number>(2); // caps at 9
  const [cabinClass, setCabinClass] = useState<CabinClass>("economy");
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
    if (type !== "restaurant" && type !== "hotel" && type !== "flight") {
      setError("That room type isn't supported yet.");
      return;
    }
    if (type === "hotel") {
      if (!dateFrom || !dateTo) {
        setError("Hotel rooms need check-in and check-out dates.");
        return;
      }
      if (dateTo <= dateFrom) {
        setError("Check-out has to be after check-in.");
        return;
      }
      if (!guests || guests < 1) {
        setError("Need at least one guest.");
        return;
      }
    }
    if (type === "flight") {
      if (!departureCity.trim()) { setError("Flight rooms need a departure city."); return; }
      if (!arrivalCity.trim()) { setError("Flight rooms need a destination city."); return; }
      if (!dateFrom) { setError("Flight rooms need a departure date."); return; }
      if (isRoundTrip) {
        if (!dateTo) { setError("Round-trip flights need a return date."); return; }
        if (dateTo <= dateFrom) { setError("Return date has to be after the departure date."); return; }
      }
      if (!passengers || passengers < 1) { setError("Need at least one passenger."); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      // Shared fields for both scenarios. Hotel adds check_in/check_out/guests so
      // the merge-then-search pipeline and execute route can read them directly.
      const context: Record<string, unknown> = {
        city_id: city,
        date_window: dateFrom || dateTo ? { from: dateFrom || null, to: dateTo || null } : null,
      };
      if (type === "hotel") {
        context.check_in = dateFrom;
        context.check_out = dateTo;
        context.guests = guests;
      }
      if (type === "flight") {
        context.departure_city = departureCity.trim();
        context.arrival_city = arrivalCity.trim();
        context.departure_date = dateFrom;
        context.is_round_trip = isRoundTrip;
        if (isRoundTrip && dateTo) context.return_date = dateTo;
        context.passengers = passengers;
        context.cabin_class = cabinClass;
      }
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title.trim(),
          context,
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
      <div className="max-w-md md:max-w-xl lg:max-w-2xl mx-auto px-5 md:px-6 py-8">
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

        {/* City — hidden for flight rooms (Departure city is authoritative) */}
        {type !== "flight" && (
          <>
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
          </>
        )}

        {/* Flight-only: route + round-trip toggle */}
        {type === "flight" && (
          <>
            <label className={LABEL}>Departure</label>
            <AirportAutocomplete
              value={departureCity}
              onChange={setDepartureCity}
              placeholder="Type city name, IATA code, or airport"
              className="mb-4"
            />

            <label className={LABEL}>Destination</label>
            <AirportAutocomplete
              value={arrivalCity}
              onChange={setArrivalCity}
              placeholder="Type city name, IATA code, or airport"
              className="mb-4"
            />

            <label className={LABEL}>Trip type</label>
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                type="button"
                onClick={() => setIsRoundTrip(true)}
                className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  isRoundTrip ? OPTION_ACTIVE : OPTION_IDLE
                }`}
              >
                Round trip
              </button>
              <button
                type="button"
                onClick={() => setIsRoundTrip(false)}
                className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  !isRoundTrip ? OPTION_ACTIVE : OPTION_IDLE
                }`}
              >
                One-way
              </button>
            </div>
          </>
        )}

        {/* Date window — required for hotel (check-in/out) and flight (departure / optional return), optional for restaurant. */}
        <label className={LABEL}>
          {type === "hotel"
            ? "Check-in / Check-out"
            : type === "flight"
              ? isRoundTrip ? "Departure / Return" : "Departure date"
              : "When?"}{" "}
          {type !== "hotel" && type !== "flight" && (
            <span className="text-[var(--text-muted)]">(optional)</span>
          )}
        </label>
        <div className="flex gap-2 mb-5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label={type === "hotel" ? "Check-in" : type === "flight" ? "Departure" : "From"}
            className={`flex-1 ${INPUT_LG}`}
          />
          {(type !== "flight" || isRoundTrip) && (
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={type === "hotel" ? "Check-out" : type === "flight" ? "Return" : "To"}
              className={`flex-1 ${INPUT_LG}`}
            />
          )}
        </div>

        {/* Hotel-only: guest count drives the search and the booking job. */}
        {type === "hotel" && (
          <>
            <label className={LABEL}>Guests</label>
            <input
              type="number"
              min={1}
              max={8}
              value={guests}
              onChange={(e) => setGuests(Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 1)))}
              className={`${INPUT_LG} mb-5`}
            />
          </>
        )}

        {/* Flight-only: passengers + cabin class floor */}
        {type === "flight" && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className={LABEL}>Passengers</label>
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={passengers}
                  onChange={(e) => setPassengers(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
                  className={INPUT_LG}
                />
              </div>
              <div>
                <label className={LABEL}>Cabin (floor)</label>
                <select
                  value={cabinClass}
                  onChange={(e) => setCabinClass(e.target.value as CabinClass)}
                  className={INPUT_LG}
                >
                  {CABIN_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] -mt-3 mb-5">
              Cabin floor = minimum class the group will accept. Individual members can still ask for higher in their constraints.
            </p>
          </>
        )}

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
            <p className="text-[11px] text-[var(--text-muted)] mb-1">
              {effectiveRule === "unanimous"
                ? "Everyone must approve the same option."
                : "More than half of members must approve."}
              {ruleOverride === null && " Default for groups is majority."}
            </p>
            {effectiveRule === "unanimous" && (
              <p className="text-[11px] text-amber-600 mb-5">
                ⚠ A single member can veto every option — use with care.
              </p>
            )}
            {effectiveRule === "majority" && <div className="mb-5" />}
          </>
        )}

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
