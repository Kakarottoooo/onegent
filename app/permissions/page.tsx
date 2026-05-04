"use client";

import { Suspense, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";

function PermissionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const resolveTarget = useCallback((raw: string | null): string => {
    if (!raw) return "profiles";
    if (raw === "profile" || raw === "details" || raw === "profiles") return "profiles";
    if (raw === "model" || raw === "models") return "models";
    if (raw === "taste" || raw === "learned") return "learned";
    if (raw === "permissions" || raw === "controls") return "controls";
    if (raw === "billing") return "billing";
    if (raw === "identity") return "identity";
    return "identity";
  }, []);

  useEffect(() => {
    const target = resolveTarget(searchParams.get("tab"));
    if (target === "learned") {
      router.replace("/insights?tab=overview");
      return;
    }
    router.replace(`/account?tab=${encodeURIComponent(target)}`);
  }, [resolveTarget, router, searchParams]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />
      <main style={{ maxWidth: 580, margin: "0 auto", padding: "28px 20px 80px" }}>
        <div style={{ marginBottom: 4 }}>
          <h1
            style={{
              fontFamily: "var(--font-playfair, serif)",
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-primary, #111)",
              marginBottom: 6,
            }}
          >
            Redirecting to Account
          </h1>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              color: "var(--text-secondary, #666)",
            }}
          >
            Settings now live under the unified Account workspace.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense fallback={null}>
      <PermissionsPageInner />
    </Suspense>
  );
}
