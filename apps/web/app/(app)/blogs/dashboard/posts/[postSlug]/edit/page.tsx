"use client";

/**
 * app/(app)/blogs/dashboard/posts/[postSlug]/edit/page.tsx
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PostEditor, type PostEditorInitial } from "@/components/blogs/PostEditor";

export default function EditBlogPostPage() {
  const router = useRouter();
  const params = useParams<{ postSlug: string }>();
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [initial, setInitial] = useState<Partial<PostEditorInitial> | null>(null);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const blog = meJson?.data?.blog;
      if (!blog) { router.replace("/blogs/new"); return; }
      setBlogSlug(blog.slug);

      const postRes = await fetch(`/api/blogs/${blog.slug}/posts/${params.postSlug}`, { credentials: "include" });
      const postJson = await postRes.json().catch(() => null);
      const post = postJson?.data?.post;
      if (!post) { router.replace("/blogs/dashboard"); return; }

      setInitial({
        type: post.type,
        title: post.title,
        excerpt: post.excerpt ?? "",
        bodyMarkdown: post.body_markdown ?? "",
        featuredImageUrl: post.featured_image_url ?? "",
        categoryId: post.category_id ?? "",
        isPaywalled: post.is_paywalled,
        paywallCreditsCost: post.paywall_credits_cost,
        status: post.status,
      });
    })().catch(() => router.replace("/blogs/dashboard"));
  }, [params.postSlug, router]);

  if (!blogSlug || !initial) return null;
  return <PostEditor blogSlug={blogSlug} postSlug={params.postSlug} initial={initial} />;
}
