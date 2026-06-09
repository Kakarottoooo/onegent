import { NextResponse } from "next/server";
import { seedDemoActions } from "@/lib/action-gateway/demo-seeds";

export async function POST() {
  const actions = seedDemoActions({ reset: true });
  return NextResponse.json({ ok: true, actions });
}
