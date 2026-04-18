"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/hooks/useAuth";
import {
  CARD,
  INPUT,
  CTA,
  PILL_OFF,
  PILL_ON,
  HERO_BG,
  PAGE,
} from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

interface MyProfile {
  user_id: string;
  profile_code: string;
  username?: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface Contact {
  contact_user_id: string;
  nickname: string | null;
  profile_code: string;
  display_name: string | null;
  avatar_url: string | null;
  added_at: string;
}

interface Group {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export default function ContactsPage() {
  const { isSignedIn } = useAuth();
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Add-by-code flow
  const [codeInput, setCodeInput] = useState("");
  const [preview, setPreview] = useState<MyProfile | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState("");

  // Groups state
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<string, Contact[]>>({});
  const [groupPickerIds, setGroupPickerIds] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    const [profRes, contactsRes, groupsRes] = await Promise.all([
      fetch("/api/users/me"),
      fetch("/api/contacts"),
      fetch("/api/groups"),
    ]);
    if (profRes.ok) {
      const data = await profRes.json() as { profile: MyProfile };
      setMyProfile(data.profile);
    }
    if (contactsRes.ok) {
      const data = await contactsRes.json() as { contacts: Contact[] };
      setContacts(data.contacts);
    }
    if (groupsRes.ok) {
      const data = await groupsRes.json() as { groups: Group[] };
      setGroups(data.groups);
    }
  }, []);

  async function loadGroupMembers(groupId: string) {
    const res = await fetch(`/api/groups/${groupId}/members`);
    if (!res.ok) return;
    const data = (await res.json()) as { members: Contact[] };
    setGroupMembers((prev) => ({ ...prev, [groupId]: data.members ?? [] }));
  }

