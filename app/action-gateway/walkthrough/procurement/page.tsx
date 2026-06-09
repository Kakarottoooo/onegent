"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProcurementWalkthroughState } from "@/lib/action-gateway/procurement-walkthrough";
import type { ActionAuditPacket, AuditEvent } from "@/lib/action-gateway/types";

type WalkthroughResponse =
  | { ok: true; walkthrough: ProcurementWalkthroughState | null }
  | { ok: false; error: string };

export default function ProcurementWalkthroughPage() {
  const [walkthrough, setWalkthrough] = useState<ProcurementWalkthroughState | null>(null);
  const [auditPacket, setAuditPacket] = useState<ActionAuditPacket | null>(null);
  const [busy, setBusy] = useState<"load" | "reset" | "approve" | "reject" | "audit" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refreshWalkthrough();
  }, []);

  const review = walkthrough?.review;
  const action = review?.action;
  const approval = review?.approvalRequest;
  const verification = review?.verificationResult;
  const isRejected = action?.status === "REJECTED";
  const isVerified = action?.status === "VERIFIED";
  const pendingApproval = approval?.status === "PENDING";
  const auditEvents = auditPacket?.auditEvents ?? review?.auditEvents ?? [];
  const auditText = useMemo(
    () => auditPacket ? JSON.stringify(auditPacket, null, 2) : "",
    [auditPacket],
  );

  async function refreshWalkthrough() {
    setBusy((current) => current ?? "load");
    setError(null);
    try {
      const res = await fetch("/api/action-gateway/demo/procurement");
      const data = (await res.json()) as WalkthroughResponse;
      if (!res.ok || !data.ok) throw new Error(responseError(data, "Could not load walkthrough"));
      setWalkthrough(data.walkthrough);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load walkthrough");
    } finally {
      setBusy(null);
    }
  }

  async function resetDemo() {
    setBusy("reset");
    setError(null);
    setAuditPacket(null);
    setCopied(false);
    try {
      const res = await fetch("/api/action-gateway/demo/procurement/reset", { method: "POST" });
      const data = (await res.json()) as WalkthroughResponse;
      if (!res.ok || !data.ok || !data.walkthrough) {
        throw new Error(responseError(data, "Could not reset demo"));
      }
      setWalkthrough(data.walkthrough);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset demo");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!action) return;
    setBusy("approve");
    setError(null);
    setAuditPacket(null);
    try {
      await postAction(`/api/action-gateway/actions/${action.id}/approve`, {
        reviewerId: "demo-founder",
        reviewerComment: "Approved in procurement walkthrough.",
      });
      await refreshWalkthrough();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve action");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!action) return;
    setBusy("reject");
    setError(null);
    setAuditPacket(null);
    try {
      await postAction(`/api/action-gateway/actions/${action.id}/reject`, {
        reviewerId: "demo-founder",
        reviewerComment: "Rejected in procurement walkthrough.",
      });
      await refreshWalkthrough();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject action");
    } finally {
      setBusy(null);
    }
  }

  async function exportAuditPacket() {
    if (!action) return;
    setBusy("audit");
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/action-gateway/actions/${action.id}/audit-packet`);
      const packet = (await res.json()) as ActionAuditPacket | { ok: false; error: string };
      if (!res.ok || "ok" in packet) {
        throw new Error("error" in packet ? packet.error : "Could not export audit packet");
      }
      setAuditPacket(packet);
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `onegent-procurement-audit-${packet.actionIntent.businessObjectId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export audit packet");
    } finally {
      setBusy(null);
    }
  }

  async function copyAuditPacket() {
    if (!auditText) return;
    await navigator.clipboard.writeText(auditText);
    setCopied(true);
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/action-gateway" className="text-sm font-semibold text-[var(--gold)]">
              Back to Action Gateway
            </Link>
            <h1 className="mt-4 font-serif text-4xl font-semibold">
              Procurement approval walkthrough
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
              A deterministic three-minute demo: an AI procurement agent proposes
              a $4,850 purchase order, Onegent reviews risk and policy, a human
              approves, the local Mock ERP changes state, verification passes,
              and an audit packet is generated.
            </p>
          </div>
          <button
            type="button"
            onClick={resetDemo}
            disabled={busy !== null}
            className="rounded-lg bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--gold-text)] disabled:opacity-60"
          >
            {walkthrough ? "Reset demo" : "Start demo / Capture action"}
          </button>
        </header>

        {error ? (
          <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <section className="mt-8 grid gap-5">
          <StepCard
            number="1"
            title="Agent proposes purchase order"
            status={walkthrough ? "captured" : "waiting"}
          >
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Fact label="Agent" value="ProcurementAgent" />
              <Fact label="Action type" value="SUBMIT" />
              <Fact label="Target system" value="Mock ERP" />
              <Fact label="Environment" value="demo" />
              <Fact label="Business object" value="PurchaseOrder" />
              <Fact label="PO ID" value="PO-DEMO-4850" />
              <Fact label="Vendor" value="Acme Industrial Supply" />
              <Fact label="Amount" value="$4,850 USD" />
            </div>
            <StateGrid
              before={{
                poNumber: "PO-DEMO-4850",
                status: "DRAFT",
                amount: 4850,
                vendorApproved: true,
              }}
              after={{ status: "SUBMITTED" }}
            />
            <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3 text-sm text-[var(--text-secondary)]">
              Replacement motor needed for Line 3 by Friday. Vendor is approved.
              Lead time meets requirement. Amount exceeds approval threshold.
            </p>
          </StepCard>

          <StepCard
            number="2"
            title="Risk and policy review"
            status={review ? review.riskAssessment.riskLevel : "waiting"}
          >
            {review ? (
              <div className="grid gap-3 md:grid-cols-3">
                <Fact label="Risk level" value={review.riskAssessment.riskLevel} tone="gold" />
                <Fact label="Risk score" value={`${review.riskAssessment.riskScore}/100`} />
                <Fact label="Policy effect" value={approval ? "requires approval" : "allow/block"} />
                <div className="md:col-span-3 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Triggered policy</p>
                  <p className="mt-2 font-semibold">{review.riskAssessment.triggeredPolicies.join(", ")}</p>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                    <li>Amount is over $1,000.</li>
                    <li>Vendor is approved, so the action is not blocked.</li>
                    <li>Demo environment, so no real-world action will occur.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <EmptyStep>Click Start demo to capture the proposed action.</EmptyStep>
            )}
          </StepCard>

          <StepCard
            number="3"
            title="Human approval"
            status={approval?.status ?? "waiting"}
          >
            {review && approval ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
                  <p className="font-semibold">{review.action.title}</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <Fact label="Vendor" value={review.action.vendorName ?? "-"} />
                    <Fact label="Amount" value={`$${review.action.amount?.toLocaleString()} ${review.action.currency}`} />
                    <Fact label="System" value={review.action.targetSystem} />
                  </div>
                  <p className="mt-4 text-sm text-[var(--text-secondary)]">
                    Policy reason: {review.riskAssessment.reasons.join(" ")}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
                  <p className="text-sm text-[var(--text-secondary)]">Approval status</p>
                  <p className="mt-1 text-xl font-semibold">{approval.status}</p>
                  {pendingApproval ? (
                    <div className="mt-4 grid gap-2">
                      <button type="button" onClick={approve} disabled={busy !== null} className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                        Approve
                      </button>
                      <button type="button" onClick={reject} disabled={busy !== null} className="rounded-lg border border-red-400/40 px-4 py-3 text-sm font-semibold text-red-200 disabled:opacity-60">
                        Reject
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--text-secondary)]">
                      {isRejected ? "Rejected actions do not execute. Reset to replay." : "Approval is complete."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyStep>Approval request appears after capture.</EmptyStep>
            )}
          </StepCard>

          <StepCard
            number="4"
            title="Mock execution"
            status={isVerified ? "completed" : isRejected ? "not executed" : "waiting"}
          >
            {walkthrough ? (
              <div className="grid gap-3 md:grid-cols-4">
                <Fact label="Execution method" value="LOCAL_MOCK_ERP" />
                <Fact label="Previous status" value="DRAFT" />
                <Fact label="Current mock PO status" value={walkthrough.purchaseOrder.status} tone={walkthrough.purchaseOrder.status === "SUBMITTED" ? "green" : "gold"} />
                <Fact label="External systems" value="none touched" />
                <Link href={`/mock-systems/procurement/purchase-orders/${walkthrough.purchaseOrder.id}`} className="md:col-span-4 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4 text-sm font-semibold text-[var(--gold)]">
                  Open local Mock ERP purchase order →
                </Link>
              </div>
            ) : (
              <EmptyStep>Mock execution is locked until approval.</EmptyStep>
            )}
          </StepCard>

          <StepCard
            number="5"
            title="Verification"
            status={verification ? (verification.success ? "passed" : "failed") : "waiting"}
          >
            {verification ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Fact label="Verification status" value={verification.success ? "passed" : "failed"} tone={verification.success ? "green" : "gold"} />
                <Fact label="Method" value={verification.verificationMethod} />
                <Fact label="Differences" value={verification.differences.length ? verification.differences.join("; ") : "none"} />
                <JsonBlock title="Expected state" value={verification.expectedState} />
                <JsonBlock title="Observed state" value={verification.observedState} />
              </div>
            ) : (
              <EmptyStep>Verification runs after mock execution.</EmptyStep>
            )}
          </StepCard>

          <StepCard
            number="6"
            title="Audit packet"
            status={auditPacket ? "generated" : auditEvents.length ? "ready" : "waiting"}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <AuditTimeline events={auditEvents} />
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
                <p className="font-semibold">Demo audit packet</p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  Includes action intent, risk, triggered policies, approval,
                  mock execution, verification, audit events, and demo disclaimer.
                </p>
                <button type="button" disabled={!action || busy !== null} onClick={exportAuditPacket} className="mt-4 w-full rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--gold-text)] disabled:opacity-60">
                  Export audit packet
                </button>
                <button type="button" disabled={!auditPacket} onClick={copyAuditPacket} className="mt-2 w-full rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold disabled:opacity-60">
                  {copied ? "Copied" : "Copy packet JSON"}
                </button>
              </div>
            </div>
            {auditPacket ? (
              <pre className="mt-4 max-h-96 overflow-auto rounded-lg border border-[var(--border)] bg-black/30 p-4 text-xs text-[var(--text-secondary)]">
                {auditText}
              </pre>
            ) : null}
          </StepCard>
        </section>
      </div>
    </main>
  );
}

async function postAction(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : "Action request failed");
  }
}

