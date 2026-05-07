import type {
  ContactWithProfile,
  ContactWorkspaceCounts,
  DecisionRoomListRow,
  UserProfile,
} from "@/lib/db";

export type RoomWorkspaceBucket = "active" | "history";

export type DecisionRoomListItem = Pick<
  DecisionRoomListRow,
  | "id"
  | "type"
  | "title"
  | "status"
  | "creator_id"
  | "flow"
  | "short_code"
  | "created_at"
  | "updated_at"
  | "member_status"
> & {
  workspace: RoomWorkspaceBucket;
};

export type ContactsWorkspaceBootstrap = {
  profile: Pick<
    UserProfile,
    "user_id" | "profile_code" | "username" | "display_name" | "avatar_url"
  > | null;
  contacts: ContactWithProfile[];
  counts: ContactWorkspaceCounts;
  generated_at: string;
  meta: {
    shape: "contacts-bootstrap";
    heavy_fields_excluded: string[];
  };
};

export const CONTACTS_BOOTSTRAP_HEAVY_FIELDS_EXCLUDED = [
  "groups.members",
  "direct_messages",
  "blocked_profiles",
  "suggestion_history",
  "request_notes",
];

export function buildDecisionRoomListItem(row: DecisionRoomListRow): DecisionRoomListItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    creator_id: row.creator_id,
    flow: row.flow,
    short_code: row.short_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
    member_status: row.member_status,
    workspace: row.status === "done" || row.status === "abandoned" ? "history" : "active",
  };
}

export function emptyContactWorkspaceCounts(): ContactWorkspaceCounts {
  return {
    contact_count: 0,
    incoming_request_count: 0,
    outgoing_request_count: 0,
    group_count: 0,
    blocked_count: 0,
  };
}

export function buildContactsWorkspaceBootstrap(params: {
  profile: UserProfile | null;
  contacts: ContactWithProfile[];
  counts: ContactWorkspaceCounts;
  generatedAt?: string;
}): ContactsWorkspaceBootstrap {
  const profile = params.profile
    ? {
        user_id: params.profile.user_id,
        profile_code: params.profile.profile_code,
        username: params.profile.username,
        display_name: params.profile.display_name,
        avatar_url: params.profile.avatar_url,
      }
    : null;

  return {
    profile,
    contacts: params.contacts,
    counts: params.counts,
    generated_at: params.generatedAt ?? new Date().toISOString(),
    meta: {
      shape: "contacts-bootstrap",
      heavy_fields_excluded: CONTACTS_BOOTSTRAP_HEAVY_FIELDS_EXCLUDED,
    },
  };
}
