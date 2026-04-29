"use client";

/**
 * SocialFooter — reactions + comments block at the bottom of /s/[slug].
 *
 * Public artifacts only (the API enforces this; the page omits this block
 * for private shares so signed-out viewers don't see a teasing UI). All
 * state is fetched on mount; comments reload after each post; reactions
 * are optimistic with server reconciliation.
 */

import { useEffect, useState, useCallback } from "react";

interface CommentItem {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_code: string | null;
  username: string | null;
}

interface Props {
  slug: string;
  isSignedIn: boolean;
  currentUserId: string | null;
}

export default function SocialFooter({ slug, isSignedIn, currentUserId }: Props) {
  const [hearts, setHearts] = useState(0);
  const [iHearted, setIHearted] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [artifactOwnerId, setArtifactOwnerId] = useState<string | null>(null);
  const [composing, setComposing] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [reactRes, commRes] = await Promise.all([
        fetch(`/api/share/${slug}/react`),
        fetch(`/api/share/${slug}/comments`),
      ]);
      if (reactRes.ok) {
        const data = (await reactRes.json()) as {
          counts: Record<string, number>;
          mine: Record<string, boolean>;
        };
        setHearts(data.counts.heart ?? 0);
        setIHearted(!!data.mine.heart);
      }
      if (commRes.ok) {
        const data = (await commRes.json()) as {
          comments: CommentItem[];
          artifact_owner_id: string;
        };
        setComments(data.comments ?? []);
        setArtifactOwnerId(data.artifact_owner_id ?? null);
      }
    } catch {
      /* silent — empty state will render gracefully */
    }
  }, [slug]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function toggleHeart() {
    if (!isSignedIn) {
      window.location.href = `/?redirect=/s/${slug}`;
      return;
    }
    setReacting(true);
    // Optimistic: flip locally first.
    setIHearted((prev) => !prev);
    setHearts((prev) => prev + (iHearted ? -1 : 1));
    try {
      const res = await fetch(`/api/share/${slug}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "heart" }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          counts: Record<string, number>;
          mine: Record<string, boolean>;
        };
        setHearts(data.counts.heart ?? 0);
        setIHearted(!!data.mine.heart);
      } else {
        // Revert if the server disagreed (e.g. private artifact).
        await loadAll();
      }
    } catch {
      await loadAll();
    } finally {
      setReacting(false);
    }
  }

  async function postComment() {
    const body = composing.trim();
    if (!body) return;
    if (!isSignedIn) {
      window.location.href = `/?redirect=/s/${slug}`;
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/share/${slug}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setPostError(data?.error ?? "Couldn't post comment.");
        return;
      }
      setComposing("");
      await loadAll();
    } catch {
      setPostError("Network error.");
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(commentId: string) {
    const res = await fetch(`/api/share/${slug}/comments/${commentId}`, {
      method: "DELETE",
    });
    if (res.ok) await loadAll();
  }

  return (
    <div style={{ marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--border)" }}>
      {/* Reaction row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <button
          type="button"
          onClick={toggleHeart}
          disabled={reacting}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            border: iHearted
              ? "1px solid var(--gold, #C9A84C)"
              : "1px solid var(--border)",
            background: iHearted ? "var(--gold-soft, #F5E9C8)" : "var(--card)",
            color: iHearted ? "var(--gold-text, #5A4416)" : "var(--text-primary)",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            fontWeight: 600,
            cursor: reacting ? "default" : "pointer",
          }}
          aria-pressed={iHearted}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{iHearted ? "❤️" : "🤍"}</span>
          <span>{hearts > 0 ? hearts : "Heart this"}</span>
        </button>
        {!isSignedIn && (
          <span
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            Sign in to react
          </span>
        )}
      </div>

      {/* Comments header */}
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          margin: "0 0 14px",
        }}
      >
        {comments.length === 0
          ? "Comments"
          : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
      </p>

      {/* Comment list */}
      {comments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          {comments.map((c) => {
            const handle = c.username ?? c.profile_code;
            const label = c.display_name ?? (handle ? `@${handle}` : "Someone");
            const initial = label.slice(0, 1).toUpperCase();
            const canDelete =
              currentUserId !== null &&
              (c.user_id === currentUserId || artifactOwnerId === currentUserId);
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: 14,
                  borderRadius: 14,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                {c.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.avatar_url}
                    alt=""
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      flexShrink: 0,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #C9A84C 0%, #5A4416 100%)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                      fontFamily: "var(--font-dm-sans)",
                    }}
                  >
                    {initial}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    {handle ? (
                      <a
                        href={`/u/${encodeURIComponent(handle)}`}
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          textDecoration: "none",
                        }}
                      >
                        {label}
                      </a>
                    ) : (
                      <span
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {label}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {timeAgo(c.created_at)}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteComment(c.id)}
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--text-muted)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 14,
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                  >
                    {c.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Composer */}
      {isSignedIn ? (
        <div>
          <textarea
            value={composing}
            onChange={(e) => setComposing(e.target.value.slice(0, 280))}
            placeholder="Add a comment…"
            rows={2}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 14,
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {composing.length} / 280
            </span>
            <button
              type="button"
              onClick={postComment}
              disabled={posting || !composing.trim()}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: "none",
                background:
                  posting || !composing.trim()
                    ? "rgba(201,168,76,0.32)"
                    : "var(--gold, #C9A84C)",
                color: "white",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                fontWeight: 600,
                cursor: posting || !composing.trim() ? "default" : "pointer",
              }}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
          {postError && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b91c1c" }}>{postError}</p>
          )}
        </div>
      ) : (
        <a
          href={`/?redirect=/s/${slug}`}
          style={{
            display: "block",
            padding: 14,
            borderRadius: 12,
            border: "1px dashed var(--border)",
            background: "var(--card)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Sign in to leave a comment →
        </a>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}
