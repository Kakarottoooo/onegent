/**
 * Phase 1 #7 path B — onSave handler factory for the inline ProfileGapCard.
 *
 * Encapsulates the post-Save async chain so it can be unit-tested with
 * mocked deps (no real fetch, no real chat hook):
 *
 *   1. PATCH the profile via the dispatcher.
 *   2. If PATCH failed → throw, do NOT resume booking.
 *   3. If PATCH succeeded → refetch the profile to get server-truth fields.
 *   4. If refetch returned a profile → resume the pending booking.
 *   5. If refetch failed → notify user to retry the booking.
 *
 * Why a builder function (not just a closure inside `app/page.tsx`):
 * - Codex's hardening brief calls out 4 control-flow contracts that need
 *   tests. With deps injection we can mock dispatch / refetch / startBooking
 *   and assert the chain wiring without spinning up a chat session.
 * - Reusable from `/dev/path-b-demo` so the dev fixture exercises the same
 *   path the production homepage does (different deps, identical control
 *   flow).
 *
 * The built handler matches `<ProfileGapCard onSave>`'s signature:
 *   `(saved: GapSavePayload) => Promise<void>`
 *
 * Throwing on PATCH failure is intentional — `<ProfileGapCard>` swallows
 * thrown errors and shows the form's own "save failed" state, which is
 * what we want (user stays on the card and can retry / fix fields).
 */

import type { GapSavePayload } from "@/components/profile-gap/types";
import type { ProfilePatch } from "@/lib/agent/nlu-v2";
import type { CommitResponse } from "@/components/ConfirmCard";

/**
 * Minimal shape we need from the booking profile fetched after PATCH.
 * Concrete types live in `app/page.tsx` (legacy) and various consumers;
 * this trims to just the fields `startBooking` will use.
 */
export interface RefetchedBookingProfile {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface ProfileGapOnSaveDeps {
  /**
   * Dispatcher from `app/page.tsx` (path A's `dispatchProfilePatch`).
   * Returns true on PATCH success, false on any failure (handled errors
   * surfaced to chat by the dispatcher itself).
   */
  dispatchProfilePatch: (patch: ProfilePatch) => Promise<boolean>;
  /**
   * Refetch the user's default booking profile from the server. Caller
   * supplies; we don't reach for `fetch` directly so this module stays
   * pure-DOM-free (testable in node).
   */
  refetchProfile: () => Promise<RefetchedBookingProfile | null>;
  /**
   * Resume the pending direct-booking with the freshly-saved profile.
   * Bound to `app/page.tsx:startDirectBookingWithProfile` in production.
   */
  startBooking: (
    payload: CommitResponse,
    profile: RefetchedBookingProfile,
  ) => Promise<void>;
  /**
   * Inject an assistant chat bubble. Used for the "couldn't reload"
   * fallback when refetch returns null OR throws.
   */
  notify: (msg: string) => void;
  /**
   * The original commit response carried in the chat message — needed
   * to resume the booking after profile is saved.
   */
  pendingPayload: CommitResponse;
}

/**
 * Build the onSave handler. The returned function is what `ProfileGapCard`
 * calls when the user clicks Save.
 *
 * Control flow contracts (codex hardening brief):
 *   - PB-SAVE-1: PATCH succeeds → refetch profile → resume booking.
 *   - PB-SAVE-2: PATCH fails → THROW, no refetch, no booking resume.
 *   - PB-SAVE-3: PATCH succeeds but refetch returns null → notify user,
 *     no booking resume (user can retry the booking from chat).
 *   - PB-SAVE-4: PATCH succeeds but refetch throws → notify user, no
 *     booking resume.
 */
export function makeProfileGapOnSave(
  deps: ProfileGapOnSaveDeps,
): (saved: GapSavePayload) => Promise<void> {
  const {
    dispatchProfilePatch,
    refetchProfile,
    startBooking,
    notify,
    pendingPayload,
  } = deps;

  return async function onSave(saved: GapSavePayload): Promise<void> {
    // Step 1: PATCH the profile. Returns boolean; on false the dispatcher
    // already surfaced an error message to chat.
    //
    // GapFormValues and ProfilePatch are structurally compatible (both
    // are Partial<Record<<canonical-13-keys>, string>>). Cast keeps
    // TypeScript happy without a deep transform.
    const profileSaved = await dispatchProfilePatch(
      saved.values as ProfilePatch,
    );
    if (!profileSaved) {
      // PB-SAVE-2: throw to signal the card to render its "save failed"
      // state. Do NOT proceed to refetch / booking — the user's profile
      // is in an undefined state from the booking layer's POV, and
      // continuing with stale data risks the same gap surfacing again
      // mid-flight on the booking automation layer.
      throw new Error(
        "Profile wasn't saved. Check the message above and try again.",
      );
    }

    // Step 2: refetch the profile so we have server-truth fields, not
    // the in-memory copy that may be missing some defaults.
    let freshProfile: RefetchedBookingProfile | null;
    try {
      freshProfile = await refetchProfile();
    } catch {
      // PB-SAVE-4: refetch hard-failure. Tell the user; they can retry
      // the booking from chat.
      notify(
        "Saved your profile, but the booking step had a network hiccup. Please try the booking again.",
      );
      return;
    }

    if (!freshProfile) {
      // PB-SAVE-3: refetch returned 200 but no profile in body (e.g.
      // db not yet committed, race). User-visible recovery is the same:
      // ask them to retry.
      notify(
        "Saved your profile, but I couldn't reload it to start the booking. Please try the booking again.",
      );
      return;
    }

    // Step 3 (PB-SAVE-1): resume the pending booking.
    await startBooking(pendingPayload, freshProfile);
  };
}
