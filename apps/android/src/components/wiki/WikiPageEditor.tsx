/**
 * apps/android/src/components/wiki/WikiPageEditor.tsx
 *
 * Shared title + content form for creating/editing a wiki page — used by
 * routes/wiki/$slug/pages/new.tsx and routes/wiki/$slug/pages/$pageSlug/edit.tsx.
 * Blogs has no equivalent editor component to adapt (post creation/editing
 * isn't on Android at all for blogs — see $slug/manage.tsx's header comment),
 * so this is new. No markdown-render preview: this app ships no markdown
 * library, and the server already returns sanitized content_html for the
 * view route — round-tripping through that on every keystroke isn't worth
 * the extra network calls on a Redis-metered backend. A "Format" toggle lets
 * the contributor pick plaintext when they don't want markdown escaping.
 */

import { useTranslation } from 'react-i18next';
import type { ContentFormat } from './types';

export type { ContentFormat };

export function WikiPageEditor({
  title,
  onTitleChange,
  content,
  onContentChange,
  format,
  onFormatChange,
  editSummary,
  onEditSummaryChange,
  showEditSummary,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  content: string;
  onContentChange: (v: string) => void;
  format: ContentFormat;
  onFormatChange: (v: ContentFormat) => void;
  editSummary?: string;
  onEditSummaryChange?: (v: string) => void;
  showEditSummary?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value.slice(0, 150))}
        placeholder={t('wiki.editor.titlePlaceholder', 'Page title')}
        className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
      />

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 w-fit">
        {(['markdown', 'plaintext'] as ContentFormat[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFormatChange(f)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize ${format === f ? 'bg-primary-600 text-white' : 'text-neutral-600'}`}
          >
            {f === 'markdown' ? t('wiki.editor.formatMarkdown', 'Markdown') : t('wiki.editor.formatPlaintext', 'Plain text')}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => onContentChange(e.target.value.slice(0, 50_000))}
        rows={14}
        placeholder={t('wiki.editor.contentPlaceholder', 'Write the page content…')}
        className="w-full resize-y rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 font-mono focus:border-primary-500 focus:outline-none"
      />

      {showEditSummary && (
        <input
          value={editSummary ?? ''}
          onChange={(e) => onEditSummaryChange?.(e.target.value.slice(0, 300))}
          placeholder={t('wiki.editor.editSummaryPlaceholder', 'What did you change? (optional)')}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
      )}
    </div>
  );
}
