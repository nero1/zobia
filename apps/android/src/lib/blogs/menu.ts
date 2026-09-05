/**
 * apps/android/src/lib/blogs/menu.ts
 *
 * Mirrors apps/web/lib/blogs/menu.ts's BlogMenuConfig/BlogMenuItem shape and
 * resolveMenuItemHref logic (adapted to TanStack Router `to`/`params` links
 * instead of Next.js hrefs) — see that file for the field/type rationale.
 * Android always renders the menu as a vertical accordion regardless of the
 * owner's orientation choice (that choice is desktop-web only), so this
 * module doesn't need an orientation-aware renderer, just href resolution.
 */

export type BlogMenuItemType = "url" | "post" | "page" | "category";

export interface BlogMenuItem {
  id: string;
  label: string;
  type: BlogMenuItemType;
  targetId?: string | null;
  externalUrl?: string | null;
}

export type BlogMenuOrientation = "horizontal" | "vertical";

export interface BlogMenuConfig {
  orientation: BlogMenuOrientation;
  items: BlogMenuItem[];
}

export const DEFAULT_MENU_CONFIG: BlogMenuConfig = {
  orientation: "horizontal",
  items: [
    { id: "home", label: "Home", type: "url", externalUrl: "/" },
    { id: "categories", label: "Categories", type: "url", externalUrl: "#categories" },
    { id: "subscribe", label: "Subscribe", type: "url", externalUrl: "#subscribe" },
  ],
};

/** Resolved destination for a menu item — either an in-app TanStack Router target, or an external URL to open in the system browser. */
export type ResolvedMenuTarget =
  | { kind: "internal"; to: "/blogs/$slug"; params: { slug: string } }
  | { kind: "internal"; to: "/blogs/$slug/$postSlug"; params: { slug: string; postSlug: string } }
  | { kind: "external"; url: string }
  | { kind: "none" };

export function resolveMenuItemTarget(blogSlug: string, item: BlogMenuItem): ResolvedMenuTarget {
  switch (item.type) {
    case "post":
    case "page":
      return item.targetId
        ? { kind: "internal", to: "/blogs/$slug/$postSlug", params: { slug: blogSlug, postSlug: item.targetId } }
        : { kind: "internal", to: "/blogs/$slug", params: { slug: blogSlug } };
    case "category":
      // Blogs don't have a dedicated per-category screen on Android yet
      // (same gap as web) — send the visitor to the blog home.
      return { kind: "internal", to: "/blogs/$slug", params: { slug: blogSlug } };
    case "url":
    default: {
      const url = item.externalUrl ?? "/";
      if (/^https?:\/\//i.test(url)) return { kind: "external", url };
      // "/" and "#anchor" both just mean "the blog home" on Android — there's
      // no client-side anchor-scroll equivalent to the web's "#categories".
      return { kind: "internal", to: "/blogs/$slug", params: { slug: blogSlug } };
    }
  }
}
