/**
 * Unit tests for `lib/profile-gap-on-save.ts`.
 *
 * Covers the 2 control-flow contracts codex's hardening brief asked for:
 *   PB-SAVE-1: PATCH success → refetch → resume booking (happy path)
 *   PB-SAVE-2: PATCH failure → throw, NO refetch, NO booking resume
 *
 * Plus 2 defensive variants:
 *   PB-SAVE-3: refetch returns null → notify, no booking resume
 *   PB-SAVE-4: refetch throws → notify, no booking resume
 */

import { describe, it, expect, vi } from "vitest";
import { makeProfileGapOnSave } from "../profile-gap-on-save";
import type { CommitResponse } from "@/components/ConfirmCard";
import type { GapSavePayload } from "@/components/profile-gap/types";

const PENDING_PAYLOAD: CommitResponse = {
  ok: true,
  kind: "direct_booking",
  venue_name: "Carbone",
  scenario: "restaurant",
};

const FRESH_PROFILE = {
  id: 42,
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  phone: "+15555550100",
};

const SAVED_PAYLOAD: GapSavePayload = {
  values: {
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone: "+15555550100",
  },
  skipped: [],
};

describe("makeProfileGapOnSave — PB-SAVE-1: happy path", () => {
  it("PATCH success → refetch → startBooking with fresh profile", async () => {
    const dispatchProfilePatch = vi.fn().mockResolvedValue(true);
    const refetchProfile = vi.fn().mockResolvedValue(FRESH_PROFILE);
    const startBooking = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    await onSave(SAVED_PAYLOAD);

    expect(dispatchProfilePatch).toHaveBeenCalledOnce();
    expect(dispatchProfilePatch).toHaveBeenCalledWith(SAVED_PAYLOAD.values);
    expect(refetchProfile).toHaveBeenCalledOnce();
    expect(startBooking).toHaveBeenCalledOnce();
    expect(startBooking).toHaveBeenCalledWith(PENDING_PAYLOAD, FRESH_PROFILE);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("makeProfileGapOnSave — PB-SAVE-2: PATCH failure throws and stops", () => {
  it("PATCH returns false → throws, no refetch, no startBooking", async () => {
    const dispatchProfilePatch = vi.fn().mockResolvedValue(false);
    const refetchProfile = vi.fn();
    const startBooking = vi.fn();
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    await expect(onSave(SAVED_PAYLOAD)).rejects.toThrow(
      "Profile wasn't saved",
    );

    expect(dispatchProfilePatch).toHaveBeenCalledOnce();
    // Critical: refetch must NOT fire when PATCH failed.
    expect(refetchProfile).not.toHaveBeenCalled();
    expect(startBooking).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("makeProfileGapOnSave — PB-SAVE-3: refetch null → notify, no resume", () => {
  it("PATCH success + refetch returns null → notify, no startBooking", async () => {
    const dispatchProfilePatch = vi.fn().mockResolvedValue(true);
    const refetchProfile = vi.fn().mockResolvedValue(null);
    const startBooking = vi.fn();
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    await onSave(SAVED_PAYLOAD);

    expect(dispatchProfilePatch).toHaveBeenCalledOnce();
    expect(refetchProfile).toHaveBeenCalledOnce();
    expect(startBooking).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[0]).toMatch(/couldn't reload/);
  });
});

describe("makeProfileGapOnSave — PB-SAVE-4: refetch throws → notify, no resume", () => {
  it("PATCH success + refetch rejects → notify, no startBooking", async () => {
    const dispatchProfilePatch = vi.fn().mockResolvedValue(true);
    const refetchProfile = vi.fn().mockRejectedValue(new Error("network"));
    const startBooking = vi.fn();
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    // No throw — we catch refetch failures internally and notify the user
    // instead. Throwing here would cause ProfileGapCard to enter its
    // "save failed" state, but the profile actually IS saved; only the
    // booking resume hit a network blip.
    await onSave(SAVED_PAYLOAD);

    expect(dispatchProfilePatch).toHaveBeenCalledOnce();
    expect(refetchProfile).toHaveBeenCalledOnce();
    expect(startBooking).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[0]).toMatch(/network hiccup/);
  });
});

describe("makeProfileGapOnSave — call ordering invariants", () => {
  it("never calls startBooking before dispatchProfilePatch resolves", async () => {
    const order: string[] = [];
    const dispatchProfilePatch = vi.fn(async () => {
      order.push("dispatch");
      return true;
    });
    const refetchProfile = vi.fn(async () => {
      order.push("refetch");
      return FRESH_PROFILE;
    });
    const startBooking = vi.fn(async () => {
      order.push("start");
    });
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    await onSave(SAVED_PAYLOAD);

    expect(order).toEqual(["dispatch", "refetch", "start"]);
  });

  it("does not call refetch or startBooking on PATCH failure even with resolved fakes for them", async () => {
    const dispatchProfilePatch = vi.fn().mockResolvedValue(false);
    // These are pre-resolved so a buggy implementation that fired them
    // would still satisfy the await — we want assertions to fail.
    const refetchProfile = vi.fn().mockResolvedValue(FRESH_PROFILE);
    const startBooking = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    const onSave = makeProfileGapOnSave({
      dispatchProfilePatch,
      refetchProfile,
      startBooking,
      notify,
      pendingPayload: PENDING_PAYLOAD,
    });

    await expect(onSave(SAVED_PAYLOAD)).rejects.toThrow();

    expect(refetchProfile).not.toHaveBeenCalled();
    expect(startBooking).not.toHaveBeenCalled();
  });
});
