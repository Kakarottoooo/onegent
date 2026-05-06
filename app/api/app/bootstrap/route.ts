import { NextRequest, NextResponse } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { emptyAppBootstrapData, getAppBootstrapData } from "@/lib/app-bootstrap";

export async function GET(req: NextRequest) {
  try {
    const userId = await getOptionalClerkUserId();
    const sessionId = req.nextUrl.searchParams.get("session_id");
    const bootstrap = await getAppBootstrapData({ userId, sessionId });
    return NextResponse.json(bootstrap);
  } catch (err) {
    console.warn("[app-bootstrap] falling back to empty bootstrap", err);
    return NextResponse.json(emptyAppBootstrapData());
  }
}
