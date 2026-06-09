import { NextRequest, NextResponse } from "next/server";
import {
  ActionGatewayError,
  verifyAction,
} from "@/lib/action-gateway/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const observedState =
      body?.observedState &&
      typeof body.observedState === "object" &&
      !Array.isArray(body.observedState)
        ? (body.observedState as Record<string, unknown>)
        : undefined;
    const review = verifyAction(id, observedState);
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
