import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Only /api/user/* routes require authentication
const isProtectedRoute = createRouteMatcher(["/api/user(.*)"]);

const clerkEnabled =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_") &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder";

const protectedProxy = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default clerkEnabled ? protectedProxy : function proxy() {
  return NextResponse.next();
};

export const config = {
  // Keep the proxy off page navigations/static assets. Clerk's auth() still
  // needs the proxy on API routes, but page clicks should not pay this cost.
  matcher: ["/api/:path*"],
};
