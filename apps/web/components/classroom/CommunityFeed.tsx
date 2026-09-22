"use client";

/**
 * components/classroom/CommunityFeed.tsx
 *
 * The classroom's community feed (Skool-style): category chips, sort, a
 * composer, and posts with likes (1 like = 1 point for the author),
 * threaded comments, and moderator controls (pin, lock, hide, delete).
 * Everything is scoped to this one classroom.
 */

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import { ReportButton } from "@/components/classroom/ReportButton";
import { timeAgo, type ClassroomCommentView, type ClassroomHomePayload, type ClassroomPostView } from "@/components/classroom/types";

type Sort = "activity" | "new" | "top";

function AuthorChip({ author, levelName }: { author: ClassroomPostView["author"]; levelName: (level: number) => string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-base dark:bg-neutral-800">{author.avatarEmoji}</span>
      )}
      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{author.displayName}</span>
      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" title={levelName(author.level)}>
        {author.level}
      </span>
      {author.isCreator && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          {t("classroom.roles.creator", "Creator")}
        </span>
      )}
      {author.isModerator && !author.isCreator && (
        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
          {t("classroom.roles.moderator", "Moderator")}
        </span>
      )}
    </span>
  );
}

function LikeButton({ liked, count, disabled, onToggle }: { liked: boolean; count: number; disabled: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={liked}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        liked ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      } disabled:opacity-50`}
    >
      👍 {count > 0 ? count : t("classroom.feed.like", "Like")}
    </button>
  );
}

function PostThread({
  home,
  post,
  levelName,
}: {
  home: ClassroomHomePayload;
  post: ClassroomPostView;
  levelName: (level: number) => string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<ClassroomCommentView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const comments = useQuery({
    queryKey: ["classroom", roomId, "comments", post.id],
    queryFn: () => classroomApi<{ comments: ClassroomCommentView[] }>(`/${roomId}/posts/${post.id}/comments`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "comments", post.id] });
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "posts"] });
  };

  const addComment = useMutation({
    mutationFn: () =>
      classroomApi(`/${roomId}/posts/${post.id}/comments`, { method: "POST", body: { body: reply.trim(), parentId: replyTo?.id ?? null } }),
    onSuccess: () => {
      setReply("");
      setReplyTo(null);
      setError(null);
      refresh();
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  const likeComment = useMutation({
    mutationFn: (c: ClassroomCommentView) => classroomApi(`/${roomId}/comments/${c.id}/like`, { method: c.likedByMe ? "DELETE" : "POST" }),
    onSettled: refresh,
  });
  const deleteComment = useMutation({
    mutationFn: (c: ClassroomCommentView) => classroomApi(`/${roomId}/comments/${c.id}`, { method: "DELETE" }),
    onSettled: refresh,
  });
  const hideComment = useMutation({
    mutationFn: (c: ClassroomCommentView) => classroomApi(`/${roomId}/comments/${c.id}`, { method: "PATCH", body: { isHidden: !c.isHidden } }),
    onSettled: refresh,
  });

  const list = comments.data?.comments ?? [];
  const topLevel = list.filter((c) => !c.parentId);
  const repliesOf = (id: string) => list.filter((c) => c.parentId === id);
  const canComment = home.viewer.can.comment && (!post.isLocked || home.viewer.can.managePosts);

  const renderComment = (c: ClassroomCommentView, nested: boolean) => (
    <div key={c.id} className={`${nested ? "ml-8" : ""} rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-800/60 ${c.isHidden ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <AuthorChip author={c.author} levelName={levelName} />
        <span className="flex-shrink-0 text-[11px] text-neutral-400">{timeAgo(c.createdAt, t)}</span>
      </div>
      {c.isHidden && <p className="mt-1 text-[11px] font-semibold text-amber-600">{t("classroom.feed.hiddenNotice", "Hidden by a moderator")}</p>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800 dark:text-neutral-200">{c.body}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <LikeButton liked={c.likedByMe} count={c.likeCount} disabled={!home.viewer.can.like} onToggle={() => likeComment.mutate(c)} />
        {canComment && !nested && (
          <button type="button" onClick={() => setReplyTo(c)} className="text-xs text-neutral-500 hover:text-violet-600">
            {t("classroom.feed.reply", "Reply")}
          </button>
        )}
        {home.viewer.can.managePosts && (
          <button type="button" onClick={() => hideComment.mutate(c)} className="text-xs text-neutral-500 hover:text-amber-600">
            {c.isHidden ? t("classroom.feed.unhide", "Unhide") : t("classroom.feed.hide", "Hide")}
          </button>
        )}
        {c.canDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t("classroom.feed.deleteCommentConfirm", "Delete this comment?"))) deleteComment.mutate(c);
            }}
            className="text-xs text-neutral-500 hover:text-red-600"
          >
            {t("classroom.feed.delete", "Delete")}
          </button>
        )}
        {home.viewer.can.report && c.author.id !== home.viewer.userId && <ReportButton roomId={roomId} target={{ commentId: c.id }} />}
      </div>
    </div>
  );

  return (
    <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
      {comments.isPending ? (
        <div className="h-10 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
      ) : (
        topLevel.map((c) => (
          <div key={c.id} className="space-y-2">
            {renderComment(c, false)}
            {repliesOf(c.id).map((r) => renderComment(r, true))}
          </div>
        ))
      )}
      {canComment ? (
        <div className="space-y-1.5">
          {replyTo && (
            <p className="text-xs text-neutral-500">
              {t("classroom.feed.replyingTo", "Replying to {{name}}", { name: replyTo.author.displayName })}{" "}
              <button type="button" className="text-violet-600" onClick={() => setReplyTo(null)}>
                {t("classroom.common.cancel", "Cancel")}
              </button>
            </p>
          )}
          <div className="flex gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={1}
              maxLength={4000}
              placeholder={t("classroom.feed.commentPlaceholder", "Write a comment…")}
              className="min-h-[38px] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              type="button"
              disabled={!reply.trim() || addComment.isPending}
              onClick={() => addComment.mutate()}
              className="rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("classroom.feed.send", "Send")}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : post.isLocked ? (
        <p className="text-xs text-neutral-400">🔒 {t("classroom.feed.lockedNotice", "Comments are closed on this post.")}</p>
      ) : null}
    </div>
  );
}