function responseError(response: WalkthroughResponse, fallback: string): string {
  return response.ok ? fallback : response.error;
}

function StepCard({ number, title, status, children }: {
  number: string;
  title: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-1)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-xl font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--gold)] text-sm text-[var(--gold-text)]">{number}</span>
          {title}
        </h2>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {status}
        </span>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "green" | "gold" }) {
  const toneClass = tone === "green"
    ? "text-emerald-300"
    : tone === "gold"
      ? "text-[var(--gold)]"
      : "text-[var(--text-primary)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{label}</p>
      <p className={`mt-1 font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function StateGrid({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <JsonBlock title="Before state" value={before} />
      <JsonBlock title="Proposed after state" value={after} />
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{title}</p>
      <pre className="mt-2 overflow-auto text-xs leading-5 text-[var(--text-secondary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <EmptyStep>Audit events appear after capture.</EmptyStep>;
  return (
    <ol className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
      {events.map((event) => (
        <li key={event.id} className="border-l border-[var(--border)] pb-4 pl-4 last:pb-0">
          <p className="text-sm font-semibold">{event.eventType.replaceAll("_", " ").toLowerCase()}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{event.message}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{event.createdAt}</p>
        </li>
      ))}
    </ol>
  );
}

function EmptyStep({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card-2)] p-4 text-sm text-[var(--text-secondary)]">
      {children}
    </p>
  );
}
