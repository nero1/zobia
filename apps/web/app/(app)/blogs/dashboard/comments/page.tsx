"use client";

/**
 * app/(app)/blogs/dashboard/comments/page.tsx
 *
 * Comment moderation queue for the caller's own blog: lists pending
 * comments across all posts (when comments_moderation_enabled) so the
 * owner can approve or remove them.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface PostRow {
  id: string;
  slug: string;
  title: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  body: string;
  status: string;
  created_at: string;
  author_username: string | null;
}

export default function BlogCommentsModerationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [byPost, setByPost] = useState<Record<string, CommentRow[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    const postsRes = await fetch(`/api/blogs/${slug}/posts?type=article&status=published&limit=50`, { credentials: "include" });
    const postsJson = await postsRes.json().catch(() => null);
    const list: PostRow[] = postsJson?.data?.posts ?? [];
    setPosts(list);

    const entries = await Promise.all(
      list.map(async (p) => {
        const res = await fetch(`/api/blogs/${slug}/posts/${p.slug}/comments`, { credentials: "include" });
        const json = await res.json().catch(() => null);
        const comments: CommentRow[] = (json?.data?.comments ?? []).filter((c: CommentRow) => c.status === "pending");
        return [p.id, comments] as const;
      })
    );
    setByPost(Object.fromEntries(entries.filter(([, c]) => c.length > 0)));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const b = json?.data?.blog;
        if (!b) { router.replace("/blogs/new"); return; }
        setBlogSlug(b.slug);
        void load(b.slug);
      });
  }, [router, load]);

  async function handleModerate(postId: string, commentId: string, action: "approve" | "remove") {
    if (!blogSlug) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    await fetch(`/api/blogs/${blogSlug}/posts/${post.slug}/comments/${commentId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setByPost((prev) => ({ ...prev, [postId]: (prev[postId] ?? []).filter((c) => c.id !== commentId) }));
  }

  const pending = Object.entries(byPost);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">{t("blogs.dashboard.commentsTitle", "Pending Comments")}</h1>
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">{t("blogs.dashboard.commentsEmpty", "No comments awaiting approval.")}</div>
      ) : (
        <div className="space-y-4">
          {pending.map(([postId, comments]) => {
            const post = posts.find((p) => p.id === postId);
            return (
              <div key={postId}>
                <div className="text-xs font-semibold text-muted-foreground mb-1">{post?.title}</div>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="text-xs text-muted-foreground mb-1">@{c.author_username ?? "unknown"}</div>
                      <p className="text-sm text-foreground">{c.body}</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => handleModerate(postId, c.id, "approve")} className="rounded-lg bg-emerald-950/40 px-2 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-950/70">
                          {t("blogs.dashboard.approve", "Approve")}
                        </button>
                        <button onClick={() => handleModerate(postId, c.id, "remove")} className="rounded-lg bg-red-950/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-950/70">
                          {t("blogs.dashboard.remove", "Remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
