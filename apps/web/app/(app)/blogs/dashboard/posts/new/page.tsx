"use client";

/**
 * app/(app)/blogs/dashboard/posts/new/page.tsx
 *
 * New article/page. ?type=article|page selects the initial type.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PostEditor } from "@/components/blogs/PostEditor";

export default function NewBlogPostPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [blogSlug, setBlogSlug] = useState<string | null | undefined>(undefined);

  const blogParam = searchParams.get("blog");

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const blogs = json?.data?.blogs ?? [];
        if (blogs.length === 0) { router.replace("/blogs/new"); return; }
        if (blogs.length === 1) { setBlogSlug(blogs[0].slug); return; }
        const match = blogParam ? blogs.find((b: { slug: string }) => b.slug === blogParam) : undefined;
        if (!match) { router.replace("/blogs/dashboard"); return; }
        setBlogSlug(match.slug);
      })
      .catch(() => setBlogSlug(null));
  }, [router, blogParam]);

  if (!blogSlug) return null;

  const type = searchParams.get("type") === "page" ? "page" : "article";
  return <PostEditor blogSlug={blogSlug} initialType={type} />;
}
