"use client";

/**
 * app/(app)/blogs/dashboard/settings/page.tsx
 *
 * Blog settings: comments on/off + moderation, author info box visibility,
 * subscriber count visibility, categories, and theme picker (reuses the
 * existing cosmetics store — GET/POST /api/economy/cosmetics(+/equip)).
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { DEFAULT_MENU_CONFIG, type BlogMenuConfig, type BlogMenuItem } from "@/lib/blogs/menu";

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  comments_enabled: boolean;
  comments_moderation_enabled: boolean;
  hide_author_info: boolean;
  show_subscriber_count: boolean;
  avatar_url: string | null;
  cover_image_url: string | null;
  menu_config?: BlogMenuConfig;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  post_count: number;
}

interface ThemeItem {
  id: string;
  name: string;
  description: string | null;
  coins_cost: number | null;
  owned: boolean;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
      <span className="text-sm text-foreground">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function BlogSettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blogParam = searchParams.get("blog");
  const [blog, setBlog] = useState<BlogRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [menuConfig, setMenuConfig] = useState<BlogMenuConfig>(DEFAULT_MENU_CONFIG);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemUrl, setNewItemUrl] = useState("");

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const blogs: BlogRow[] = meJson?.data?.blogs ?? [];
      if (blogs.length === 0) { router.replace("/blogs/new"); return; }
      const b = blogs.length === 1 ? blogs[0] : blogs.find((x) => x.slug === blogParam);
      if (!b) { router.replace("/blogs/dashboard"); return; }
      setBlog(b);
      setMenuConfig(b.menu_config ?? DEFAULT_MENU_CONFIG);

      const catRes = await fetch(`/api/blogs/${b.slug}/categories`, { credentials: "include" });
      const catJson = await catRes.json().catch(() => null);
      setCategories(catJson?.data?.categories ?? []);

      const themeRes = await fetch("/api/economy/cosmetics", { credentials: "include" });
      const themeJson = await themeRes.json().catch(() => null);
      setThemes((themeJson?.cosmetics ?? []).filter((c: { cosmetic_type: string }) => c.cosmetic_type === "blog_theme"));
    })();
  }, [router, blogParam]);

  async function saveSetting(patch: Partial<BlogRow> | { menuConfig: BlogMenuConfig }) {
    if (!blog) return;
    setBlog({ ...blog, ...("menuConfig" in patch ? { menu_config: patch.menuConfig } : patch) });
    setSaving(true);
    try {
      await fetch(`/api/blogs/${blog.slug}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    if (!blog || !newCategory.trim()) return;
    const res = await fetch(`/api/blogs/${blog.slug}/categories`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategory.trim() }),
    });
    if (res.ok) {
      setNewCategory("");
      const catRes = await fetch(`/api/blogs/${blog.slug}/categories`, { credentials: "include" });
      const catJson = await catRes.json().catch(() => null);
      setCategories(catJson?.data?.categories ?? []);
    }
  }

  async function saveMenuConfig(next: BlogMenuConfig) {
    setMenuConfig(next);
    await saveSetting({ menuConfig: next });
  }

  function addMenuItem() {
    if (!newItemLabel.trim()) return;
    const item: BlogMenuItem = {
      id: `item-${Date.now()}`,
      label: newItemLabel.trim(),
      type: "url",
      externalUrl: newItemUrl.trim() || "/",
    };
    void saveMenuConfig({ ...menuConfig, items: [...menuConfig.items, item] });
    setNewItemLabel("");
    setNewItemUrl("");
  }

  function removeMenuItem(id: string) {
    void saveMenuConfig({ ...menuConfig, items: menuConfig.items.filter((it) => it.id !== id) });
  }

  function moveMenuItem(id: string, direction: -1 | 1) {
    const items = [...menuConfig.items];
    const idx = items.findIndex((it) => it.id === id);
    const swapWith = idx + direction;
    if (idx < 0 || swapWith < 0 || swapWith >= items.length) return;
    [items[idx], items[swapWith]] = [items[swapWith], items[idx]];
    void saveMenuConfig({ ...menuConfig, items });
  }

  function setOrientation(orientation: BlogMenuConfig["orientation"]) {
    void saveMenuConfig({ ...menuConfig, orientation });
  }

  async function buyOrEquipTheme(itemId: string, owned: boolean) {
    if (owned) {
      await fetch("/api/economy/cosmetics/equip", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
    } else {
      await fetch("/api/economy/cosmetics/purchase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, currency: "coins" }),
      }).then(async (res) => {
        if (res.ok) {
          setThemes((prev) => prev.map((th) => (th.id === itemId ? { ...th, owned: true } : th)));
        }
      });
    }
  }

  if (!blog) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{t("blogs.dashboard.settings", "Settings")}</h1>

      <div className="space-y-2">
        <ToggleRow label={t("blogs.settings.commentsEnabled", "Allow comments")} checked={blog.comments_enabled} onChange={(v) => saveSetting({ comments_enabled: v })} />
        {blog.comments_enabled && (
          <div>
            <ToggleRow label={t("blogs.settings.commentsModeration", "Moderate comments before they're visible")} checked={blog.comments_moderation_enabled} onChange={(v) => saveSetting({ comments_moderation_enabled: v })} />
            <p className="mt-1.5 px-1 text-xs text-muted-foreground">
              {t("blogs.settings.commentsModerationHint", "When enabled, new comments won't appear publicly until you approve them in Comments.")}
            </p>
          </div>
        )}
        <ToggleRow label={t("blogs.settings.hideAuthorInfo", "Hide author info box on articles")} checked={blog.hide_author_info} onChange={(v) => saveSetting({ hide_author_info: v })} />
        <ToggleRow label={t("blogs.settings.showSubscriberCount", "Show subscriber count publicly")} checked={blog.show_subscriber_count} onChange={(v) => saveSetting({ show_subscriber_count: v })} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">{t("blogs.settings.categories", "Categories")}</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          {categories.map((c) => (
            <span key={c.id} className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300">{c.name} ({c.post_count})</span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder={t("blogs.settings.newCategoryPlaceholder", "New category name")}
            className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <button onClick={addCategory} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            {t("blogs.settings.addCategory", "Add")}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">{t("blogs.settings.menuTitle", "Navigation menu")}</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("blogs.settings.menuHint", "Shown to every visitor on your blog. On desktop web this respects the orientation below; on Android and mobile web/PWA it's always a vertical menu inside the hamburger icon.")}
        </p>

        <div className="mb-3 flex gap-1 rounded-xl border border-border bg-neutral-900/50 p-1 w-fit">
          {(["horizontal", "vertical"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOrientation(o)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${menuConfig.orientation === o ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {o === "horizontal" ? t("blogs.settings.menuHorizontal", "Horizontal (desktop)") : t("blogs.settings.menuVertical", "Vertical (desktop)")}
            </button>
          ))}
        </div>

        <div className="space-y-1.5 mb-3">
          {menuConfig.items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{item.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {item.type === "url" ? item.externalUrl : `${item.type}: ${item.targetId ?? "—"}`}
                </div>
              </div>
              <button onClick={() => moveMenuItem(item.id, -1)} disabled={i === 0} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-30">↑</button>
              <button onClick={() => moveMenuItem(item.id, 1)} disabled={i === menuConfig.items.length - 1} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-30">↓</button>
              <button onClick={() => removeMenuItem(item.id)} className="rounded-lg bg-red-950/40 px-2 py-1 text-xs text-red-400 hover:bg-red-950/70">{t("blogs.settings.menuRemove", "Remove")}</button>
            </div>
          ))}
          {menuConfig.items.length === 0 && <p className="text-xs text-muted-foreground">{t("blogs.settings.menuEmpty", "No menu items yet.")}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            placeholder={t("blogs.settings.menuLabelPlaceholder", "Label (e.g. About)")}
            className="flex-1 min-w-[140px] rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <input
            value={newItemUrl}
            onChange={(e) => setNewItemUrl(e.target.value)}
            placeholder={t("blogs.settings.menuUrlPlaceholder", "Link (e.g. /about-page-post-slug or https://…)")}
            className="flex-1 min-w-[180px] rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <button onClick={addMenuItem} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            {t("blogs.settings.menuAdd", "Add")}
          </button>
        </div>
      </div>

      {themes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2">{t("blogs.settings.themes", "Blog Themes")}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {themes.map((th) => (
              <div key={th.id} className="rounded-xl border border-border bg-card p-3">
                <div className="font-medium text-foreground text-sm">{th.name}</div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{th.description}</p>
                <button
                  onClick={() => buyOrEquipTheme(th.id, th.owned)}
                  className="mt-2 w-full rounded-lg bg-neutral-800 px-2 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
                >
                  {th.owned ? t("blogs.settings.applyTheme", "Apply") : t("blogs.settings.buyTheme", "Buy for {{cost}} credits", { cost: th.coins_cost })}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {saving && <p className="text-xs text-muted-foreground">{t("blogs.settings.saving", "Saving…")}</p>}
    </div>
  );
}
