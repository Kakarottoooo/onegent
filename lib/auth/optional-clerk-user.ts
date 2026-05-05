import { auth } from "@clerk/nextjs/server";

export async function getOptionalClerkUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch (err) {
    if (isClerkUnavailable(err)) return null;
    throw err;
  }
}

export function isClerkUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    !isClerkConfigured() ||
    /clerk can't detect usage of clerkMiddleware/i.test(message) ||
    /publishable key|secret key|clerk.*not configured/i.test(message)
  );
}

function isClerkConfigured(): boolean {
  const publishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    !!publishable?.startsWith("pk_") &&
    publishable !== "pk_test_placeholder"
  );
}
