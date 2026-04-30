"use client";

import { useState } from "react";
import type { BookingJob } from "@/lib/db";
import {
  DEFAULT_JOB_POLICY,
  type JobModificationPatch,
  type RestaurantConstraints,
} from "@/lib/booking-jobs/types";

/**
 * "Modify" button + popover form for the /tasks job card.
 *
 * Phase 1 minimum: edit time, party_size, time_window_minutes.
 * On submit:
 *   1. POST /api/booking-jobs/[id]/modify with the patch
 *   2. On success show a "Run again" button that POSTs /start
 *   3. Refresh the parent so the card re-renders with new plan_version
 *
 * Restaurant-only for now — the form short-circuits for hotel / flight /
 * activity steps because Phase 1 only lands restaurant constraints.
 */
export function ModifyTaskButton({
  job,
  onRefresh,
}: {
  job: BookingJob;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  // Pull current constraints (preferred) or fall back to step.body.
  const restaurantStep = job.steps.find((s) => s.type === "restaurant");
  const isRestaurant = !!restaurantStep;

  const initialConstraints: Partial<RestaurantConstraints> = (() => {
    if (job.constraints && job.constraints.task_type === "restaurant_booking") {
      return job.constraints;
    }
    const body = (restaurantStep?.body ?? {}) as Record<string, unknown>;
    return {
      task_type: "restaurant_booking",
      city: typeof body.city === "string" ? body.city : "",
      date: typeof body.date === "string" ? body.date : "",
      time: typeof body.time === "string" ? body.time : "",
      party_size: typeof body.covers === "number" ? body.covers : 2,
      restaurant_name:
        typeof body.restaurantName === "string" ? body.restaurantName : "",
    };
  })();

  const initialPolicy =
    job.policy ?? {
      time_window_minutes:
        (job.autonomy_settings?.restaurant?.timeWindowMinutes as 0 | 30 | 60 | 90 | undefined) ??
        DEFAULT_JOB_POLICY.time_window_minutes,
    };

  const [time, setTime] = useState<string>(initialConstraints.time ?? "");
  const [partySize, setPartySize] = useState<number>(initialConstraints.party_size ?? 2);
  const [timeWindow, setTimeWindow] = useState<number>(
    initialPolicy.time_window_minutes ?? 60,
  );

  const isModifiable = job.status !== "running" && job.status !== "done";

  if (!isRestaurant) {
    // Phase 1 doesn't yet support hotel/flight/activity edits.
    return null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const patch: JobModificationPatch = {
        constraints: {
          ...(time !== initialConstraints.time ? { time } : {}),
          ...(partySize !== initialConstraints.party_size ? { party_size: partySize } : {}),
        },
        policy: {
          ...(timeWindow !== initialPolicy.time_window_minutes
            ? { time_window_minutes: timeWindow as 0 | 30 | 60 | 90 }
            : {}),
        },
      };
      const res = await fetch(`/api/booking-jobs/${job.id}/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { plan_version: number };
      setSavedVersion(data.plan_version);
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunAgain() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking-jobs/${job.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      // /start may return 202 (worker route) or kick off in-process.
      // Anything outside [200, 300) we consider a failure surface.
      if (!res.ok && res.status !== 202) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onRefresh?.();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "run again failed");
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          setError(null);
          setSavedVersion(null);
        }}
        disabled={!isModifiable}
        title={
          !isModifiable
            ? `Cannot modify a ${job.status} job`
            : "Edit time / party size / fallback policy"
        }
        className="job-card__cta job-card__cta--open-all"
        style={{ opacity: isModifiable ? 1 : 0.4 }}
      >
        ✎ Modify
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full z-20 mt-2 w-80 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_18px_48px_rgba(44,36,22,0.16)]"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
            Modify task
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            plan_version: {job.plan_version}
            {savedVersion ? ` → ${savedVersion}` : null}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ×
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="text-[var(--text-secondary)]">Time (HH:MM)</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={saving || running}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5 text-[var(--text-primary)]"
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--text-secondary)]">Party size</span>
          <input
            type="number"
            min={1}
            max={20}
            value={partySize}
            onChange={(e) => setPartySize(Number(e.target.value))}
            disabled={saving || running}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5 text-[var(--text-primary)]"
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--text-secondary)]">Time fallback window</span>
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(Number(e.target.value))}
            disabled={saving || running}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5 text-[var(--text-primary)]"
          >
            <option value={0}>None — exact time only</option>
            <option value={30}>± 30 min</option>
            <option value={60}>± 60 min</option>
            <option value={90}>± 90 min</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-700">Error: {error}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        {savedVersion ? (
          <button
            onClick={handleRunAgain}
            disabled={running}
            className="rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[#2C2416] transition hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Starting…" : "▶ Run again"}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[#2C2416] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save patch"}
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--text-secondary)] hover:underline"
        >
          Close
        </button>
      </div>
    </div>
  );
}
