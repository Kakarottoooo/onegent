"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ActionReview, ActionType, ActionEnvironment } from "@/lib/action-gateway/types";

type CaptureResponse = { ok: true; review: ActionReview } | { ok: false; error: string };
type SeedResponse = { ok: true; actions: ActionReview[] } | { ok: false; error: string };

export default function ActionGatewayDemoPage() {
  const router = useRouter();
  const [actionType, setActionType] = useState<ActionType>("SUBMIT");
  const [targetSystem, setTargetSystem] = useState("Demo ERP");
  const [environment, setEnvironment] = useState<ActionEnvironment>("staging");
  const [title, setTitle] = useState("Procurement agent wants to submit a $4,850 purchase order");
  const [amount, setAmount] = useState("4850");
  const [currency, setCurrency] = useState("USD");
  const [recipient, setRecipient] = useState("");
  const [vendorName, setVendorName] = useState("Acme Industrial Supply");
  const [beforeState, setBeforeState] = useState(
    JSON.stringify({ poNumber: "PO-DEMO-4850", status: "DRAFT", amount: 4850 }, null, 2),
  );
  const [proposedAfterState, setProposedAfterState] = useState(
    JSON.stringify({ poNumber: "PO-DEMO-4850", status: "SUBMITTED", amount: 4850 }, null, 2),
  );
  const [busy, setBusy] = useState<"create" | "seed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createAction() {
    setBusy("create");
    setError(null);
    try {
      const before = parseJsonObject(beforeState, "Before state");
      const after = parseJsonObject(proposedAfterState, "Proposed after state");
      const res = await fetch("/api/action-gateway/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAgentName: "DemoAgent",
          sourceAgentRunId: `demo-run-${Date.now()}`,
          actionType,
          targetSystem,
          environment,
          title,
          description: "Manually captured demo action from the Action Gateway MVP page.",
          businessObjectType: actionType === "SEND" ? "email" : actionType === "UPDATE" ? "inventory_item" : "purchase_order",
          businessObjectId: `DEMO-${Date.now()}`,
          amount: amount.trim() ? Number(amount) : undefined,
          currency,
          recipient: recipient.trim() || undefined,
          vendorName: vendorName.trim() || undefined,
          beforeState: before,
          proposedAfterState: after,
          fieldsChanged: inferFieldChanges(before, after),
          rawAgentReasoningSummary:
            "Demo agent prepared a high-risk business action for Onegent review.",
        }),
      });
      const data = (await res.json()) as CaptureResponse;
      if (!res.ok || !data.ok) throw new Error(responseError(data, "Could not create action"));
      router.push(`/action-gateway/actions/${data.review.action.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create action");
    } finally {
      setBusy(null);
    }
  }

  async function seedDemoActions() {
    setBusy("seed");
    setError(null);
    try {
      const res = await fetch("/api/action-gateway/demo/seed", { method: "POST" });
      const data = (await res.json()) as SeedResponse;
      if (!res.ok || !data.ok) throw new Error(responseError(data, "Could not seed actions"));
      router.push(`/action-gateway/actions/${data.actions[0].action.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not seed actions");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text-primary)]">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-1)]">
          <Link href="/action-gateway" className="text-sm font-semibold text-[var(--gold)]">
            Back to dashboard
          </Link>
          <h1 className="mt-4 font-serif text-3xl font-semibold">
            Capture a mock high-risk action
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            This page simulates another AI agent submitting an intended action
            to Onegent. All execution is mocked and local.
          </p>

          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-4">
            <h2 className="text-sm font-semibold">Procurement demo story</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              A procurement agent wants to submit a $4,850 purchase order to an
              approved vendor. Onegent captures it, classifies it HIGH risk,
              requests approval, mock-executes after approval, verifies the PO
              status changed from DRAFT to SUBMITTED, and records the audit
              trail.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={seedDemoActions}
              className="mt-4 w-full rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--gold-text)] disabled:opacity-60"
            >
              {busy === "seed" ? "Seeding..." : "Seed five demo actions"}
            </button>
          </div>
        </aside>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-1)]">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Action type">
              <select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)} className={inputClass}>
                <option value="SUBMIT">SUBMIT</option>
                <option value="PAY">PAY</option>
                <option value="SEND">SEND</option>
                <option value="UPDATE">UPDATE</option>
              </select>
            </Field>
            <Field label="Environment">
              <select value={environment} onChange={(event) => setEnvironment(event.target.value as ActionEnvironment)} className={inputClass}>
                <option value="demo">demo</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </Field>
            <Field label="Target system">
              <input value={targetSystem} onChange={(event) => setTargetSystem(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Title">
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Amount">
              <input value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} inputMode="decimal" />
            </Field>
            <Field label="Currency">
              <input value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Recipient">
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} className={inputClass} placeholder="external@example.com" />
            </Field>
            <Field label="Vendor">
              <input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Before state JSON">
              <textarea value={beforeState} onChange={(event) => setBeforeState(event.target.value)} rows={9} className={inputClass} />
            </Field>
            <Field label="Proposed after state JSON">
              <textarea value={proposedAfterState} onChange={(event) => setProposedAfterState(event.target.value)} rows={9} className={inputClass} />
            </Field>
          </div>

          {error ? (
            <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={createAction}
              className="rounded-lg bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--gold-text)] disabled:opacity-60"
            >
              {busy === "create" ? "Capturing..." : "Capture action"}
            </button>
            <Link
              href="/action-gateway"
              className="rounded-lg border border-[var(--border)] px-5 py-3 text-sm font-semibold"
            >
              View dashboard
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

const inputClass =
  "mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm outline-none focus:border-[var(--gold)]";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}

function responseError(response: CaptureResponse | SeedResponse, fallback: string): string {
  return response.ok ? fallback : response.error;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function inferFieldChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ field: key, before: before[key], after: after[key] }));
}