  async function createGroupFlow() {
    const name = newGroupName.trim();
    if (!name) return;
    setCreatingGroup(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setNewGroupName("");
        await loadAll();
      }
    } finally {
      setCreatingGroup(false);
    }
  }

  async function renameGroup(groupId: string, name: string) {
    await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadAll();
  }

  async function deleteGroup(groupId: string) {
    if (!confirm("Delete this group? Contacts are not removed.")) return;
    await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    setExpandedGroupId((id) => (id === groupId ? null : id));
    await loadAll();
  }

  async function addMembersToGroup(groupId: string) {
    const ids = Array.from(groupPickerIds);
    if (ids.length === 0) return;
    await fetch(`/api/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_user_ids: ids }),
    });
    setGroupPickerIds(new Set());
    await Promise.all([loadGroupMembers(groupId), loadAll()]);
  }

  async function removeMemberFromGroup(groupId: string, contactUserId: string) {
    await fetch(`/api/groups/${groupId}/members/${encodeURIComponent(contactUserId)}`, {
      method: "DELETE",
    });
    await Promise.all([loadGroupMembers(groupId), loadAll()]);
  }

  useEffect(() => {
    if (isSignedIn) loadAll();
  }, [isSignedIn, loadAll]);

  async function copyMyCode() {
    if (!myProfile) return;
    try {
      const handle = myProfile.username ?? myProfile.profile_code;
      await navigator.clipboard.writeText(`@${handle}`);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch { /* noop */ }
  }

  async function lookupCode() {
    setPreview(null);
    setPreviewError(null);
    // Accept either @username or 6-char profile code. Preserve case so the
    // server can do case-insensitive username matching.
    const handle = codeInput.trim().replace(/^@/, "");
    if (!handle) return;
    try {
      const res = await fetch(`/api/users/by-code/${encodeURIComponent(handle)}`);
      if (res.status === 404) { setPreviewError("No user with that handle."); return; }
      if (!res.ok) { setPreviewError("Lookup failed."); return; }
      const data = await res.json() as { user: MyProfile };
      setPreview(data.user);
    } catch {
      setPreviewError("Network error.");
    }
  }

  async function confirmAdd() {
    if (!preview) return;
    setAdding(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: preview.profile_code, nickname: nicknameInput.trim() || undefined }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Add failed" }));
        setPreviewError(error ?? "Add failed");
        return;
      }
      setCodeInput("");
      setNicknameInput("");
      setPreview(null);
      setPreviewError(null);
      await loadAll();
    } finally {
      setAdding(false);
    }
  }

  async function saveNickname(contactUserId: string) {
    await fetch(`/api/contacts/${encodeURIComponent(contactUserId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: editNickname.trim() || null }),
    });
    setEditingId(null);
    setEditNickname("");
    loadAll();
  }

  async function remove(contactUserId: string) {
    if (!confirm("Remove this contact?")) return;
    await fetch(`/api/contacts/${encodeURIComponent(contactUserId)}`, { method: "DELETE" });
    loadAll();
  }

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="other" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">Sign in to manage contacts.</p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">Go to sign in →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <GlobalNav active="other" />
      <div className="max-w-md mx-auto px-5 py-8">
        <Link
          href="/rooms"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4 inline-block"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-5">Contacts</h1>

        {/* My code card — warm dark brown gradient for hero/branding */}
        <div className="rounded-2xl p-5 mb-5 text-white" style={HERO_BG}>
          <p className="text-[11px] uppercase tracking-wide opacity-60 mb-1">My handle</p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xl font-mono font-semibold" style={{ color: "var(--gold)" }}>
              @{myProfile?.username ?? myProfile?.profile_code ?? "……"}
            </p>
            <button
              onClick={copyMyCode}
              disabled={!myProfile}
              className="px-3 py-1.5 rounded-lg bg-[var(--gold)] text-white text-xs font-medium disabled:opacity-40 hover:opacity-90"
            >
              {codeCopied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="text-[11px] opacity-70 mt-2">
            Share your handle with people you decide things with.
            {myProfile?.username && (
              <> Backup code: <span className="font-mono">@{myProfile.profile_code}</span></>
            )}
          </p>
        </div>

        {/* Add-by-code form */}
        <div className={`${CARD} p-4 mb-5`}>
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Add someone</p>
          <div className="flex gap-2 mb-2">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") lookupCode(); }}
              placeholder="@username or code (e.g. @ziweib)"
              className={`flex-1 ${INPUT}`}
            />
            <button
              onClick={lookupCode}
              disabled={!codeInput.trim()}
              className={`px-3 py-2 ${CTA}`}
            >
              Look up
            </button>
          </div>
          {previewError && (
            <p className="text-xs text-red-700 mb-2">{previewError}</p>
          )}
          {preview && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="flex items-center gap-3 mb-3">
                {preview.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--card-2)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-secondary)]">
                    {(preview.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {preview.display_name ?? "Unnamed user"}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] font-mono">
                    @{preview.username ?? preview.profile_code}
                  </p>
                </div>
              </div>
              <input
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                placeholder="Nickname (optional)"
                maxLength={60}
                className={`w-full ${INPUT} mb-2`}
              />
              <button
                onClick={confirmAdd}
                disabled={adding}
                className={`w-full py-2.5 ${CTA}`}
              >
                {adding ? "Adding…" : `Add ${preview.display_name ?? "contact"} →`}
              </button>
            </div>
          )}
        </div>

        {/* Groups — collapsible section (Phase 2) */}
        <div className={`${CARD} mb-5 overflow-hidden`}>
          <button
            type="button"
            onClick={() => setGroupsOpen((v) => !v)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                My groups {groups && `(${groups.length})`}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Save a set of people you decide with — invite them with one tap.
              </p>
            </div>
            <span className="text-[var(--text-muted)] text-xs">{groupsOpen ? "▲" : "▼"}</span>
          </button>

          {groupsOpen && (
            <div className="border-t border-[var(--border)] p-4">
              {/* Create group */}
              <div className="flex gap-2 mb-3">
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createGroupFlow(); }}
                  placeholder="Group name (e.g. College friends)"
                  maxLength={60}
                  className={`flex-1 ${INPUT}`}
                />
                <button
                  type="button"
                  onClick={createGroupFlow}
                  disabled={!newGroupName.trim() || creatingGroup}
                  className={`px-3 py-2 ${CTA}`}
                >
                  {creatingGroup ? "…" : "Create"}
                </button>
              </div>

              {groups && groups.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] py-2">No groups yet.</p>
              )}

              {groups && groups.length > 0 && (
                <div className="flex flex-col gap-2">
                  {groups.map((g) => {
                    const expanded = expandedGroupId === g.id;
                    const members = groupMembers[g.id] ?? [];
                    const memberIds = new Set(members.map((m) => m.contact_user_id));
                    const addable = contacts?.filter((c) => !memberIds.has(c.contact_user_id)) ?? [];
                    return (
                      <div key={g.id} className="border border-[var(--border)] rounded-xl p-3 bg-[var(--card-2)]">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const next = expanded ? null : g.id;
                              setExpandedGroupId(next);
                              setGroupPickerIds(new Set());
                              if (next && !groupMembers[g.id]) loadGroupMembers(g.id);
                            }}
                            className="flex-1 text-left"
                          >
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              👥 {g.name}
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              {g.member_count} {g.member_count === 1 ? "member" : "members"}
                            </p>
                          </button>
                          <div className="flex gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                const next = prompt("Rename group", g.name);
                                if (next && next.trim()) renameGroup(g.id, next.trim());
                              }}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteGroup(g.id)}
                              className="text-[var(--text-muted)] hover:text-red-600"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="mt-3 pt-3 border-t border-[var(--border)]">
                            {/* Current members */}
                            {members.length === 0 ? (
                              <p className="text-[11px] text-[var(--text-muted)] mb-2">No members yet.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {members.map((m) => (
                                  <span
                                    key={m.contact_user_id}
                                    className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-full border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--text-primary)]"
                                  >
                                    {m.nickname ?? m.display_name ?? `@${m.profile_code}`}
                                    <button
                                      type="button"
                                      onClick={() => removeMemberFromGroup(g.id, m.contact_user_id)}
                                      className="w-4 h-4 rounded-full text-[var(--text-muted)] hover:text-red-600"
                                      aria-label="Remove"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Add-members picker */}
                            {addable.length > 0 && (
                              <>
                                <p className="text-[11px] text-[var(--text-secondary)] mb-1.5">
                                  Add from your contacts:
                                </p>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {addable.map((c) => {
                                    const picked = groupPickerIds.has(c.contact_user_id);
                                    return (
                                      <button
                                        key={c.contact_user_id}
                                        type="button"
                                        onClick={() => {
                                          setGroupPickerIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(c.contact_user_id)) next.delete(c.contact_user_id);
                                            else next.add(c.contact_user_id);
                                            return next;
                                          });
                                        }}
                                        className={picked ? PILL_ON : PILL_OFF}
                                      >
                                        {c.nickname ?? c.display_name ?? `@${c.profile_code}`}
                                        {picked && " ✓"}
                                      </button>
                                    );
                                  })}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addMembersToGroup(g.id)}
                                  disabled={groupPickerIds.size === 0}
                                  className={`w-full py-2 ${CTA} text-xs`}
                                >
                                  Add {groupPickerIds.size > 0 ? `${groupPickerIds.size} ` : ""}to {g.name}
                                </button>
                              </>
                            )}
                            {addable.length === 0 && members.length > 0 && (
                              <p className="text-[11px] text-[var(--text-muted)]">
                                All your contacts are in this group.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Contacts list */}
        <p className="text-xs text-[var(--text-secondary)] mb-2 px-1">
          My contacts {contacts && `(${contacts.length})`}
        </p>
        {contacts === null && (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">Loading…</p>
        )}
        {contacts && contacts.length === 0 && (
          <div className={`${CARD} p-6 text-center`}>
            <p className="text-sm text-[var(--text-secondary)]">
              No contacts yet. Add someone by their code above.
            </p>
          </div>
        )}
        {contacts && contacts.length > 0 && (
          <div className="flex flex-col gap-2">
            {contacts.map((c) => {
              const editing = editingId === c.contact_user_id;
              const label = c.nickname ?? c.display_name ?? "Unnamed";
              return (
                <div key={c.contact_user_id} className={`${CARD} p-3`}>
                  <div className="flex items-center gap-3">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar_url} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[var(--card-2)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-secondary)] flex-shrink-0">
                        {label.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {editing ? (
                        <input
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveNickname(c.contact_user_id); }}
                          maxLength={60}
                          autoFocus
                          className={`w-full ${INPUT} px-2 py-1`}
                        />
                      ) : (
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{label}</p>
                      )}
                      <p className="text-[11px] text-[var(--text-muted)]">
                        <span className="font-mono">@{c.profile_code || "?"}</span>
                        {c.nickname && c.display_name && !editing && (
                          <> · <span className="text-[var(--text-muted)]">{c.display_name}</span></>
                        )}
                      </p>
                    </div>
                    {editing ? (
                      <button
                        onClick={() => saveNickname(c.contact_user_id)}
                        className="text-xs font-medium text-[var(--gold)] hover:underline"
                      >
                        Save
                      </button>
                    ) : (
                      <div className="flex gap-2 text-xs">
                        <button
                          onClick={() => {
                            setEditingId(c.contact_user_id);
                            setEditNickname(c.nickname ?? "");
                          }}
                          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(c.contact_user_id)}
                          className="text-[var(--text-muted)] hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
