/**
 * apps/android/src/components/wiki/WikiOwnerToolbar.tsx
 *
 * Owner/moderator-only strip on the wiki home + page screens — mirrors
 * apps/android's BlogOwnerToolbar.tsx (components/blogs/BlogOwnerToolbar.tsx)
 * exactly, adapted for the wiki route names. `visible` (isOwner || canManage)
 * is resolved by the caller from the wiki detail / page detail response.
 */

import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function WikiOwnerToolbar({ wikiSlug, isOwner }: { wikiSlug: string; isOwner?: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <span className="font-semibold text-amber-700">
        {isOwner ? t('wiki.ownerToolbar.badge', 'Owner view') : t('wiki.ownerToolbar.modBadge', 'Moderator view')}
      </span>
      <Link to="/wiki/$slug/settings" params={{ slug: wikiSlug }} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-medium text-neutral-700">
        {t('wiki.ownerToolbar.settings', 'Settings')}
      </Link>
      <Link to="/wiki/$slug/manage" params={{ slug: wikiSlug }} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-medium text-neutral-700">
        {t('wiki.ownerToolbar.manage', 'Collaborators')}
      </Link>
      <Link to="/wiki/$slug/treasury" params={{ slug: wikiSlug }} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-medium text-neutral-700">
        {t('wiki.ownerToolbar.treasury', 'Reward pot')}
      </Link>
    </div>
  );
}
