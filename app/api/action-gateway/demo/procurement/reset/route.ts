import { NextResponse } from "next/server";
import { resetProcurementWalkthroughDemo } from "@/lib/action-gateway/procurement-walkthrough";

export async function POST() {
  return NextResponse.json({
    ok: true,
    walkthrough: resetProcurementWalkthroughDemo(),
  });
}
