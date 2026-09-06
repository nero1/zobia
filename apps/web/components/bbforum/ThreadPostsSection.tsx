"use client";

/**
 * components/bbforum/ThreadPostsSection.tsx
 *
 * Client island for a thread's post list + reply form. Owns the "currently
 * quoting" state shared between PostCard's Quote action and ReplyForm.
 * Bodies are pre-rendered to sanitized HTML server-side (see app/f/[slug]/page.tsx)
 * — this component never sanitizes or trusts client-supplied HTML itself.
 */

import { useRef, useState } from "react";
import { PostCard, type PostCardData } from "@/components/bbforum/PostCard";
import { ReplyForm } from "@/components/bbforum/ReplyForm";
import type { QuotedPreview } from "@/components/bbforum/PostEditor";

export function ThreadPostsSection({
  threadSlug, locked, posts, viewerId, isModerator,
}: {
  threadSlug: string;
  locked: boolean;
  posts: PostCardData[];
  viewerId: string | null;
  isModerator: boolean;
}) {
  const [quoted, setQuoted] = useState<QuotedPreview | null>(null);
  const replyRef = useRef<HTMLDivElement>(null);

  function handleQuote(post: PostCardData) {
    setQuoted({ id: post.id, authorName: post.authorName, bodySnippet: post.rawBody.slice(0, 140) });
    replyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <>
      <div className="space-y-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} viewerId={viewerId} isModerator={isModerator} onQuote={handleQuote} />
        ))}
      </div>
      <div ref={replyRef}>
        <ReplyForm threadSlug={threadSlug} locked={locked} quoted={quoted} onQuoteHandled={() => setQuoted(null)} />
      </div>
    </>
  );
}
