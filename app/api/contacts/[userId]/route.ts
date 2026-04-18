import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { removeContact, updateContactNickname } from "@/lib/db";

type Params = { params: Promise<{ userId: string }> };

/** PATCH /api/contacts/[userId] — rename a contact. Body: { nickname: string | null } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId: me } = await auth();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: contactUserId } = await params;
  const body = await req.json().catch(() => null);
  const raw = typeof body?.nickname === "string" ? body.nickname.trim().slice(0, 60) : null;
  const nickname = raw || null;

  const row = await updateContactNickname(me, contactUserId, nickname);
  if (!row) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json({ contact: row });
}

/** DELETE /api/contacts/[userId] — remove a contact. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId: me } = await auth();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: contactUserId } = await params;
  const removed = await removeContact(me, contactUserId);
  return NextResponse.json({ removed });
}
