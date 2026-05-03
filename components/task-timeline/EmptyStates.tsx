"use client";

/**
 * Lightweight non-event states for the panel:
 *   - <ConnectingState />  shown while attaching to live data
 *   - <IdleState />        shown when there's nothing to display yet
 *
 * These are layout-aware skeletons, not full-screen takeovers. The
 * panel header / banner remain visible above them.
 */

export function ConnectingState() {
  return (
    <div className="task-timeline__empty">
      <div className="task-timeline__pulse-dot" aria-hidden />
      <p className="task-timeline__empty-title">Connecting to live agent…</p>
      <p className="task-timeline__empty-body">
        We're attaching to the run. Events and snapshots will populate shortly.
      </p>
    </div>
  );
}

export function IdleState({ message }: { message?: string }) {
  return (
    <div className="task-timeline__empty">
      <p className="task-timeline__empty-title">Nothing to show yet</p>
      <p className="task-timeline__empty-body">
        {message ?? "Once the agent starts, you'll see each step appear here."}
      </p>
    </div>
  );
}
