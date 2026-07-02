"use client";

/**
 * app/(app)/blogs/dashboard/settings/page.tsx
 *
 * Blog settings: comments on/off + moderation, author info box visibility,
 * subscriber count visibility, categories, and theme picker (reuses the
 * existing cosmetics store — GET/POST /api/economy/cosmetics(+/equip)).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

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
  const [blog, setBlog] = useState<BlogRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const b = meJson?.data?.blog;
      if (!b) { router.replace("/blogs/new"); return; }
      setBlog(b);

      const catRes = await fetch(`/api/blogs/${b.slug}/categories`, { credentials: "include" });
      const catJson = await catRes.json().catch(() => null);
      setCategories(catJson?.data?.categories ?? []);

      const themeRes = await fetch("/api/economy/cosmetics", { credentials: "include" });
      const themeJson = await themeRes.json().catch(() => null);
      setThemes((themeJson?.cosmetics ?? []).filter((c: { cosmetic_type: string }) => c.cosmetic_type === "blog_theme"));
    })();
  }, [router]);

  async function saveSetting(patch: Partial<BlogRow>) {
    if (!blog) return;
    setBlog({ ...blog, ...patch });
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
          <ToggleRow label={t("blogs.settings.commentsModeration", "Moderate comments before they're visible")} checked={blog.comments_moderation_enabled} onChange={(v) => saveSetting({ comments_moderation_enabled: v })} />
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
