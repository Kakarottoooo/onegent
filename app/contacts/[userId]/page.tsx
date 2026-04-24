"use client";

/**
 * Single-thread view of one contact. Re-uses ContactDmPane — deep-linkable
 * URL for one conversation. The main /contacts page shows the same thread
 * as a right-pane inside a split layout.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";
import { CARD, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";
import ContactDmPane from "@/components/ContactDmPane";

export default function DmThreadPage() {
  const { isSignedIn } = useAuth();
  const params = useParams<{ userId: string }>();
  const peerId = (params?.userId ?? "").toString();

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="contacts" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">Sign in to message contacts.</p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">Go to sign in →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <GlobalNav active="contacts" />
      <div
        className="max-w-md md:max-w-2xl lg:max-w-3xl mx-auto px-5 md:px-6 py-6 flex flex-col"
        style={{ height: "calc(100vh - 80px)" }}
      >
        <Link
          href="/contacts"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4 inline-block flex-shrink-0"
        >
          ← All contacts
        </Link>
        <ContactDmPane peerId={peerId} />
      </div>
    </div>
  );
}
