"use client";

/**
 * components/blogs/BlogMenu.tsx
 *
 * The blog's own visitor-facing navigation menu (owner-configured via the
 * dashboard menu builder — see lib/blogs/menu.ts / dashboard/settings).
 * Visible to every visitor (not owner-only) — distinct from
 * BlogOwnerToolbar, which sits alongside it in <BlogNavBar> but is gated to
 * the owner/staff.
 *
 * Orientation is the owner's *desktop-web* choice only:
 *   - 'horizontal' -> a horizontal link bar, shown on desktop (lg+); on
 *     narrower viewports (mobile web/PWA) it falls back to the hamburger
 *     accordion below regardless.
 *   - 'vertical' -> always the hamburger + accordion, desktop included —
 *     per product spec, a hamburger/accordion is a legitimate desktop
 *     pattern here, not just a mobile fallback.
 * Android mirrors the 'always vertical accordion' branch unconditionally
 * (no orientation choice at all) — see apps/android's BlogMenu equivalent.
 *
 * Kept hardcoded-English (no i18n) — this renders on the public, SSR-first
 * /b/<slug> pages, which follow that existing convention (see
 * components/blogs/PostBody.tsx).
 */

import { useState } from "react";
import Link from "next/link";
import { resolveMenuItemHref, type BlogMenuConfig } from "@/lib/blogs/menu";

export function BlogMenu({ blogSlug, menuConfig }: { blogSlug: string; menuConfig: BlogMenuConfig }) {
  const [open, setOpen] = useState(false);
  if (menuConfig.items.length === 0) return null;

  const showHorizontalBar = menuConfig.orientation === "horizontal";

  return (
    <div className="mb-3">
      {showHorizontalBar && (
        <nav aria-label="Blog menu" className="hidden lg:flex flex-wrap gap-2 border-b border-border pb-3">
          {menuConfig.items.map((item) => (
            <Link key={item.id} href={resolveMenuItemHref(blogSlug, item)} className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700">
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <div className={showHorizontalBar ? "lg:hidden" : ""}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="blog-menu-accordion"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <rect x="2" y="4" width="16" height="2" rx="1" />
            <rect x="2" y="9" width="16" height="2" rx="1" />
            <rect x="2" y="14" width="16" height="2" rx="1" />
          </svg>
          Menu
        </button>
        {open && (
          <nav id="blog-menu-accordion" aria-label="Blog menu" className="mt-2 flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
            {menuConfig.items.map((item) => (
              <Link
                key={item.id}
                href={resolveMenuItemHref(blogSlug, item)}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
