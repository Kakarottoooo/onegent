import { NextResponse, type NextRequest } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import {
  findProfilePaymentFields,
  parseProfilePatch,
  paymentFieldsError,
  toPublicBookingProfile,
  upsertDefaultBookingProfile,
} from "@/lib/profile-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const rawPatch =
    rawBody && typeof rawBody === "object" && "profile" in rawBody
      ? (rawBody as { profile?: unknown }).profile
      : rawBody;

  const paymentFields = findProfilePaymentFields(rawPatch);
  if (paymentFields.length > 0) {
    const parsed = paymentFieldsError(paymentFields);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
  }

  const userId = await getOptionalClerkUserId();
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to update your booking profile." } },
      { status: 401 },
    );
  }

  const parsed = parseProfilePatch(rawPatch);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const profile = await upsertDefaultBookingProfile(userId, parsed.value);

  return NextResponse.json(
    {
      profile: toPublicBookingProfile(profile),
      updatedFields: parsed.updatedFields,
    },
    { status: 200 },
  );
}

