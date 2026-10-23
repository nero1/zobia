import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { FeedContentType } from '@/lib/feed/types';
export function BookmarkButton({ contentType, contentId, title }: { contentType: FeedContentType; contentId: string; title: string }) {
  const { t } = useTranslation(); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  return <div className="flex items-center gap-2"><button disabled={busy} className="rounded-full border px-3 py-1 text-xs disabled:opacity-50" onClick={async () => {
    setBusy(true); setError(null);
    try {
      await apiClient.post('/bookmarks', { contentType, contentId, title: title.slice(0,200) || contentType });
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : t('bookmarks.saveError', 'Unable to save bookmark.')); }
    finally { setBusy(false); }
  }}>{saved ? t('bookmarks.saved', 'Saved') : t('bookmarks.save', 'Save bookmark')}</button>{error && <span role="alert" className="text-xs text-red-500">{error}</span>}</div>;
}
