"use client";

/**
 * components/bbforum/PostCard.tsx
 *
 * One post/reply in a thread: author header, sanitized body (pre-rendered
 * server-side), optional image, optional quoted-post preview, reactions,
 * and an actions menu (Quote / Edit / Delete / Report) gated by ownership
 * or moderator status.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PostBody } from "@/components/bbforum/PostBody";
import { PostEditor } from "@/components/bbforum/PostEditor";

export interface PostCardData {
  id: string;
  bodyHtml: string;
  rawBody: string;
  contentFormat: "plaintext" | "markdown";
  imageUrl: string | null;
  isOp: boolean;
  authorId: string;
  authorName: string;
  authorAvatarEmoji: string;
  createdAt: string;
  editedAt: string | null;
  reactionCount: number;
  myReaction: string | null;
  quotedAuthorName: string | null;
  quotedBodySnippet: string | null;
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function PostCard({
  post, viewerId, isModerator, onQuote,
}: {
  post: PostCardData;
  viewerId: string | null;
  isModerator: boolean;
  onQuote: (post: PostCardData) => void;
}) {
  const router = useRouter();
  const [showReactions, setShowReactions] = useState(false);
  const [myReaction, setMyReaction] = useState(post.myReaction);
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.rawBody);
  const [editFormat, setEditFormat] = useState(post.contentFormat);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(post.imageUrl);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const canModify = viewerId === post.authorId || isModerator;

  async function handleReact(emoji: string) {
    setShowReactions(false);
    try {
      const res = await fetch(`/api/forum/posts/${post.id}/react`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      const json = await res.json();
      if (json.success) {
        setMyReaction(json.data.myReaction);
        setReactionCount(json.data.reactionCount);
      }
    } catch { /* best-effort */ }
  }

  async function handleSaveEdit() {
    if (editBody.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forum/posts/${post.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody.trim(), contentFormat: editFormat }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to save edit");
      setEditing(false);
      router.refresh();
    } catch { /* surfaced via disabled state; keep UI simple */ } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forum/posts/${post.id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (json.success) { setDeleted(true); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }

  async function handleReport() {
    setMenuOpen(false);
    const reportType = window.prompt("Report reason (spam, harassment, hate_speech, violence, sexual_content, misinformation, self_harm, scam, other):", "other");
    if (!reportType) return;
    await fetch("/api/reports", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedBbPostId: post.id, reportType }),
    }).catch(() => {});
    window.alert("Thanks — this post has been reported to moderators.");
  }

  if (deleted) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
        <span className="text-base">{post.authorAvatarEmoji}</span>
        <span className="font-semibold text-neutral-800 dark:text-neutral-200">{post.authorName}</span>
        {post.isOp && <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-300">OP</span>}
        <span>·</span>
        <span>{timeAgo(post.createdAt)}</span>
        {post.editedAt && <span className="italic text-neutral-400">(edited)</span>}
        <div className="ml-auto relative">
          <button onClick={() => setMenuOpen((v) => !v)} className="rounded px-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">⋯</button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-10 w-36 rounded-lg border border-neutral-200 bg-white py-1 shadow-modal dark:border-neutral-700 dark:bg-neutral-800">
              <button onClick={() => { setMenuOpen(false); onQuote(post); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-700">Quote</button>
              {canModify && <button onClick={() => { setMenuOpen(false); setEditing(true); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-700">Edit</button>}
              {canModify && <button disabled={busy} onClick={handleDelete} className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Delete</button>}
              {!canModify && <button onClick={handleReport} className="block w-full px-3 py-1.5 text-left text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950">Report</button>}
            </div>
          )}
        </div>
      </div>

      {post.quotedAuthorName && (
        <div className="mb-2 rounded-lg border-l-4 border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60">
          <span className="font-semibold">{post.quotedAuthorName} wrote:</span> {post.quotedBodySnippet}
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <PostEditor body={editBody} onBodyChange={setEditBody} contentFormat={editFormat} onContentFormatChange={setEditFormat} imageUrl={editImageUrl} onImageUrlChange={setEditImageUrl} rows={4} />
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold dark:border-neutral-700">Cancel</button>
            <button disabled={busy} onClick={handleSaveEdit} className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Save</button>
          </div>
        </div>
      ) : (
        <>
          <PostBody html={post.bodyHtml} />
          {post.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.imageUrl} alt="" className="mt-2 max-h-96 rounded-lg border border-neutral-200 dark:border-neutral-700" />
          )}
        </>
      )}

      <div className="relative mt-2 flex items-center gap-2">
        <button
          onClick={() => (viewerId ? setShowReactions((v) => !v) : router.push("/auth/login"))}
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${myReaction ? "border-primary-400 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300" : "border-neutral-200 text-neutral-500 dark:border-neutral-700"}`}
        >
          {myReaction ?? "🙂"} {reactionCount > 0 && reactionCount}
        </button>
        {showReactions && (
          <div className="absolute bottom-8 left-0 z-10 flex gap-1 rounded-full border border-neutral-200 bg-white p-1 shadow-modal dark:border-neutral-700 dark:bg-neutral-800">
            {REACTION_EMOJIS.map((emoji) => (
              <button key={emoji} onClick={() => handleReact(emoji)} className="rounded-full p-1 text-base hover:bg-neutral-100 dark:hover:bg-neutral-700">{emoji}</button>
            ))}
          </div>
        )}
        <button onClick={() => onQuote(post)} className="text-xs font-semibold text-neutral-500 hover:text-primary-600">Quote</button>
      </div>
    </div>
  );
}
