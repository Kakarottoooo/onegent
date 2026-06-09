import { NextRequest, NextResponse } from "next/server";
import {
  ActionGatewayError,
  captureActionIntent,
  listActionReviews,
} from "@/lib/action-gateway/service";
import type {
  ActionIntentStatus,
  ActionType,
  RiskLevel,
} from "@/lib/action-gateway/types";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const actions = listActionReviews({
    status: parseStatus(params.get("status")),
    actionType: parseActionType(params.get("actionType")),
    riskLevel: parseRiskLevel(params.get("riskLevel")),
    sourceAgentName: params.get("sourceAgentName") ?? undefined,
  });
  return NextResponse.json({ ok: true, actions });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    const review = captureActionIntent(body);
    return NextResponse.json({ ok: true, review }, { status: 201 });
  } catch (err) {
    return actionGatewayErrorResponse(err);
  }
}

function parseStatus(value: string | null): ActionIntentStatus | undefined {
  const allowed: ActionIntentStatus[] = [
    "CAPTURED",
    "NEEDS_REVIEW",
    "APPROVED",
    "REJECTED",
    "EXECUTED",
    "VERIFIED",
    "FAILED_VERIFICATION",
    "CANCELLED",
  ];
  return allowed.includes(value as ActionIntentStatus)
    ? (value as ActionIntentStatus)
    : undefined;
}

function parseActionType(value: string | null): ActionType | undefined {
  const allowed: ActionType[] = ["SUBMIT", "PAY", "SEND", "UPDATE"];
  return allowed.includes(value as ActionType) ? (value as ActionType) : undefined;
}

function parseRiskLevel(value: string | null): RiskLevel | undefined {
  const allowed: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return allowed.includes(value as RiskLevel) ? (value as RiskLevel) : undefined;
}

function actionGatewayErrorResponse(err: unknown) {
  if (err instanceof ActionGatewayError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  return NextResponse.json({ ok: false, error: "Action Gateway request failed" }, { status: 500 });
}
