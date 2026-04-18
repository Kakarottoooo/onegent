"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/app/hooks/useAuth";

export default function JoinRoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { isSignedIn } = useAuth();

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = (code ?? "").toString().toUpperCase();

  async function join() {
    if (!isSignedIn) {
      setError("Please sign in first, then come back to this link.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(normalized)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ short_code: normalized }),
      });
      if (res.status === 404) { setError("This invite link is invalid or has expired."); return; }
      if (res.status === 401) { setError("Please sign in first."); return; }
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Couldn't join." }));
        setError(msg ?? "Couldn't join.");
        return;
      }
      const { room } = await res.json() as { room: { id: string } };
      router.push(`/rooms/${room.id}`);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setJoining(false);
    }
  }

  // Auto-join once signed in — frictionless path.
  useEffect(() => {
    if (isSignedIn && !joining && !error) {
      join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-dm-sans)] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-3">🤝</div>
        <h1 className="text-base font-semibold text-gray-900 mb-1">You&apos;ve been invited</h1>
        <p className="text-xs text-gray-500 mb-5">
          Room code: <span className="font-mono text-gray-700">{normalized}</span>
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 mb-4 text-left">
            {error}
          </div>
        )}

        {!isSignedIn && (
          <Link
            href="/"
            className="block w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium"
          >
            Sign in to join →
          </Link>
        )}

        {isSignedIn && (
          <button
            onClick={join}
            disabled={joining}
            className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-40"
          >
            {joining ? "Joining…" : "Join room →"}
          </button>
        )}
      </div>
    </div>
  );
}
