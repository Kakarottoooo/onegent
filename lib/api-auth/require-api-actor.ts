import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, type ApiKeyContext } from "./require-api-key";
import type { ExecutionScenario } from "@/lib/core";

export type ApiActor =
  | { type: "api_key"; context: ApiKeyContext }
  | { type: "user"; userId: string };

export type RequireApiActorResult =
  | { ok: true; actor: ApiActor }
  | { ok: false; response: NextResponse };

export async function requireApiActor(req: NextRequest): Promise<RequireApiActorResult> {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const apiKey = await requireApiKey(req);
    if (!apiKey.ok) return apiKey;
    return { ok: true, actor: { type: "api_key", context: apiKey.context } };
  }

  const { userId } = await auth();
  if (userId) return { ok: true, actor: { type: "user", userId } };

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: {
          code: "missing_authentication",
          message: "Sign in or send Authorization: Bearer ogk_live_<key>.",
        },
      },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="onegent-api"' } },
    ),
  };
}

export function actorUserId(actor: ApiActor): string | null {
  return actor.type === "user" ? actor.userId : null;
}

export function apiKeyContext(actor: ApiActor): ApiKeyContext | null {
  return actor.type === "api_key" ? actor.context : null;
}

export function actorCanUseScenario(actor: ApiActor, scenario: ExecutionScenario): boolean {
  if (actor.type === "user") return true;
  return (
    actor.context.allowedJobTypes === null ||
    actor.context.allowedJobTypes.includes(scenario)
  );
}

export function actorCanAccessTask(
  actor: ApiActor,
  task: { user_id: string | null },
): boolean {
  if (actor.type === "api_key") return true;
  return task.user_id === actor.userId;
}

export function actorCanAccessJobUser(actor: ApiActor, jobUserId: string | null | undefined): boolean {
  if (actor.type === "api_key") return true;
  return jobUserId === actor.userId;
}

export function notFoundResponse(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 404 });
}
