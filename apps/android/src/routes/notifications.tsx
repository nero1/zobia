/**
 * apps/android/src/routes/notifications.tsx
 *
 * Notifications list. GET /api/notifications. Mark one/some read:
 * POST /api/notifications/read { ids }. Mark all read:
 * POST /api/notifications/read-all.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { notificationsQueryKey, useNotificationsQuery, type NotificationsPayload } from '@/lib/notifications/queries';
import { resolveNotificationRoute } from '@/lib/notifications/routing';
import { PullToRefresh } from '@/components/ui/PullToRefresh';

function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, status, refetch } = useNotificationsQuery();
  const notifications = data?.notifications ?? [];

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => apiClient.post('/notifications/read', { ids }),
    onSuccess: (_res, ids) => {
      qc.setQueryData<NotificationsPayload>(notificationsQueryKey, (prev) => {
        if (!prev) return prev;
        const idSet = new Set(ids);
        let newlyRead = 0;
        const updated = prev.notifications.map((n) => {
          if (idSet.has(n.id) && !n.isRead) newlyRead++;
          return idSet.has(n.id) ? { ...n, isRead: true } : n;
        });
        // Decrement server-truth unreadCount rather than recomputing from the
        // loaded page — the full unread set can extend beyond what's fetched.
        return { notifications: updated, unreadCount: Math.max(0, prev.unreadCount - newlyRead) };
      });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiClient.post('/notifications/read-all', {}),
    onSuccess: () => {
      qc.setQueryData<NotificationsPayload>(notificationsQueryKey, (prev) =>
        prev ? { notifications: prev.notifications.map((n) => ({ ...n, isRead: true })), unreadCount: 0 } : prev
      );
    },
  });

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <PullToRefresh onRefresh={() => refetch()} className="h-full overflow-y-auto bg-white">
      {/* Header action */}
      {unreadCount > 0 && (
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <span className="text-sm text-neutral-500">{t('notifications.unread', { count: unreadCount })}</span>
          <button
            onClick={() => markAllReadMutation.mutate()}
            className="text-sm text-primary-600 font-medium"
          >
            {markAllReadMutation.isPending ? t('notifications.markingAll') : t('notifications.markAllRead')}
          </button>
        </div>
      )}

      {status === 'pending' && (
        <div className="divide-y divide-neutral-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-4 animate-pulse">
              <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('notifications.empty')}</p>
        </div>
      )}

      <div className="divide-y divide-neutral-100">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`px-4 py-4 ${!notification.isRead ? 'bg-primary-50' : 'bg-white'}`}
            onClick={() => {
              // ZSB-16 fix: tapping a notification used to only mark it read
              // and never navigate anywhere, unlike the web list which links
              // via notification.actionUrl. Re-validate the server-provided
              // actionUrl against the same allowlist the push tap handler
              // uses (lib/notifications/routing.ts) before navigating.
              if (!notification.isRead) {
                markReadMutation.mutate([notification.id]);
              }
              const route = resolveNotificationRoute(notification.actionUrl);
              if (route) navigate({ to: route as never });
            }}
          >
            <div className="flex items-start gap-3">
              {!notification.isRead && (
                <div className="w-2 h-2 rounded-full bg-primary-600 mt-2 flex-shrink-0" />
              )}
              <div className={!notification.isRead ? '' : 'pl-5'}>
                <p className="text-sm font-medium text-neutral-900">{notification.title}</p>
                <p className="text-sm text-neutral-500 mt-0.5">{notification.body}</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </PullToRefresh>
  );
}

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
});
