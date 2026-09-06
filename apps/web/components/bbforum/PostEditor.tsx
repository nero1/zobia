"use client";

/**
 * components/bbforum/PostEditor.tsx
 *
 * Shared post/reply composer for the BB-style forum: a Plain Text / Markdown
 * tab switch (content_format), an optional image attachment (uploaded via
 * /api/forum/uploads/image, which may cost Credits/Stars per admin config),
 * and an optional quoted-post preview banner (set by "Quote" on a post).
 *
 * Plain text is rendered as-is server-side, preserving line/paragraph
 * spacing while collapsing runs of 2+ blank lines to one (see
 * lib/security/htmlSanitizer.plainTextToBlogPostHtml) — this editor doesn't
 * need to reproduce that logic, it just collects the raw source text.
 */

import { useRef, useState } from "react";

export interface QuotedPreview {
  id: string;
  authorName: string;
  bodySnippet: string;
}

interface PostEditorProps {
  body: string;
  onBodyChange: (v: string) => void;
  contentFormat: "plaintext" | "markdown";
  onContentFormatChange: (v: "plaintext" | "markdown") => void;
  imageUrl: string | null;
  onImageUrlChange: (v: string | null) => void;
  quoted?: QuotedPreview | null;
  onClearQuote?: () => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  imageCostLabel?: string | null;
}

export function PostEditor({
  body, onBodyChange, contentFormat, onContentFormatChange,
  imageUrl, onImageUrlChange, quoted, onClearQuote,
  placeholder, rows = 5, maxLength = 20000, imageCostLabel,
}: PostEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/forum/uploads/image", { method: "POST", credentials: "include", body: formData });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Upload failed");
      onImageUrlChange(json.data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {quoted && (
        <div className="flex items-start gap-2 rounded-lg border-l-4 border-primary-400 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-neutral-700 dark:text-neutral-200">Quoting {quoted.authorName}</p>
            <p className="truncate">{quoted.bodySnippet}</p>
          </div>
          {onClearQuote && (
            <button type="button" onClick={onClearQuote} className="shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">✕</button>
          )}
        </div>
      )}

      <div className="flex gap-1 text-xs font-semibold">
        {(["plaintext", "markdown"] as const).map((fmt) => (
          <button
            key={fmt}
            type="button"
            onClick={() => onContentFormatChange(fmt)}
            className={`rounded-t-lg px-3 py-1.5 ${
              contentFormat === fmt
                ? "bg-white text-primary-700 dark:bg-neutral-900 dark:text-primary-300"
                : "bg-neutral-100 text-neutral-500 hover:text-neutral-700 dark:bg-neutral-800 dark:hover:text-neutral-300"
            }`}
          >
            {fmt === "plaintext" ? "Plain Text" : "Markdown"}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder={placeholder ?? (contentFormat === "markdown" ? "Write in Markdown…" : "What's on your mind?")}
        rows={rows}
        maxLength={maxLength}
        className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileSelect} className="hidden" id="bbforum-image-input" />
        <label
          htmlFor="bbforum-image-input"
          className="cursor-pointer rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-700 dark:text-neutral-300"
        >
          {uploading ? "Uploading…" : "📷 Add image"}
        </label>
        {imageCostLabel && <span className="text-[11px] text-neutral-400">{imageCostLabel}</span>}
        {imageUrl && (
          <button type="button" onClick={() => onImageUrlChange(null)} className="text-xs font-semibold text-red-600 hover:underline">
            Remove image
          </button>
        )}
      </div>
      {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Attachment preview" className="max-h-48 rounded-lg border border-neutral-200 dark:border-neutral-700" />
      )}
    </div>
  );
}
