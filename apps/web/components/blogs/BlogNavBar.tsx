/**
 * components/blogs/BlogNavBar.tsx
 *
 * Composes the owner-only toolbar and the visitor-facing menu for the
 * public blog pages. A plain server component (no "use client") — its two
 * children each carry their own client/server nature; this just lays them
 * out and keeps them visually/structurally separate per product spec.
 */

import { BlogOwnerToolbar } from "@/components/blogs/BlogOwnerToolbar";
import { BlogMenu } from "@/components/blogs/BlogMenu";
import type { BlogMenuConfig } from "@/lib/blogs/menu";

export function BlogNavBar({
  blogSlug,
  menuConfig,
  showOwnerToolbar,
  previewHref,
  previewActive,
}: {
  blogSlug: string;
  menuConfig: BlogMenuConfig;
  showOwnerToolbar: boolean;
  previewHref?: string | null;
  previewActive?: boolean;
}) {
  return (
    <div className="mb-2">
      {showOwnerToolbar && <BlogOwnerToolbar blogSlug={blogSlug} previewHref={previewHref} previewActive={previewActive} />}
      <BlogMenu blogSlug={blogSlug} menuConfig={menuConfig} />
    </div>
  );
}
