import type { Metadata } from "next";

import { DevNav } from "./_components/DevNav";
import { DevFooter } from "./_components/DevFooter";

import "./_styles/tokens.css";
import "./_styles/typography.css";
import "./_styles/shell.css";

export const metadata: Metadata = {
  title: {
    default: "Onegent Developers — AI books your trip end-to-end",
    template: "%s · Onegent Developers",
  },
  description:
    "The Travel Execution Layer for AI agents. Book restaurants, hotels, flights, and activities through one API.",
  openGraph: {
    title: "Onegent Developers",
    description:
      "AI books your trip end-to-end. Book restaurants, hotels, flights, and activities through one API.",
    type: "website",
  },
};

export default function DevelopersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dev-shell">
      <DevNav />
      <main>{children}</main>
      <DevFooter />
    </div>
  );
}
