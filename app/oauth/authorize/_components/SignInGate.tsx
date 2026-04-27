"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser, SignInButton } from "@clerk/nextjs";

/**
 * Modal sign-in trigger that refreshes the surrounding Server Component
 * once Clerk reports the user as signed in. The Server page then re-runs,
 * detects the session, and renders the consent UI in place of this gate.
 */
export function SignInGate({ returnUrl }: { returnUrl: string }) {
  const router = useRouter();
  const { isSignedIn } = useUser();

  useEffect(() => {
    if (isSignedIn) router.refresh();
  }, [isSignedIn, router]);

  return (
    <SignInButton
      mode="modal"
      forceRedirectUrl={returnUrl}
      signUpForceRedirectUrl={returnUrl}
    >
      <button type="button" className="oauth-cta oauth-cta--primary">
        Sign in to continue
      </button>
    </SignInButton>
  );
}
