import { NextResponse } from "next/server";
import { getExistingProcurementWalkthroughState } from "@/lib/action-gateway/procurement-walkthrough";

export async function GET() {
  return NextResponse.json({
    ok: true,
    walkthrough: getExistingProcurementWalkthroughState(),
  });
}
