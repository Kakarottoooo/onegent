/**
 * lib/contacts-match — pure (DB-free) contact matching helpers.
 *
 * The same matcher runs on:
 *   - the server (lib/db.ts resolveContactsByNamesFuzzy → /api/chat/parse)
 *   - the client (components/ConfirmCard inline check → ⚠️ "not a contact")
 *
 * Centralising it here means the @ziweic case can never drift between the
 * two — both paths use identical priority tiers (exact / fuzzy) and the
 * same email-fallback heuristic for picking a preferred display label.
 *
 * No imports from the DB layer. Safe to bundle into client components.
 */

export interface ContactMatchInput {
  user_id: string;
  nickname: string | null;
  username: string | null;
  display_name: string | null;
  profile_code: string;
}

export interface ContactCandidate {
  user_id: string;
  display_name: string | null;
  username: string | null;
  profile_code: string;
  nickname: string | null;
}

export interface FuzzyContactResolution {
  /** The original name token (typically from NLU member_names). */
  name: string;
  /**
   * Set when there is exactly one match (precise OR a single fuzzy
   * candidate). Caller treats this as "definitely this person."
   */
  contact_user_id: string | null;
  /**
   * Display info for the matched contact when contact_user_id is set.
   * Lets the caller substitute the user-typed token (which may have been
   * fuzzy, abbreviated, or a profile_code) with the canonical handle so
   * downstream code (commit's exact-match resolver, proposal cards, audit
   * logs) sees a consistent label.
   */
  matched: ContactCandidate | null;
  /**
   * Populated whenever the resolver couldn't pick a single answer:
   *   - 0 candidates → caller must ask "no one matches, invite?"
   *   - 2+ candidates → caller must ask "which one?"
   * Empty array when contact_user_id is non-null. Each candidate carries
   * display fields the UI needs to render disambiguation chips.
   */
  candidates: ContactCandidate[];
}

/**
 * Heuristic: did Clerk fall back to the user's email when their fullName
 * was empty? (See app/contexts/ClerkSync.tsx — `displayName = fullName ??
 * primaryEmailAddress?.emailAddress`.) In that case display_name looks
 * like an email and *should not* be the user-facing label when a real
 * username exists. Conservative regex so a literal full name "李 明@example"
 * isn't misclassified.
 */
export function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/**
 * Pick the most human-friendly label for a contact. Priority:
 *   1. nickname (owner-defined; highest signal — they renamed this person)
 *   2. display_name iff it's a real name (Clerk falls back to email when
 *      fullName is empty; email is technically a "display_name" in DB but
 *      the user thinks of the person by their handle, not their email)
 *   3. username (Clerk handle, e.g. "ziweic")
 *   4. display_name even if email-fallback (better than the bare profile_code)
 *   5. profile_code
 *   6. null when literally nothing is set (shouldn't happen for a real account)
 */
export function pickPreferredContactLabel(profile: {
  nickname?: string | null;
  username?: string | null;
  display_name?: string | null;
  profile_code?: string | null;
}): string | null {
  const nick = profile.nickname?.trim();
  if (nick) return nick;
  const display = profile.display_name?.trim();
  if (display && !looksLikeEmail(display)) return display;
  const username = profile.username?.trim();
  if (username) return username;
  if (display) return display;
  const code = profile.profile_code?.trim();
  if (code) return code;
  return null;
}

const collapseSeparators = (s: string) =>
  s.toLowerCase().replace(/[\s_-]+/g, "").replace(/^@/, "");
const norm = (s: string | null | undefined) =>
  s == null ? "" : collapseSeparators(s.trim());

function toCandidate(c: ContactMatchInput): ContactCandidate {
  return {
    user_id: c.user_id,
    display_name: c.display_name,
    username: c.username,
    profile_code: c.profile_code,
    nickname: c.nickname,
  };
}

