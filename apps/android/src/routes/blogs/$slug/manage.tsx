/**
 * apps/android/src/routes/blogs/$slug/manage.tsx
 *
 * Minimal owner-facing "manage my blog" screen for Android — mirrors the
 * genuinely-new pieces of apps/web's dashboard for this phase: the article
 * quota nag, batch post draft/delete, and the menu-item list editor. Full
 * parity with the web dashboard (create/edit post, comment moderation,
 * stats) is a pre-existing gap on Android from before this phase and is
 * out of scope here — see this phase's report for what's deferred and why.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import { DEFAULT_MENU_CONFIG, type BlogMenuConfig, type BlogMenuItem } from '@/lib/blogs/menu';

interface PostRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  is_paywalled: boolean;
  view_count: number;
  like_count: number;
}

interface LimitsData {
  plan: string;
  used: number;
  maxPosts: number;
  remaining: number;
  planMaxPosts: { plus: number; pro: number; max: number };
}

async function fetchLimits(slug: string) {
  const { data } = await apiClient.get<LimitsData>(`/blogs/${slug}/limits`);
  return data ?? null;
}

async function fetchPosts(slug: string, status: 'published' | 'draft') {
  const { data } = await apiClient.get<{ posts: PostRow[] }>(`/blogs/${slug}/posts?type=article&status=${status}&limit=50`);
  return data?.posts ?? [];
}

async function fetchMenu(slug: string) {
  const { data } = await apiClient.get<{ blog: { menu_config?: BlogMenuConfig } }>(`/blogs/${slug}`);
  return data?.blog?.menu_config ?? DEFAULT_MENU_CONFIG;
}

function ManageBlogPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'published' | 'draft'>('published');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuConfig, setMenuConfig] = useState<BlogMenuConfig>(DEFAULT_MENU_CONFIG);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const limitsQuery = useQuery({ queryKey: ['blogs', 'limits', slug], queryFn: () => fetchLimits(slug) });
  const postsQuery = useQuery({ queryKey: ['blogs', 'manage-posts', slug, status], queryFn: () => fetchPosts(slug, status) });
  const menuQuery = useQuery({ queryKey: ['blogs', 'menu', slug], queryFn: () => fetchMenu(slug) });

  useEffect(() => { if (menuQuery.data) setMenuConfig(menuQuery.data); }, [menuQuery.data]);
  useEffect(() => { setSelected(new Set()); }, [status]);

  const batchMutation = useMutation({
    mutationFn: (action: 'draft' | 'delete') => apiClient.patch(`/blogs/${slug}/posts/batch`, { postIds: Array.from(selected), action }),
    onSuccess: () => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['blogs', 'manage-posts', slug] });
    },
  });

  const saveMenu = useMutation({
    mutationFn: (next: BlogMenuConfig) => apiClient.patch(`/blogs/${slug}`, { menuConfig: next }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['blogs', 'menu', slug] }),
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyMenu(next: BlogMenuConfig) {
    setMenuConfig(next);
    saveMenu.mutate(next);
  }

  function addMenuItem() {
    if (!newLabel.trim()) return;
    const item: BlogMenuItem = { id: `item-${Date.now()}`, label: newLabel.trim(), type: 'url', externalUrl: newUrl.trim() || '/' };
    applyMenu({ ...menuConfig, items: [...menuConfig.items, item] });
    setNewLabel('');
    setNewUrl('');
  }

  function removeMenuItem(id: string) {
    applyMenu({ ...menuConfig, items: menuConfig.items.filter((it) => it.id !== id) });
  }

  function moveMenuItem(id: string, dir: -1 | 1) {
    const items = [...menuConfig.items];
    const i = items.findIndex((it) => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    applyMenu({ ...menuConfig, items });
  }

  const limits = limitsQuery.data;
  const exhausted = !!limits && limits.remaining <= 0;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('blogs.manage.title', 'Manage blog')}</h1>

      {limits && (
        <div className={`rounded-xl border p-3 text-sm ${exhausted ? 'border-red-200 bg-red-50 text-red-700' : 'border-neutral-200 bg-white text-neutral-800'}`}>
          {exhausted ? (
            <p className="font-medium">{t('blogs.quota.exhausted', 'You have used up all your available articles ({{max}}). Delete some or upgrade your plan for more articles.', { max: limits.maxPosts })}</p>
          ) : (
            <p className="font-medium">
              {t('blogs.quota.remaining', 'You have {{count}} article(s) left.', { count: limits.remaining })}{' '}
              {limits.plan !== 'max' && t('blogs.quota.upgradeHint', 'Upgrade your plan for more articles.')}
            </p>
          )}
          {limits.plan !== 'max' && (
            <p className="mt-1 text-xs text-neutral-500">
              {t('blogs.quota.planSummary', 'Plus: {{plus}} articles · Pro: {{pro}} articles · Max: {{max}} articles', { plus: limits.planMaxPosts.plus, pro: limits.planMaxPosts.pro, max: limits.planMaxPosts.max })}
            </p>
          )}
          {limits.plan !== 'max' && (
            // Android has no in-app plan/upgrade screen yet — opens the same
            // web subscription page other Zobia surfaces link to, in the
            // system browser (mirrors how AdSlot/other Android screens open
            // external destinations via @capacitor/browser).
            <button
              onClick={() => void Browser.open({ url: `${env.VITE_API_BASE_URL}/settings/subscription` })}
              className="mt-2 inline-block rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              {t('blogs.quota.upgradeButton', 'Upgrade plan')}
            </button>
          )}
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('blogs.manage.postsTitle', 'Posts')}</h2>
        <div className="mb-2 flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 w-fit">
          {(['published', 'draft'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize ${status === s ? 'bg-primary-600 text-white' : 'text-neutral-600'}`}
            >
              {s === 'published' ? t('blogs.status.published', 'Published') : t('blogs.status.draft', 'Drafts')}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="mb-2 flex gap-2">
            <button
              disabled={batchMutation.isPending}
              onClick={() => batchMutation.mutate('draft')}
              className="rounded-lg bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-800 disabled:opacity-50"
            >
              {t('blogs.dashboard.batchDraft', 'Move to draft')}
            </button>
            <button
              disabled={batchMutation.isPending}
              onClick={() => batchMutation.mutate('delete')}
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              {t('blogs.dashboard.batchDelete', 'Delete selected')}
            </button>
          </div>
        )}

        {postsQuery.isPending ? (
          <div className="h-16 rounded bg-neutral-200 animate-pulse" />
        ) : (postsQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500 text-center py-6">{t('blogs.dashboard.empty', 'Nothing here yet.')}</p>
        ) : (
          <div className="space-y-1.5">
            {postsQuery.data!.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2.5">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} />
                <span className="flex-1 truncate text-sm text-neutral-800">{p.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-1">{t('blogs.settings.menuTitle', 'Navigation menu')}</h2>
        <p className="mb-2 text-xs text-neutral-500">
          {t('blogs.manage.menuHintMobile', "Always shown as a vertical menu inside the hamburger icon on Android — the horizontal option only applies on desktop web.")}
        </p>
        <div className="space-y-1.5 mb-2">
          {menuConfig.items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2">
              <span className="flex-1 truncate text-sm text-neutral-800">{item.label}</span>
              <button onClick={() => moveMenuItem(item.id, -1)} disabled={i === 0} className="rounded bg-neutral-100 px-2 py-1 text-xs disabled:opacity-30">↑</button>
              <button onClick={() => moveMenuItem(item.id, 1)} disabled={i === menuConfig.items.length - 1} className="rounded bg-neutral-100 px-2 py-1 text-xs disabled:opacity-30">↓</button>
              <button onClick={() => removeMenuItem(item.id)} className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">{t('blogs.settings.menuRemove', 'Remove')}</button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('blogs.settings.menuLabelPlaceholder', 'Label (e.g. About)')}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={t('blogs.settings.menuUrlPlaceholder', 'Link (e.g. /about-page-post-slug or https://…)')}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
          <button onClick={addMenuItem} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
            {t('blogs.settings.menuAdd', 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/blogs/$slug/manage')({
  component: ManageBlogPage,
});
