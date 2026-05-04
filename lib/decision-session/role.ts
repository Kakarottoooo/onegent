import type { DecisionSession } from "@/lib/db";

type RequestWithCookies = {
  cookies: {
    get(name: string): { value: string } | undefined;
  };
};

type RoleSession = Pick<
  DecisionSession,
  "id" | "initiator_user_id" | "initiator_session_token"
>;

/** Determine the caller's role from server-side signals, not client-supplied input. */
export function deriveRole(
  req: RequestWithCookies,
  session: RoleSession,
  userId: string | null,
): "initiator" | "partner" {
  if (userId && session.initiator_user_id && userId === session.initiator_user_id) {
    return "initiator";
  }

  const cookieToken = req.cookies.get(`dr_init_${session.id}`)?.value;
  if (cookieToken && cookieToken === session.initiator_session_token) {
    return "initiator";
  }

  return "partner";
}
