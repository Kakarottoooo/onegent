import { describe, expect, it } from "vitest";
import {
  buildContactsWorkspaceBootstrap,
  buildDecisionRoomListItem,
  emptyContactWorkspaceCounts,
} from "@/lib/app-shell-read-model";
import type { ContactWithProfile, DecisionRoomListRow, UserProfile } from "@/lib/db";

function room(overrides: Partial<DecisionRoomListRow> = {}): DecisionRoomListRow {
  return {
    id: "room-1",
    type: "trip",
    title: "Nashville weekend",
    status: "collecting",
    creator_id: "user-1",
    flow: "chat",
    short_code: "ABC123",
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:01:00.000Z",
    member_status: "joined",
    ...overrides,
  };
}

function profile(): UserProfile {
  return {
    user_id: "user-1",
    profile_code: "ABC123",
    username: "onegent",
    display_name: "Onegent User",
    avatar_url: "https://example.com/avatar.png",
    bio: "Travel",
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
  };
}

describe("app shell compact read models", () => {
  it("builds room list rows without full room artifacts", () => {
    const item = buildDecisionRoomListItem(room({ status: "done" }));

    expect(item).toMatchObject({
      id: "room-1",
      short_code: "ABC123",
      workspace: "history",
      member_status: "joined",
    });
    expect(item).not.toHaveProperty("context_json");
    expect(item).not.toHaveProperty("synthesis_json");
    expect(item).not.toHaveProperty("messages");
    expect(item).not.toHaveProperty("proposals");
  });

  it("builds contacts bootstrap without collapsed-section payloads", () => {
    const contact: ContactWithProfile = {
      contact_user_id: "user-2",
      nickname: "Ari",
      profile_code: "DEF456",
      username: "ari",
      display_name: "Ari",
      avatar_url: null,
      added_at: "2026-05-05T00:02:00.000Z",
    };

    const data = buildContactsWorkspaceBootstrap({
      profile: profile(),
      contacts: [contact],
      counts: {
        ...emptyContactWorkspaceCounts(),
        contact_count: 1,
        group_count: 2,
        incoming_request_count: 1,
      },
      generatedAt: "2026-05-05T00:03:00.000Z",
    });

    expect(data).toMatchObject({
      profile: { user_id: "user-1", profile_code: "ABC123" },
      contacts: [{ contact_user_id: "user-2" }],
      counts: { contact_count: 1, group_count: 2, incoming_request_count: 1 },
      meta: { shape: "contacts-bootstrap" },
    });
    expect(data).not.toHaveProperty("groups");
    expect(data).not.toHaveProperty("blocks");
    expect(data).not.toHaveProperty("requests");
    expect(data.meta.heavy_fields_excluded).toContain("direct_messages");
  });
});
