/**
 * apps/android/src/routes/wiki/invite/$token.tsx
 *
 * Invite preview + accept — GET shows the target wiki name and whether the
 * invite is expired/used; POST accepts it and joins as a collaborator, then
 * navigates to the wiki home. This is also the deep-link target for the
 * wiki_invite_received notification (see lib/notifications/routing.ts).
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchInvitePreview } from '@/lib/wiki/api';

function WikiInvitePage() {
  const { token } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const previewQuery = useQuery({ queryKey: ['wiki', 'invite', token], queryFn: () => fetchInvitePreview(token) });

  const accept = useMutation({
    mutationFn: () => apiClient.post<{ wikiId: string; wikiSlug: string }>(`/wiki/invites/${token}`, {}),
    onSuccess: (res) => navigate({ to: '/wiki/$slug', params: { slug: res.data.wikiSlug } }),
  });

  if (previewQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;

  const preview = previewQuery.data;
  if (!preview) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.invite.notFound', 'Invite not found.')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-3xl">📖</div>
        <h1 className="text-lg font-bold text-neutral-900">{t('wiki.invite.title', "You've been invited to contribute to {{name}}", { name: preview.wiki.name })}</h1>

        {preview.used ? (
          <p className="mt-3 text-sm text-neutral-500">{t('wiki.invite.used', 'This invite has already been used.')}</p>
        ) : preview.expired ? (
          <p className="mt-3 text-sm text-neutral-500">{t('wiki.invite.expired', 'This invite has expired.')}</p>
        ) : (
          <>
            {accept.isError && <p className="mt-2 text-sm text-red-600">{t('error.generic')}</p>}
            <button
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
              className="mt-4 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {accept.isPending ? t('wiki.invite.accepting', 'Joining…') : t('wiki.invite.accept', 'Join this wiki')}
            </button>
          </>
        )}

        <Link to="/wiki/$slug" params={{ slug: preview.wiki.slug }} className="mt-3 block text-xs text-neutral-400 underline underline-offset-2">
          {t('wiki.invite.viewWiki', 'View wiki')}
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/invite/$token')({
  component: WikiInvitePage,
});
