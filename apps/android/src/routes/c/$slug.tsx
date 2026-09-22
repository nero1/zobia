/**
 * apps/android/src/routes/c/$slug.tsx
 *
 * In-app landing for classroom links: https://<web>/c/<slug> App Links,
 * zobia://c/<slug>, feed cards (/c/<id>) and notification taps
 * (lib/notifications/actionRoute.ts on web emits /c/<slug>). Resolves the
 * slug — current, retired (renamed) or a UUID — via
 * GET /api/classroom/resolve/:identifier and replaces itself with the
 * classroom homepage (/classroom/$roomId).
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiError, get } from '@/lib/classroom/api';

function ClassroomLinkPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ id: string }>(`/resolve/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!cancelled) void navigate({ to: '/classroom/$roomId', params: { roomId: r.id }, replace: true });
      })
      .catch((e) => {
        if (!cancelled) setError(apiError(e).message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  if (error) {
    return (
      <div className="space-y-2 p-6 text-center">
        <p className="text-4xl">🏫</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{error}</p>
        <Link to="/classroom" className="text-sm font-medium text-primary-600">
          {t('classroom.home.back', 'All classrooms')}
        </Link>
      </div>
    );
  }
  return <div className="p-6"><div className="h-32 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
}

export const Route = createFileRoute('/c/$slug')({
  component: ClassroomLinkPage,
});
