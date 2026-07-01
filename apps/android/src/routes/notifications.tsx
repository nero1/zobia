/**
 * apps/android/src/routes/notifications.tsx
 *
 * Notifications list. GET /api/notifications. Mark read: POST /api/notifications/read.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

async function fetchNotifications() {
  // The API responds with { notifications, unreadCount }, not { items }.
  const { data } = await apiClient.get<{ notifications: Notification[]; unreadCount: number }>('/notifications');
  return data?.notifications ?? [];
}

function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: notifications, status, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    staleTime: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => apiClient.post('/notifications/read', { ids }),
    onSuccess: () => {
      qc.setQueryData<Notification[]>(['notifications'], (prev = []) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );
    },
  });

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header action */}
      {unreadCount > 0 && (
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <span className="text-sm text-neutral-500">{t('notifications.unread', { count: unreadCount })}</span>
          <button
            onClick={() => {
              const unreadIds = notifications?.filter((n) => !n.isRead).map((n) => n.id) ?? [];
              if (unreadIds.length) markReadMutation.mutate(unreadIds);
            }}
            className="text-sm text-primary-600 font-medium"
          >
            {markReadMutation.isPending ? t('notifications.markingAll') : t('notifications.markAllRead')}
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

      {status === 'success' && notifications?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('notifications.empty')}</p>
        </div>
      )}

      <div className="divide-y divide-neutral-100">
        {notifications?.map((notification) => (
          <div
            key={notification.id}
            className={`px-4 py-4 ${!notification.isRead ? 'bg-primary-50' : 'bg-white'}`}
            onClick={() => {
              if (!notification.isRead) {
                markReadMutation.mutate([notification.id]);
              }
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
    </div>
  );
}

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
});
