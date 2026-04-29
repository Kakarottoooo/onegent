"use client";

/**
 * CompareTasteModal — "Are we a match?" overlay on /u/[username].
 *
 * Loads the current viewer's taste snapshot AND the profile owner's
 * snapshot in parallel, then renders an overlap view: shared cuisines,
 * shared cities, price-band proximity. Both snapshots are derived ONLY
 * from public artifacts — no private taste profile is consulted.
 *
 * The match comes from explicit, published taste signals (we agreed on
 * X, Y, Z), which is what makes the comparison feel earned rather than
 * algorithmic.
 */

import { useEffect, useState } from "react";

interface Snapshot {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  totals: { decisions: number; bookings: number; public_artifacts: number };
  cuisines: { name: string; count: number }[];
  price_bands: { name: string; count: number }[];
  cities: { name: string; count: number }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Owner of the profile being viewed — the "them" in the comparison. */
  peerHandle: string;
  peerDisplayName: string | null;
}

interface MyProfileResponse {
  profile: { username: string | null; profile_code: string | null };
}

export default function CompareTasteModal({ isOpen, onClose, peerHandle, peerDisplayName }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Snapshot | null>(null);
  const [theirs, setTheirs] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const meRes = await fetch("/api/users/me");
        if (!meRes.ok) {
          setError("Sign in to compare tastes.");
          return;
        }
        const meData = (await meRes.json()) as MyProfileResponse;
        const myHandle =
          meData.profile.username ?? meData.profile.profile_code ?? null;
        if (!myHandle) {
          setError("Set a handle first so we can compare.");
          return;
        }
        const [mineRes, theirsRes] = await Promise.all([
          fetch(`/api/users/${encodeURIComponent(myHandle)}/taste-snapshot`),
          fetch(`/api/users/${encodeURIComponent(peerHandle)}/taste-snapshot`),
        ]);
        if (!mineRes.ok || !theirsRes.ok) {
          setError("Couldn't load taste data.");
          return;
        }
        const mineData = (await mineRes.json()) as Snapshot;
        const theirsData = (await theirsRes.json()) as Snapshot;
        if (!cancelled) {
          setMine(mineData);
          setTheirs(theirsData);
        }
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, peerHandle]);

  if (!isOpen) return null;

  const peerLabel = peerDisplayName ?? `@${peerHandle}`;
  const overlap = mine && theirs ? computeOverlap(mine, theirs) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-0 sm:mx-4 p-6 pb-8"
        style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--gold-text, #5A4416)",
            background: "var(--gold-soft, #F5E9C8)",
            padding: "4px 10px",
            borderRadius: 999,
            marginBottom: 10,
          }}
        >
          Taste compare
        </span>
        <h2
          style={{
            fontFamily: "var(--font-playfair), Georgia, serif",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0a0a0a",
            marginBottom: 6,
            lineHeight: 1.15,
          }}
        >
          You &amp; {peerLabel}
        </h2>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          Based only on what you&apos;ve both shared publicly.
        </p>

        {loading && (
          <p className="text-sm text-gray-400 text-center py-6">Computing match…</p>
        )}
        {error && !loading && (
          <p className="text-sm text-red-600 text-center py-4">{error}</p>
        )}

        {!loading && !error && mine && theirs && overlap && (
          <>
            {/* Headline match score */}
            <div
              className="rounded-2xl p-4 mb-5 text-center"
              style={{
                background: "var(--gold-soft, #F5E9C8)",
                border: "1px solid var(--gold, #C9A84C)",
              }}
            >
              <p
                className="text-3xl font-semibold"
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  color: "var(--gold-text, #5A4416)",
                  margin: 0,
                  letterSpacing: "-0.02em",
                }}
              >
                {overlap.label}
              </p>
              <p className="text-xs text-gray-700 mt-1">{overlap.summary}</p>
            </div>

            <Section title="Cuisines you both like" items={overlap.sharedCuisines} emptyHint="No overlap yet — share more decisions." />
            <Section title="Cities you both visit" items={overlap.sharedCities} emptyHint="No shared cities published." />
            <Section title="Price range overlap" items={overlap.sharedPrices} emptyHint="No shared price bands published." />

            {(mine.totals.public_artifacts === 0 || theirs.totals.public_artifacts === 0) && (
              <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
                {mine.totals.public_artifacts === 0
                  ? "You haven't published anything yet — share a trip to power better matches."
                  : `${peerLabel} hasn't published anything yet — match data is limited.`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, emptyHint }: { title: string; items: string[]; emptyHint: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-700 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span
              key={it}
              className="px-2.5 py-1 rounded-full text-[11px]"
              style={{
                background: "var(--gold-soft, #F5E9C8)",
                color: "var(--gold-text, #5A4416)",
                border: "1px solid var(--gold, #C9A84C)",
              }}
            >
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface OverlapResult {
  label: string;
  summary: string;
  sharedCuisines: string[];
  sharedCities: string[];
  sharedPrices: string[];
}

function computeOverlap(a: Snapshot, b: Snapshot): OverlapResult {
  const aCuisines = new Set(a.cuisines.map((c) => c.name.toLowerCase()));
  const sharedCuisines = b.cuisines.filter((c) => aCuisines.has(c.name.toLowerCase())).map((c) => c.name);

  const aCities = new Set(a.cities.map((c) => c.name.toLowerCase()));
  const sharedCities = b.cities.filter((c) => aCities.has(c.name.toLowerCase())).map((c) => c.name);

  const aPrices = new Set(a.price_bands.map((c) => c.name));
  const sharedPrices = b.price_bands.filter((c) => aPrices.has(c.name)).map((c) => c.name);

  const totalPossible =
    Math.max(a.cuisines.length, b.cuisines.length) +
    Math.max(a.cities.length, b.cities.length) +
    Math.max(a.price_bands.length, b.price_bands.length);
  const totalShared = sharedCuisines.length + sharedCities.length + sharedPrices.length;
  const score = totalPossible === 0 ? 0 : Math.round((totalShared / totalPossible) * 100);

  let label = "Just exploring";
  let summary = "Not much overlap yet — share more to find common ground.";
  if (score >= 60) {
    label = "Strong match";
    summary = "You&apos;ve agreed on a lot of public choices.";
  } else if (score >= 30) {
    label = "Some overlap";
    summary = "A few shared signals — could be a fun outing.";
  } else if (totalShared > 0) {
    label = "Light overlap";
    summary = "A handful of shared notes; needs more data.";
  }

  return { label: `${score}%`, summary: `${label} · ${summary.replace(/&apos;/g, "'")}`, sharedCuisines, sharedCities, sharedPrices };
}
