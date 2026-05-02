"use client";

/**
 * Top-of-panel status banner. Shown only when the timeline is in a state
 * the user needs to act on (paused / terminal). Hidden during idle/running.
 */

import type { TimelineStatus } from "./types";

interface Props {
  status: TimelineStatus;
  /** Optional details — e.g. OTP channel name, failure reason. */
  detail?: string;
  /** Primary CTA — visual style depends on status tone. */
  primaryAction?: { label: string; onClick: () => void };
  /** Secondary action — usually "View raw log" or "Cancel". */
  secondaryAction?: { label: string; onClick: () => void };
}

interface Recipe {
  tone: "pause" | "success" | "warning" | "error";
  icon: string;
  title: string;
  body: (detail: string | undefined) => string;
}

const RECIPES: Partial<Record<TimelineStatus, Recipe>> = {
  needs_otp: {
    tone: "pause",
    icon: "⏸",
    title: "Waiting for verification code",
    body: (d) =>
      d
        ? `The agent paused while we wait for the OTP from ${d}.`
        : "The agent paused while we wait for a verification code.",
  },
  needs_login: {
    tone: "pause",
    icon: "⏸",
    title: "Login required",
    body: () =>
      "The agent paused at the sign-in step. Open the site to authenticate, then resume.",
  },
  ready_for_confirmation: {
    tone: "success",
    icon: "🟢",
    title: "Ready — review and confirm",
    body: () =>
      "All booking details are filled in. Review the snapshots and confirm to finalize.",
  },
  no_availability: {
    tone: "warning",
    icon: "✗",
    title: "No availability",
    body: (d) => d ?? "The agent could not find availability for the requested target.",
  },
  failed: {
    tone: "error",
    icon: "✗",
    title: "Run failed",
    body: (d) => d ?? "The run stopped before reaching a hand-off or payment-ready state.",
  },
};

export default function StatusBanner({
  status,
  detail,
  primaryAction,
  secondaryAction,
}: Props) {
  const recipe = RECIPES[status];
  if (!recipe) return null; // running / idle / connecting → no banner

  return (
    <div className={`task-timeline__banner task-timeline__banner--${recipe.tone}`} role="status">
      <span className="task-timeline__banner-icon" aria-hidden>
        {recipe.icon}
      </span>
      <div className="task-timeline__banner-text">
        <p className="task-timeline__banner-title">{recipe.title}</p>
        <p className="task-timeline__banner-body">{recipe.body(detail)}</p>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="task-timeline__banner-actions">
          {secondaryAction && (
            <button
              type="button"
              className="task-timeline__banner-action task-timeline__banner-action--secondary"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
          {primaryAction && (
            <button
              type="button"
              className="task-timeline__banner-action task-timeline__banner-action--primary"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