function PostCard({ home, post, levelName }: { home: ClassroomHomePayload; post: ClassroomPostView; levelName: (level: number) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [editTitle, setEditTitle] = useState(post.title ?? "");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["classroom", roomId, "posts"] });

  const like = useMutation({
    mutationFn: () => classroomApi(`/${roomId}/posts/${post.id}/like`, { method: post.likedByMe ? "DELETE" : "POST" }),
    onSettled: refresh,
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => classroomApi(`/${roomId}/posts/${post.id}`, { method: "PATCH", body }),
    onSuccess: () => setEditing(false),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => classroomApi(`/${roomId}/posts/${post.id}`, { method: "DELETE" }),
    onSettled: refresh,
  });

  return (
    <article className={`rounded-xl border bg-white p-4 shadow-card dark:bg-neutral-900 ${post.isPinned ? "border-violet-300 dark:border-violet-800" : "border-neutral-200 dark:border-neutral-800"} ${post.isHidden ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <AuthorChip author={post.author} levelName={levelName} />
        <span className="flex-shrink-0 text-[11px] text-neutral-400">
          {timeAgo(post.createdAt, t)} · {post.category}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {post.isPinned && <span className="text-[11px] font-semibold text-violet-600">📌 {t("classroom.feed.pinned", "Pinned")}</span>}
        {post.isLocked && <span className="text-[11px] font-semibold text-neutral-500">🔒 {t("classroom.feed.locked", "Locked")}</span>}
        {post.isHidden && <span className="text-[11px] font-semibold text-amber-600">{t("classroom.feed.hiddenNotice", "Hidden by a moderator")}</span>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={4}
            maxLength={10000}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!editBody.trim() || patch.isPending}
              onClick={() => patch.mutate({ title: editTitle.trim() || null, body: editBody.trim() })}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("classroom.common.save", "Save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700 dark:text-neutral-200">
              {t("classroom.common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {post.title && <h3 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">{post.title}</h3>}
          <p className={`mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300 ${expanded ? "" : "line-clamp-6"}`}>{post.body}</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <LikeButton liked={post.likedByMe} count={post.likeCount} disabled={!home.viewer.can.like} onToggle={() => like.mutate()} />
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-neutral-500 hover:text-violet-600">
          💬 {t("classroom.feed.comments", "{{count}} comments", { count: post.commentCount })}
        </button>
        {post.canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-neutral-500 hover:text-violet-600">
            {t("classroom.feed.edit", "Edit")}
          </button>
        )}
        {home.viewer.can.managePosts && (
          <>
            <button type="button" onClick={() => patch.mutate({ isPinned: !post.isPinned })} className="text-xs text-neutral-500 hover:text-violet-600">
              {post.isPinned ? t("classroom.feed.unpin", "Unpin") : t("classroom.feed.pin", "Pin")}
            </button>
            <button type="button" onClick={() => patch.mutate({ isLocked: !post.isLocked })} className="text-xs text-neutral-500 hover:text-violet-600">
              {post.isLocked ? t("classroom.feed.unlock", "Unlock") : t("classroom.feed.lock", "Lock")}
            </button>
            <button type="button" onClick={() => patch.mutate({ isHidden: !post.isHidden })} className="text-xs text-neutral-500 hover:text-amber-600">
              {post.isHidden ? t("classroom.feed.unhide", "Unhide") : t("classroom.feed.hide", "Hide")}
            </button>
          </>
        )}
        {post.canDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t("classroom.feed.deletePostConfirm", "Delete this post?"))) remove.mutate();
            }}
            className="text-xs text-neutral-500 hover:text-red-600"
          >
            {t("classroom.feed.delete", "Delete")}
          </button>
        )}
        {home.viewer.can.report && post.author.id !== home.viewer.userId && <ReportButton roomId={roomId} target={{ postId: post.id }} />}
      </div>
      {expanded && <PostThread home={home} post={post} levelName={levelName} />}
    </article>
  );
}

function Composer({ home, onPosted }: { home: ClassroomHomePayload; onPosted: () => void }) {
  const { t } = useTranslation();
  const roomId = home.classroom.id;
  const staffy = home.viewer.can.managePosts || home.viewer.isModerator;
  const categories = home.classroom.postCategories.filter((c) => staffy || c.toLowerCase() !== "announcements");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "General");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => classroomApi(`/${roomId}/posts`, { method: "POST", body: { title: title.trim() || null, body: body.trim(), category } }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setOpen(false);
      setError(null);
      onPosted();
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm text-neutral-400 shadow-card hover:border-violet-300 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {t("classroom.feed.composerPrompt", "Write something…")}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-white p-4 shadow-card dark:border-violet-900 dark:bg-neutral-900">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder={t("classroom.feed.titlePlaceholder", "Title (optional)")}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={10000}
        placeholder={t("classroom.feed.bodyPlaceholder", "Share a question, a win or an idea with the class…")}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={t("classroom.feed.categoryLabel", "Category")}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:text-neutral-200">
            {t("classroom.common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            disabled={!body.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {create.isPending ? t("classroom.feed.posting", "Posting…") : t("classroom.feed.post", "Post")}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CommunityFeed({ home, levelName }: { home: ClassroomHomePayload; levelName: (level: number) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("activity");

  const feed = useInfiniteQuery({
    queryKey: ["classroom", roomId, "posts", category, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ sort });
      if (category) params.set("category", category);
      if (pageParam) params.set("cursor", pageParam);
      return classroomApi<{ posts: ClassroomPostView[]; nextCursor: string | null }>(`/${roomId}/posts?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="space-y-3">
      {home.viewer.mutedUntil && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("classroom.feed.mutedBanner", "You're muted in this classroom until {{date}}.", { date: new Date(home.viewer.mutedUntil).toLocaleString() })}
        </div>
      )}
      {home.viewer.can.createPost ? (
        <Composer home={home} onPosted={() => void qc.invalidateQueries({ queryKey: ["classroom", roomId, "posts"] })} />
      ) : home.classroom.postingPolicy === "moderators" && home.viewer.isEnrolled ? (
        <p className="text-xs text-neutral-500">{t("classroom.feed.moderatorsOnly", "Only the creator and moderators can start new posts here — join the conversation in the comments.")}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setCategory(null)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${category === null ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
        >
          {t("classroom.feed.allCategories", "All")}
        </button>
        {home.classroom.postCategories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(category === c ? null : c)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${category === c ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
          >
            {c}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label={t("classroom.directory.sortLabel", "Sort")}
          className="ml-auto rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          <option value="activity">{t("classroom.feed.sort.activity", "Latest activity")}</option>
          <option value="new">{t("classroom.feed.sort.new", "Newest")}</option>
          <option value="top">{t("classroom.feed.sort.top", "Most liked")}</option>
        </select>
      </div>

      {feed.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
          ))}
        </div>
      ) : feed.isError ? (
        <p className="text-sm text-red-600">{translateApiError(t, (feed.error as ClassroomApiError).code, (feed.error as Error).message)}</p>
      ) : posts.length === 0 ? (
        <div className="py-12 text-center">
          <span className="text-4xl">💬</span>
          <p className="mt-2 text-sm text-neutral-500">{t("classroom.feed.empty", "No posts yet — start the first conversation!")}</p>
        </div>
      ) : (
        <>
          {posts.map((p) => (
            <PostCard key={p.id} home={home} post={p} levelName={levelName} />
          ))}
          {feed.hasNextPage && (
            <button
              type="button"
              onClick={() => void feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="w-full rounded-xl border border-neutral-200 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {feed.isFetchingNextPage ? t("action.loading", "Loading…") : t("classroom.feed.loadMore", "Load more")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
