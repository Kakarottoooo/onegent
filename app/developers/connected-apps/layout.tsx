import { DashboardNav } from "../_components/DashboardNav";

import "../_styles/dashboard.css";

export const metadata = {
  title: "Connected apps",
  description:
    "Apps you've granted access to your Onegent account. Disconnect any of them in one click.",
};

export default function ConnectedAppsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-theme="dashboard" className="dev-dashboard-shell">
      <DashboardNav />
      <main>{children}</main>
    </div>
  );
}
