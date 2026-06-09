import Link from "next/link";
import { notFound } from "next/navigation";
import { getMockPurchaseOrder } from "@/lib/action-gateway/mock-procurement";

export const dynamic = "force-dynamic";

export default async function MockPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const purchaseOrder = getMockPurchaseOrder(id);
  if (!purchaseOrder) notFound();

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <section className="mx-auto max-w-4xl rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-1)]">
        <Link href="/action-gateway/walkthrough/procurement" className="text-sm font-semibold text-[var(--gold)]">
          Back to procurement walkthrough
        </Link>
        <p className="mt-6 inline-flex rounded-full border border-[var(--border)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Local demo mock system
        </p>
        <h1 className="mt-4 font-serif text-4xl font-semibold">
          Mock ERP purchase order
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          This page reads local in-memory demo state only. No real purchase order
          is created, submitted, paid, emailed, or sent to a vendor.
        </p>

        <dl className="mt-8 grid gap-4 md:grid-cols-2">
          <Field label="PO ID" value={purchaseOrder.id} />
          <Field label="Status" value={purchaseOrder.status} tone={purchaseOrder.status === "SUBMITTED" ? "green" : "gold"} />
          <Field label="Vendor" value={purchaseOrder.vendor} />
          <Field label="Amount" value={`${purchaseOrder.currency} ${purchaseOrder.amount.toLocaleString()}`} />
          <Field label="Vendor approval" value={purchaseOrder.vendorApproved ? "approved" : "not approved"} />
          <Field label="Line item" value={purchaseOrder.lineItem} />
          <Field label="Action intent" value={purchaseOrder.actionIntentId ?? "not linked"} />
          <Field label="Last updated" value={purchaseOrder.lastUpdatedAt} />
        </dl>
      </section>
    </main>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "green" | "gold" }) {
  const toneClass = tone === "green"
    ? "text-emerald-300"
    : tone === "gold"
      ? "text-[var(--gold)]"
      : "text-[var(--text-primary)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
      <dt className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{label}</dt>
      <dd className={`mt-2 text-lg font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
