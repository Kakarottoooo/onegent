import { DashboardNav } from "./_components/DashboardNav";

import "../_styles/dashboard.css";

export const metadata = {
  title: "API Keys",
  description: "Manage your Onegent API keys.",
};

export default function KeysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // data-theme="dashboard" flips every var(--ink-*), var(--surface-*),
  // var(--accent-*) defined in tokens.css to its dark variant. The
  // dashboard does not leak this attribute outside its own subtree.
  return (
    <div data-theme="dashboard" className="dev-dashboard-shell">
      <DashboardNav />
      <main>{children}</main>
    </div>
  );
}
