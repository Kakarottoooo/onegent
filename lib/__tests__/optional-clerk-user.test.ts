import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import {
  getOptionalClerkUserId,
  isClerkUnavailable,
} from "@/lib/auth/optional-clerk-user";

const mockAuth = vi.mocked(auth);

describe("getOptionalClerkUserId", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockAuth.mockReset();
  });

  it("returns the Clerk user id when auth succeeds", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" } as Awaited<
      ReturnType<typeof auth>
    >);

    await expect(getOptionalClerkUserId()).resolves.toBe("user_123");
  });

  it("returns null when Clerk is disabled in the local preview environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    mockAuth.mockRejectedValue(
      new Error("Clerk can't detect usage of clerkMiddleware()."),
    );

    await expect(getOptionalClerkUserId()).resolves.toBeNull();
  });

  it("rethrows unrelated auth errors when Clerk is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_real");
    mockAuth.mockRejectedValue(new Error("database timeout"));

    await expect(getOptionalClerkUserId()).rejects.toThrow("database timeout");
  });
});

describe("isClerkUnavailable", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats an unconfigured publishable key as unavailable", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");

    expect(isClerkUnavailable(new Error("anything"))).toBe(true);
  });

  it("recognizes the missing middleware error", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_real");

    expect(
      isClerkUnavailable(
        new Error("Clerk can't detect usage of clerkMiddleware()."),
      ),
    ).toBe(true);
  });
});
