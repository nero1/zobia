"use client";

/**
 * components/blogs/CommentsSection.tsx
 *
 * Comments list + add-comment box for a blog article. Loaded client-side
 * (not part of the SSR payload) so the article page itself stays fast and
 * cacheable; comments are secondary content for crawlers.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface CommentRow {
  id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  status: string;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
}

export function CommentsSection({ blogSlug, postSlug, commentsEnabled }: { blogSlug: string; postSlug: string; commentsEnabled: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!commentsEnabled) { setLoading(false); return; }
    fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/comments`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setComments(json?.data?.comments ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [blogSlug, postSlug, commentsEnabled]);

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text.trim() }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to comment");
      setText("");
      if (json?.data?.status === "pending") {
        setNotice(t("blogs.post.commentPending", "Your comment is awaiting approval."));
      } else {
        setComments((prev) => [...prev, { id: json.data.id, author_id: "", parent_comment_id: null, body: text.trim(), status: "visible", created_at: new Date().toISOString(), author_username: null, author_display_name: t("blogs.post.you", "You") }]);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to comment");
    } finally {
      setSubmitting(false);
    }
  }

  if (!commentsEnabled) return null;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-foreground mb-3">{t("blogs.post.comments", "Comments")} {comments.length > 0 && `(${comments.length})`}</h2>

      <div className="mb-4 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={t("blogs.post.commentPlaceholder", "Add a comment…")}
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center justify-between">
          {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="ml-auto rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? t("blogs.post.posting", "Posting…") : t("blogs.post.postComment", "Post")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("blogs.post.noComments", "No comments yet.")}</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-3">
              <div className="text-xs font-medium text-foreground">{c.author_display_name ?? (c.author_username ? `@${c.author_username}` : t("blogs.post.anonymous", "Anonymous"))}</div>
              <p className="text-sm text-foreground mt-1">{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
