import { NextResponse } from "next/server";
import {
  ActionGatewayError,
  getActionReview,
} from "@/lib/action-gateway/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, review: getActionReview(id) });
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
