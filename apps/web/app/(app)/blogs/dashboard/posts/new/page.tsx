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

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const b = json?.data?.blog;
        if (!b) { router.replace("/blogs/new"); return; }
        setBlogSlug(b.slug);
      })
      .catch(() => setBlogSlug(null));
  }, [router]);

  if (!blogSlug) return null;

  const type = searchParams.get("type") === "page" ? "page" : "article";
  return <PostEditor blogSlug={blogSlug} initialType={type} />;
}
