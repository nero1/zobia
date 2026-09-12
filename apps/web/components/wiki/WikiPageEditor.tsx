"use client";

/**
 * components/wiki/WikiPageEditor.tsx
 *
 * Shared create/edit form for a wiki page — title + Markdown/plain-text
 * content, and (when editing) an edit summary. Mirrors
 * components/blogs/PostEditor.tsx's shape. The authoritative sanitized
 * HTML is always generated server-side (lib/wiki/service.ts); this editor
 * never renders untrusted HTML itself.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export type WikiContentFormat = "markdown" | "plaintext";

export interface WikiPageEditorInitial {
  title: string;
  contentMarkdown: string;
  contentFormat: WikiContentFormat;
}

const EMPTY: WikiPageEditorInitial = {
  title: "",
  contentMarkdown: "",
  contentFormat: "markdown",
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function WikiPageEditor({
  wikiSlug,
  pageSlug,
  initial,
}: {
  wikiSlug: string;
  /** Present when editing an existing page (creates a new revision on save). */
  pageSlug?: string;
  initial?: Partial<WikiPageEditorInitial>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [form, setForm] = useState<WikiPageEditorInitial>({ ...EMPTY, ...initial });
  const [editSummary, setEditSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const payload = pageSlug
        ? {
            title: form.title,
            contentMarkdown: form.contentMarkdown,
            contentFormat: form.contentFormat,
            editSummary: editSummary || undefined,
          }
        : {
            title: form.title,
            contentMarkdown: form.contentMarkdown,
            contentFormat: form.contentFormat,
          };
      const url = pageSlug ? `/api/wiki/${wikiSlug}/pages/${pageSlug}` : `/api/wiki/${wikiSlug}/pages`;
      const method = pageSlug ? "PATCH" : "POST";
      const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.editor.errors.generic", "Failed to save page"));

      const savedSlug = pageSlug ?? (json?.data?.slug as string | undefined);
      router.push(savedSlug ? `/wiki/${wikiSlug}/${savedSlug}` : `/wiki/${wikiSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.editor.errors.generic", "Failed to save page"));
    } finally {
      setBusy(false);
    }
  }

  const words = wordCount(form.contentMarkdown);
  const canSave = !busy && form.title.trim().length > 0 && form.contentMarkdown.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        {pageSlug ? t("wiki.editor.editTitle", "Edit page") : t("wiki.editor.newTitle", "New page")}
      </h1>

      <div className="space-y-4">
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={t("wiki.editor.titlePlaceholder", "Page title")}
          maxLength={150}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-lg font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1 rounded-lg border border-border bg-neutral-900/50 p-0.5 w-fit">
              {(["markdown", "plaintext"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, contentFormat: mode }))}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${form.contentFormat === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mode === "markdown" ? t("wiki.editor.modeMarkdown", "Markdown") : t("wiki.editor.modePlainText", "Plain text")}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {form.contentFormat === "markdown"
                ? t("wiki.editor.modeMarkdownHint", "Use #, *, > etc. for formatting.")
                : t("wiki.editor.modePlainTextHint", "Blank lines start a new paragraph.")}
            </span>
          </div>
          <textarea
            value={form.contentMarkdown}
            onChange={(e) => setForm((f) => ({ ...f, contentMarkdown: e.target.value }))}
            placeholder={form.contentFormat === "markdown" ? t("wiki.editor.bodyPlaceholder", "Write the page content in Markdown…") : t("wiki.editor.bodyPlaceholderPlainText", "Write in plain text — leave a blank line between paragraphs…")}
            rows={18}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {t("wiki.editor.wordCount", "{{words}} words", { words })}
          </div>
        </div>

        {pageSlug && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.editor.summaryLabel", "Edit summary (optional)")}</label>
            <input
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder={t("wiki.editor.summaryPlaceholder", "What did you change?")}
              maxLength={300}
              className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("wiki.editor.saving", "Saving…") : pageSlug ? t("wiki.editor.saveChanges", "Save changes") : t("wiki.editor.createPage", "Create page")}
          </button>
        </div>
      </div>
    </div>
  );
}
