import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listMyDecisionRoomListRows } from "@/lib/db";
import { buildDecisionRoomListItem } from "@/lib/app-shell-read-model";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const archived = req.nextUrl.searchParams.get("archived") === "1";
  const includeInvited = req.nextUrl.searchParams.get("include_invited") === "1";
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  const rows = await listMyDecisionRoomListRows(userId, {
    archived,
    includeInvited,
    limit,
  });

  return NextResponse.json({
    rooms: rows.map(buildDecisionRoomListItem),
    meta: {
      shape: "compact",
      count: rows.length,
      heavy_fields_excluded: [
        "context_json",
        "synthesis_json",
        "constraints",
        "messages",
        "private_messages",
        "proposals",
        "votes",
      ],
    },
  });
}