/**
 * Pure matching kernel.
 *
 * Match priority (first wins, per-name independent):
 *   1. Exact (nickname / username / display_name / profile_code,
 *      case-insensitive, with @ stripped from profile_code on both sides)
 *   2. Substring on profile_code OR username — covers "ziwei" inside
 *      "@ziwei_b" or username "ziwei_b" when there is exactly one such
 *      contact
 *   3. Prefix on nickname / username / display_name (target length ≥ 3,
 *      candidate length ≥ target length) — covers "ziwei" → "ZiweiC"
 *   4. Substring on nickname / username / display_name (target length ≥ 3)
 *      — covers "李" → "李明" only if it's the unique match
 *
 * Fuzzy steps require length ≥ 3 to avoid pathological short-prefix
 * collisions (e.g. "AB" matching half the contact list). Underscores,
 * hyphens, and whitespace are stripped from BOTH sides before comparison
 * so "ziwei_b", "ziwei-b", and "ziwei b" collapse to the same key.
 *
 * Returns one entry per input name, in input order.
 */
export function matchContactsFuzzy(
  contacts: ContactMatchInput[],
  names: string[],
): FuzzyContactResolution[] {
  if (names.length === 0) return [];

  return names.map((name) => {
    const target = norm(name);
    if (!target) return { name, contact_user_id: null, matched: null, candidates: [] };

    // Tier 1: precise. As soon as we hit one, we're done — multiple precise
    // matches against the same caller are extremely unlikely and we'd rather
    // commit than block the user with "which 李明?" when the data already
    // disambiguated.
    //
    // username MUST be in this set. When Clerk falls back to email for
    // display_name (no fullName set), the only "ziweic"-shaped field is
    // username — omitting it makes the resolver miss real contacts.
    const exact = contacts.find(
      (c) =>
        norm(c.nickname) === target ||
        norm(c.username) === target ||
        norm(c.display_name) === target ||
        norm(c.profile_code) === target,
    );
    if (exact) {
      return {
        name,
        contact_user_id: exact.user_id,
        matched: toCandidate(exact),
        candidates: [],
      };
    }

    // Tiers 2-4: fuzzy. Require ≥ 3 chars to keep short tokens from sweeping.
    if (target.length < 3) {
      return { name, contact_user_id: null, matched: null, candidates: [] };
    }

    const matchedSet = new Map<string, ContactMatchInput>();
    const remember = (c: ContactMatchInput) => {
      if (!matchedSet.has(c.user_id)) matchedSet.set(c.user_id, c);
    };

    // Tier 2: profile_code / username substring.
    for (const c of contacts) {
      const pc = norm(c.profile_code);
      const un = norm(c.username);
      if (pc.length >= target.length && pc.includes(target)) remember(c);
      if (un.length >= target.length && un.includes(target)) remember(c);
    }
    // Tier 3: nickname / username / display_name prefix.
    for (const c of contacts) {
      const nick = norm(c.nickname);
      const un = norm(c.username);
      const disp = norm(c.display_name);
      if (
        (nick.length >= target.length && nick.startsWith(target)) ||
        (un.length >= target.length && un.startsWith(target)) ||
        (disp.length >= target.length && disp.startsWith(target))
      ) {
        remember(c);
      }
    }
    // Tier 4: nickname / username / display_name substring.
    for (const c of contacts) {
      const nick = norm(c.nickname);
      const un = norm(c.username);
      const disp = norm(c.display_name);
      if (
        (nick.length >= target.length && nick.includes(target)) ||
        (un.length >= target.length && un.includes(target)) ||
        (disp.length >= target.length && disp.includes(target))
      ) {
        remember(c);
      }
    }

    const candidates = Array.from(matchedSet.values()).map(toCandidate);
    if (candidates.length === 1) {
      return {
        name,
        contact_user_id: candidates[0].user_id,
        matched: candidates[0],
        candidates: [],
      };
    }
    return { name, contact_user_id: null, matched: null, candidates };
  });
}
