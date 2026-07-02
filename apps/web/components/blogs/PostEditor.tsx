"use client";

/**
 * components/blogs/PostEditor.tsx
 *
 * Shared create/edit form for a blog article or page. Markdown body with a
 * live preview (rendered client-side with a tiny escaping formatter — the
 * authoritative sanitized HTML is always generated server-side via `marked`
 * + sanitize-html, see lib/security/htmlSanitizer.ts).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export interface BlogCategoryOption {
  id: string;
  name: string;
}

export interface PostEditorInitial {
  type: "article" | "page";
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  featuredImageUrl: string;
  categoryId: string;
  isPaywalled: boolean;
  paywallCreditsCost: number;
  status: "draft" | "published";
}

const EMPTY: PostEditorInitial = {
  type: "article",
  title: "",
  excerpt: "",
  bodyMarkdown: "",
  featuredImageUrl: "",
  categoryId: "",
  isPaywalled: false,
  paywallCreditsCost: 5,
  status: "draft",
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function PostEditor({
  blogSlug,
  postSlug,
  initial,
  initialType,
}: {
  blogSlug: string;
  postSlug?: string;
  initial?: Partial<PostEditorInitial>;
  initialType?: "article" | "page";
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [form, setForm] = useState<PostEditorInitial>({ ...EMPTY, ...(initialType ? { type: initialType } : {}), ...initial });
  const [categories, setCategories] = useState<BlogCategoryOption[]>([]);
  const [maxWords, setMaxWords] = useState<number>(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/blogs/${blogSlug}/categories`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setCategories(json?.data?.categories ?? []))
      .catch(() => {});
  }, [blogSlug]);

  async function handleSave(status: "draft" | "published") {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: form.type,
        title: form.title,
        excerpt: form.excerpt || undefined,
        bodyMarkdown: form.bodyMarkdown,
        featuredImageUrl: form.featuredImageUrl || undefined,
        categoryId: form.categoryId || undefined,
        isPaywalled: form.type === "article" ? form.isPaywalled : false,
        paywallCreditsCost: form.paywallCreditsCost,
        status,
      };
      const url = postSlug ? `/api/blogs/${blogSlug}/posts/${postSlug}` : `/api/blogs/${blogSlug}/posts`;
      const method = postSlug ? "PATCH" : "POST";
      const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) {
        setMaxWords(json?.error?.params?.maxWords ?? maxWords);
        throw new Error(json?.error?.message ?? "Failed to save");
      }
      router.push("/blogs/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  const words = wordCount(form.bodyMarkdown);
  const overLimit = form.type === "article" && words > maxWords;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        {postSlug ? t("blogs.editor.editTitle", "Edit {{type}}", { type: form.type }) : t("blogs.editor.newTitle", "New {{type}}", { type: form.type })}
      </h1>

      <div className="space-y-4">
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={t("blogs.editor.titlePlaceholder", "Title")}
          maxLength={200}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-lg font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {form.type === "article" && (
          <input
            value={form.excerpt}
            onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
            placeholder={t("blogs.editor.excerptPlaceholder", "Short excerpt (optional)")}
            maxLength={500}
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}

        <input
          value={form.featuredImageUrl}
          onChange={(e) => setForm((f) => ({ ...f, featuredImageUrl: e.target.value }))}
          placeholder={t("blogs.editor.featuredImagePlaceholder", "Featured image URL (optional)")}
          className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {form.type === "article" && categories.length > 0 && (
          <select
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">{t("blogs.editor.noCategory", "No category")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div>
          <textarea
            value={form.bodyMarkdown}
            onChange={(e) => setForm((f) => ({ ...f, bodyMarkdown: e.target.value }))}
            placeholder={t("blogs.editor.bodyPlaceholder", "Write in Markdown…")}
            rows={16}
            className={`w-full rounded-xl border bg-card px-4 py-3 text-sm text-foreground font-mono focus:outline-none focus:ring-1 ${overLimit ? "border-red-500 focus:ring-red-500" : "border-border focus:border-primary focus:ring-primary"}`}
          />
          <div className={`mt-1 text-xs ${overLimit ? "text-red-500" : "text-muted-foreground"}`}>
            {form.type === "article"
              ? t("blogs.editor.wordCount", "{{words}} / {{max}} words", { words, max: maxWords })
              : t("blogs.editor.wordCountPage", "{{words}} words", { words })}
          </div>
        </div>

        {form.type === "article" && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isPaywalled}
                onChange={(e) => setForm((f) => ({ ...f, isPaywalled: e.target.checked }))}
              />
              {t("blogs.editor.paywallToggle", "Pay-gate this article")}
            </label>
            {form.isPaywalled && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("blogs.editor.paywallCostLabel", "Cost to unlock:")}</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={form.paywallCreditsCost}
                  onChange={(e) => setForm((f) => ({ ...f, paywallCreditsCost: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                  className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
                <span className="text-sm text-muted-foreground">{t("blogs.editor.credits", "credits")}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("blogs.editor.paywallHint", "Readers who haven't unlocked will see a preview with a \"Pay {{cost}} credits to read the rest of the article\" notice.", { cost: form.paywallCreditsCost })}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !form.title.trim() || !form.bodyMarkdown.trim() || overLimit}
            onClick={() => handleSave("draft")}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          >
            {t("blogs.editor.saveDraft", "Save draft")}
          </button>
          <button
            type="button"
            disabled={busy || !form.title.trim() || !form.bodyMarkdown.trim() || overLimit}
            onClick={() => handleSave("published")}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t("blogs.editor.publish", "Publish")}
          </button>
        </div>
      </div>
    </div>
  );
}
