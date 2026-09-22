/**
 * apps/android/src/routes/classroom/by/$username.tsx
 *
 * "Classrooms by @username" / My Classrooms — mirrors
 * apps/web/app/(app)/classroom/by/[username]/page.tsx. Owners see every
 * classroom (hidden/archived flagged) with Share, Boost, listing toggle and
 * Manage; visitors see only public, active, listed classrooms.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiError, get, send, type ClassroomCard } from '@/lib/classroom/api';
import { ClassroomCardView } from '@/components/classroom/ClassroomCardView';
import { ClassroomBoostButton, ClassroomShareButton } from '@/components/classroom/ClassroomActions';

interface Listing {
  creator: { username: string; displayName: string; avatarEmoji: string };
  classrooms: ClassroomCard[];
  isOwner: boolean;
}

function CreatorClassroomsPage() {
  const { username } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['classroom', 'creator-listing', username.toLowerCase()];
  const listing = useQuery({ queryKey: key, queryFn: () => get<Listing>(`/creators/${encodeURIComponent(username)}`) });
  const toggle = useMutation({
    mutationFn: (c: ClassroomCard) => send('patch', `/${c.id}`, { showInCreatorListing: !c.showInCreatorListing }),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  if (listing.isPending) return <div className="p-4"><div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
  if (!listing.data) return <p className="m-4 text-sm text-danger-600">{apiError(listing.error).message}</p>;
  const { creator, classrooms, isOwner } = listing.data;
  const btn = 'rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold';

  return (
    <div className="space-y-4 p-4">
      <Link to="/classroom" className="text-sm text-neutral-500">
        ← {t('classroom.home.back', 'All classrooms')}
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-4xl">{creator.avatarEmoji}</span>
        <div>
          <h1 className="text-xl font-bold">{isOwner ? t('classroom.listing.mineTitle', 'My Classrooms') : t('classroom.listing.title', 'Classrooms by {{name}}', { name: creator.displayName })}</h1>
          <p className="text-sm text-neutral-500">@{creator.username}</p>
        </div>
      </div>
      {isOwner && (
        <p className="text-xs text-neutral-500">
          {t('classroom.listing.ownerHint', 'Visitors only see public, active classrooms you’ve chosen to list here. Use “Hide from listing” to keep a classroom off this page.')}
        </p>
      )}
      {classrooms.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          🏫 {isOwner ? t('classroom.listing.emptyOwner', "You haven't created a classroom yet.") : t('classroom.listing.empty', 'No classrooms listed yet.')}
        </p>
      ) : (
        classrooms.map((c) => (
          <ClassroomCardView
            key={c.id}
            classroom={c}
            actions={
              <>
                <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
                {isOwner && <ClassroomBoostButton roomId={c.id} name={c.name} />}
                {isOwner && (
                  <button type="button" onClick={() => toggle.mutate(c)} className={btn}>
                    {c.showInCreatorListing ? t('classroom.listing.hide', 'Hide from listing') : t('classroom.listing.show', 'Show in listing')}
                  </button>
                )}
                {isOwner && (
                  <Link to="/classroom/studio/$roomId" params={{ roomId: c.id }} className={btn}>
                    ⚙️ {t('classroom.home.manage', 'Manage')}
                  </Link>
                )}
              </>
            }
          />
        ))
      )}
    </div>
  );
}

export const Route = createFileRoute('/classroom/by/$username')({
  component: CreatorClassroomsPage,
});
