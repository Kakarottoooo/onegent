import { NextRequest, NextResponse } from "next/server";
import {
  ActionGatewayError,
  approveAction,
} from "@/lib/action-gateway/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const review = approveAction({
      id,
      reviewerId: typeof body?.reviewerId === "string" ? body.reviewerId : "human-reviewer",
      reviewerComment: typeof body?.reviewerComment === "string" ? body.reviewerComment : undefined,
    });
    return NextResponse.json({ ok: true, review });
  } catch (err) {
    return actionGatewayErrorResponse(err);
  }
}

function actionGatewayErrorResponse(err: unknown) {
  if (err instanceof ActionGatewayError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  return NextResponse.json({ ok: false, error: "Action Gateway request failed" }, { status: 500 });
}
