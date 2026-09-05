/**
 * lib/blogs/menu.ts
 *
 * Blog navigation menu config (migration 0021's `blogs.menu_config` jsonb
 * column). Generic item type so it doesn't hardcode a dependency on
 * default About/Privacy/Contact pages (a later phase) — an item is either a
 * raw URL (relative to the blog, absolute, or a same-page "#anchor"), or a
 * reference to one of the blog's own posts/pages/categories.
 *
 * Orientation ('horizontal' | 'vertical') is the owner's desktop-web
 * preference only. Per product spec, Android and mobile web/PWA always
 * render the menu as a vertical accordion inside the hamburger — see
 * components/blogs/BlogMenu.tsx / apps/android's mirror.
 */

export type BlogMenuItemType = "url" | "post" | "page" | "category";

export interface BlogMenuItem {
  /** Stable client-side id (not a DB id) — used as the React key and for reorder/remove. */
  id: string;
  label: string;
  type: BlogMenuItemType;
  /** post/page/category id this item points at, when type isn't 'url'. */
  targetId?: string | null;
  /** Destination for type:'url' — "/path", "#anchor", or an absolute "https://…" URL. */
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

const MAX_MENU_ITEMS = 20;

/** Defensively parse a menu_config value read back from the DB (or posted by a client), falling back to the default on anything malformed. */
export function normalizeMenuConfig(raw: unknown): BlogMenuConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_MENU_CONFIG;
  const obj = raw as Partial<BlogMenuConfig>;
  const orientation: BlogMenuOrientation = obj.orientation === "vertical" ? "vertical" : "horizontal";
  const items = Array.isArray(obj.items)
    ? obj.items
        .filter((it): it is BlogMenuItem => !!it && typeof it === "object" && typeof (it as BlogMenuItem).label === "string")
        .slice(0, MAX_MENU_ITEMS)
        .map((it, i) => ({
          id: typeof it.id === "string" && it.id ? it.id : `item-${i}`,
          label: it.label.trim().slice(0, 60),
          type: (["url", "post", "page", "category"] as const).includes(it.type) ? it.type : "url",
          targetId: it.targetId ?? null,
          externalUrl: it.externalUrl ?? null,
        }))
    : DEFAULT_MENU_CONFIG.items;
  return { orientation, items };
}

/**
 * Resolve an item's href relative to the blog. `type:'post'|'page'` items
 * store the post/page slug as targetId; `type:'category'` items link to the
 * homepage's categories section (blogs don't have a dedicated per-category
 * page yet); `type:'url'` items use externalUrl as-is (already
 * absolute/relative/anchor).
 */
export function resolveMenuItemHref(blogSlug: string, item: BlogMenuItem): string {
  switch (item.type) {
    case "post":
    case "page":
      return item.targetId ? `/b/${blogSlug}/${item.targetId}` : `/b/${blogSlug}`;
    case "category":
      return `/b/${blogSlug}#categories`;
    case "url":
    default: {
      const url = item.externalUrl ?? "/";
      if (/^https?:\/\//i.test(url) || url.startsWith("#")) return url;
      return `/b/${blogSlug}${url === "/" ? "" : url}`;
    }
  }
}
