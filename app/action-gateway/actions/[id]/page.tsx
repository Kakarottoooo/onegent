import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ApprovalPanel } from "@/app/action-gateway/actions/[id]/ApprovalPanel";
import {
  ActionGatewayError,
  getActionReview,
} from "@/lib/action-gateway/service";
import type { ActionReview } from "@/lib/action-gateway/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function ActionGatewayDetailPage({ params }: Params) {
  const { id } = await params;
  let review: ActionReview;
  try {
    review = getActionReview(id);
  } catch (err) {
    if (err instanceof ActionGatewayError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <header className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-1)]">
            <Link href="/action-gateway" className="text-sm font-semibold text-[var(--gold)]">
              Back to Action Gateway
            </Link>
            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  {review.action.actionType} / {review.action.targetSystem}
                </p>
                <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight">
                  {review.action.title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                  {review.action.description || "No description supplied."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill label={review.action.status} />
                <RiskPill level={review.riskAssessment.riskLevel} />
              </div>
            </div>
          </header>

          <Section title="Risk assessment">
            <div className="grid gap-3 md:grid-cols-3">
              <Fact label="Risk level" value={review.riskAssessment.riskLevel} />
              <Fact label="Risk score" value={`${review.riskAssessment.riskScore}/100`} />
              <Fact
                label="Human approval"
                value={review.riskAssessment.requiresHumanApproval ? "required" : "not required"}
              />
            </div>
            <List title="Risk reasons" items={review.riskAssessment.reasons} />
            <List title="Triggered policies" items={review.riskAssessment.triggeredPolicies} />
          </Section>

          <Section title="Action payload">
            <div className="grid gap-4 md:grid-cols-2">
              <JsonBlock title="Before state" value={review.action.beforeState ?? {}} />
              <JsonBlock title="Proposed after state" value={review.action.proposedAfterState ?? {}} />
            </div>
            <JsonBlock title="Fields changed" value={review.action.fieldsChanged} />
            <div className="rounded-lg bg-[var(--card-2)] p-4">
              <h3 className="text-sm font-semibold">Agent reasoning summary</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {review.action.rawAgentReasoningSummary || "No reasoning summary supplied."}
              </p>
            </div>
          </Section>

          <Section title="Verification result">
            {review.verificationResult ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Fact label="Success" value={review.verificationResult.success ? "yes" : "no"} />
                  <Fact label="Method" value={review.verificationResult.verificationMethod} />
                  <Fact label="Created" value={formatDate(review.verificationResult.createdAt)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <JsonBlock title="Expected state" value={review.verificationResult.expectedState} />
                  <JsonBlock title="Observed state" value={review.verificationResult.observedState} />
                </div>
                <List title="Differences" items={review.verificationResult.differences} empty="No differences." />
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                Verification has not run. It runs automatically after approval/mock execution.
              </p>
            )}
          </Section>

          <Section title="Audit timeline">
            <ol className="grid gap-3">
              {review.auditEvents.map((event) => (
                <li key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <strong className="text-sm">{event.eventType}</strong>
                    <span className="text-xs text-[var(--text-secondary)]">{formatDate(event.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{event.message}</p>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    {event.actorType} / {event.actorId}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="flex flex-col gap-6">
          <ApprovalPanel review={review} />
          <Section title="Action metadata">
            <div className="grid gap-3">
              <Fact label="Workspace" value={review.action.workspaceId} />
              <Fact label="Workflow" value={review.action.workflowId} />
              <Fact label="Agent" value={review.action.sourceAgentName} />
              <Fact label="Agent run" value={review.action.sourceAgentRunId} />
              <Fact label="Environment" value={review.action.environment} />
              <Fact label="Business object" value={`${review.action.businessObjectType} / ${review.action.businessObjectId}`} />
              <Fact label="Amount" value={formatAmount(review.action.amount, review.action.currency)} />
              <Fact label="Vendor" value={review.action.vendorName ?? "-"} />
              <Fact label="Recipient" value={review.action.recipient ?? "-"} />
            </div>
          </Section>
        </aside>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-1)]">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--card-2)] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-[var(--card-2)] p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-5 text-[var(--text-primary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function List({ title, items, empty = "None." }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="rounded-lg bg-[var(--card-2)] p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ul className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">{empty}</p>
      )}
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-[var(--card-2)] px-3 py-1 text-xs font-semibold">
      {label}
    </span>
  );
}

function RiskPill({ level }: { level: string }) {
  const tone = level === "CRITICAL" || level === "HIGH"
    ? "bg-red-500/15 text-red-300"
    : level === "MEDIUM"
      ? "bg-yellow-500/15 text-yellow-300"
      : "bg-green-500/15 text-green-300";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{level}</span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAmount(amount: number | undefined, currency: string | undefined) {
  if (typeof amount !== "number") return "-";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
