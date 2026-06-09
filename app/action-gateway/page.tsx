import Link from "next/link";
import { listActionReviews } from "@/lib/action-gateway/service";
import type { ActionReview } from "@/lib/action-gateway/types";

export const dynamic = "force-dynamic";

export default function ActionGatewayDashboardPage() {
  const reviews = listActionReviews();
  const stats = dashboardStats(reviews);
  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-5 border-b border-[var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--gold)]">
              Onegent Action Gateway MVP
            </p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-5xl">
              Control layer for AI agents before high-risk business actions.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
              Capture, review, approve, mock-execute, verify, and audit SUBMIT,
              PAY, SEND, and UPDATE actions. This demo never touches real
              payment rails, email systems, ERPs, CRMs, vendor portals, or
              production websites.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/action-gateway/walkthrough/procurement"
              className="rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--gold-text)] shadow-[var(--shadow-2)]"
            >
              Run procurement walkthrough
            </Link>
            <Link
              href="/action-gateway/demo"
              className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
            >
              Create demo action
            </Link>
            <Link
              href="/legacy/consumer-agent"
              className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
            >
              Legacy demo
            </Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Actions captured" value={stats.total} />
          <MetricCard label="Pending approvals" value={stats.pendingApprovals} />
          <MetricCard label="High/Critical risk" value={stats.highRisk} />
          <MetricCard label="Verified" value={stats.verified} />
          <MetricCard label="Failed verification" value={stats.failedVerification} />
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-1)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Recent actions</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Approval, verification, and audit state for captured agent actions.
              </p>
            </div>
            <span className="rounded-full bg-[var(--card-2)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              Mock execution only
            </span>
          </div>
          {reviews.length === 0 ? (
            <div className="p-8">
              <p className="text-sm text-[var(--text-secondary)]">
                No actions captured yet. Seed the procurement demo or create a
                mock action manually.
              </p>
              <Link
                href="/action-gateway/walkthrough/procurement"
                className="mt-4 inline-flex rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--gold-text)]"
              >
                Run procurement walkthrough
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--card-2)] text-left text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Approval</th>
                    <th className="px-4 py-3">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.action.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-4 text-[var(--text-secondary)]">
                        {formatDate(review.action.createdAt)}
                      </td>
                      <td className="px-4 py-4 font-semibold">
                        <Link className="hover:text-[var(--gold)]" href={`/action-gateway/actions/${review.action.id}`}>
                          {review.action.title}
                        </Link>
                      </td>
                      <td className="px-4 py-4">{review.action.actionType}</td>
                      <td className="px-4 py-4">{review.action.targetSystem}</td>
                      <td className="px-4 py-4">{formatAmount(review.action.amount, review.action.currency)}</td>
                      <td className="px-4 py-4">
                        <RiskPill level={review.riskAssessment.riskLevel} />
                      </td>
                      <td className="px-4 py-4">{review.action.status}</td>
                      <td className="px-4 py-4">{review.approvalRequest?.status ?? "not required"}</td>
                      <td className="px-4 py-4">
                        {review.verificationResult
                          ? review.verificationResult.success ? "passed" : "failed"
                          : "not run"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-1)]">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-sm text-[var(--text-secondary)]">{label}</div>
    </div>
  );
}

function RiskPill({ level }: { level: string }) {
  const tone = level === "CRITICAL" || level === "HIGH"
    ? "bg-red-500/15 text-red-300"
    : level === "MEDIUM"
      ? "bg-yellow-500/15 text-yellow-300"
      : "bg-green-500/15 text-green-300";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {level}
    </span>
  );
}

function dashboardStats(reviews: ActionReview[]) {
  return {
    total: reviews.length,
    pendingApprovals: reviews.filter((item) => item.approvalRequest?.status === "PENDING").length,
    highRisk: reviews.filter((item) =>
      item.riskAssessment.riskLevel === "HIGH" || item.riskAssessment.riskLevel === "CRITICAL",
    ).length,
    verified: reviews.filter((item) => item.action.status === "VERIFIED").length,
    failedVerification: reviews.filter((item) => item.action.status === "FAILED_VERIFICATION").length,
  };
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
