"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionReview } from "@/lib/action-gateway/types";

export function ApprovalPanel({ review }: { review: ActionReview }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = review.approvalRequest?.status === "PENDING";

  async function post(path: string, mode: "approve" | "reject" | "verify") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerId: "demo-human-reviewer",
          reviewerComment: comment.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Action Gateway request failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action Gateway request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-1)]">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Approval panel</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Approving runs mock execution only, then verifies the observed demo state.
        </p>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex items-center justify-between rounded-lg bg-[var(--card-2)] px-3 py-2">
          <span>Approval status</span>
          <strong>{review.approvalRequest?.status ?? "not required"}</strong>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[var(--card-2)] px-3 py-2">
          <span>Action status</span>
          <strong>{review.action.status}</strong>
        </div>
      </div>

      {pending ? (
        <>
          <label className="mt-5 block text-sm font-semibold" htmlFor="reviewer-comment">
            Reviewer comment
          </label>
          <textarea
            id="reviewer-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm outline-none focus:border-[var(--gold)]"
            placeholder="Reason for approval or rejection..."
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post(`/api/action-gateway/actions/${review.action.id}/approve`, "approve")}
              className="rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--gold-text)] disabled:opacity-60"
            >
              {busy === "approve" ? "Approving..." : "Approve and mock execute"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post(`/api/action-gateway/actions/${review.action.id}/reject`, "reject")}
              className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold disabled:opacity-60"
            >
              {busy === "reject" ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4 text-sm text-[var(--text-secondary)]">
          {review.blocked
            ? "This action was blocked by policy before execution."
            : "No pending human approval is available for this action."}
        </div>
      )}

      {!pending && review.action.status !== "CANCELLED" && review.action.status !== "REJECTED" ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => post(`/api/action-gateway/actions/${review.action.id}/verify`, "verify")}
          className="mt-4 rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold disabled:opacity-60"
        >
          {busy === "verify" ? "Verifying..." : "Run mock verification again"}
        </button>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
