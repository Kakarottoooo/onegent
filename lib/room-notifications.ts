import { createNotification, type DecisionRoom } from "@/lib/db";

function openRoomLink(room: Pick<DecisionRoom, "id" | "flow">): string {
  return room.flow === "chat" ? `/?room_id=${room.id}` : `/rooms/${room.id}`;
}

function joinRoomLink(room: Pick<DecisionRoom, "id" | "flow" | "short_code">): string {
  if (room.short_code) return `/rooms/join/${room.short_code}`;
  return openRoomLink(room);
}

export async function notifyDecisionRoomInvite(params: {
  room: Pick<DecisionRoom, "id" | "flow" | "short_code" | "title">;
  recipientUserId: string;
  creatorLabel: string;
  totalMembers: number;
  requiresAccept?: boolean;
}) {
  const { room, recipientUserId, creatorLabel, totalMembers, requiresAccept = true } = params;
  const suffix = totalMembers >= 3 ? ` (${totalMembers}-person group)` : "";
  await createNotification({
    userId: recipientUserId,
    kind: "dr_invite",
    title: `${creatorLabel} invited you to a Decision Room${suffix}`,
    body: room.title,
    linkUrl: requiresAccept ? joinRoomLink(room) : openRoomLink(room),
    metadata: {
      room_id: room.id,
      room_short_code: room.short_code,
      room_title: room.title,
      total_members: totalMembers,
      requires_accept: requiresAccept,
    },
    dedupeKey: `dr_invite:${room.id}:${recipientUserId}`,
  });
}

export async function notifyDecisionRoomReachedDecision(params: {
  room: Pick<DecisionRoom, "id" | "flow">;
  recipientUserIds: string[];
  totalMembers: number;
  winnerLabel: string | null;
  proposalId: string;
}) {
  const { room, recipientUserIds, totalMembers, winnerLabel, proposalId } = params;
  const title =
    totalMembers >= 3
      ? "Your group room reached a decision"
      : "Your decision room reached a decision";
  const body = winnerLabel ? `${winnerLabel} won the room vote.` : null;
  await Promise.all(
    recipientUserIds.map((userId) =>
      createNotification({
        userId,
        kind: "dr_decided",
        title,
        body,
        linkUrl: openRoomLink(room),
        metadata: {
          room_id: room.id,
          proposal_id: proposalId,
          winner_label: winnerLabel,
          total_members: totalMembers,
        },
        dedupeKey: `dr_decided:${room.id}:${proposalId}:${userId}`,
      }),
    ),
  );
}
