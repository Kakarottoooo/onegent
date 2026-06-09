import { NextResponse } from "next/server";
import { generateActionAuditPacket } from "@/lib/action-gateway/procurement-walkthrough";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const packet = generateActionAuditPacket(id);
    return NextResponse.json(packet, {
      headers: {
        "Content-Disposition": `attachment; filename="onegent-action-audit-${id}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Audit packet unavailable" },
      { status: 404 },
    );
  }
}
