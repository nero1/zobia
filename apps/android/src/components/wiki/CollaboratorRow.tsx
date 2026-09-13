/**
 * apps/android/src/components/wiki/CollaboratorRow.tsx
 *
 * A single collaborator/moderator row for routes/wiki/$slug/manage.tsx —
 * pulled into its own component since the manage screen renders it in both
 * the "moderators" and "all collaborators" sections with different actions.
 */

import { useTranslation } from 'react-i18next';
import type { WikiCollaborator } from '@/lib/wiki/api';

export function CollaboratorRow({
  collaborator,
  busy,
  onGrantModerator,
  onRevokeModerator,
  onRemove,
}: {
  collaborator: WikiCollaborator;
  busy?: boolean;
  onGrantModerator?: () => void;
  onRevokeModerator?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const c = collaborator;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800 text-sm">
        {c.avatar_url ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" /> : '👤'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{c.display_name ?? `@${c.username}`}</p>
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
          {c.is_moderator ? t('wiki.manage.roleModerator', 'Moderator') : t('wiki.manage.roleContributor', 'Contributor')}
          {' · '}
          {t('wiki.manage.editCount', '{{count}} edits', { count: c.page_edit_count })}
        </p>
      </div>
      <div className="flex flex-shrink-0 gap-1.5">
        {onGrantModerator && (
          <button disabled={busy} onClick={onGrantModerator} className="rounded-lg bg-blue-100 dark:bg-blue-900/40 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 disabled:opacity-50">
            {t('wiki.manage.grantModerator', 'Make mod')}
          </button>
        )}
        {onRevokeModerator && (
          <button disabled={busy} onClick={onRevokeModerator} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50">
            {t('wiki.manage.revokeModerator', 'Remove mod')}
          </button>
        )}
        {onRemove && (
          <button disabled={busy} onClick={onRemove} className="rounded-lg bg-red-100 dark:bg-red-900/40 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 disabled:opacity-50">
            {t('wiki.manage.removeCollaborator', 'Remove')}
          </button>
        )}
      </div>
    </div>
  );
}
