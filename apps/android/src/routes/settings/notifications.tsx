/**
 * apps/android/src/routes/settings/notifications.tsx
 *
 * Per-category push notification preferences — Android had push
 * infrastructure (lib/push/index.ts registers the FCM token) but no UI to
 * control which categories a device actually receives, unlike apps/web's
 * settings page ("Notifications" section). Reuses the exact same endpoint:
 * GET/PATCH /api/users/me/settings (app/api/users/me/settings/route.ts) —
 * no backend changes needed, mirrors web's NOTIFICATION_TYPES + the three
 * `push_*` chat toggles it also renders in that same section.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

// Matches web's `NOTIF_KEY_MAP` in app/(app)/settings/page.tsx: local toggle
// key -> the boolean field name PATCH /api/users/me/settings expects.
const NOTIF_KEY_MAP: Record<string, string> = {
  push_dms: 'dm_notifications',
  push_groups: 'group_notifications',
  push_room_mentions: 'room_mention_notifications',
  new_message: 'notify_new_message',
  friend_request: 'notify_friend_request',
  gift_received: 'notify_gift_received',
  rank_up: 'notify_rank_up',
  war_start: 'notify_war_start',
  season_end: 'notify_season_end',
  announcement: 'notify_announcement',
};

// i18n label/description keys per toggle — `settings.push.*` for the chat
// push toggles, `settings.notification{Key}`/`{Key}Desc` for the rest
// (both namespaces already exist in shared/i18n/locales/en.json).
const TOGGLE_I18N: { key: string; labelKey: string; descKey: string }[] = [
  { key: 'push_dms', labelKey: 'settings.push.dms', descKey: 'settings.push.dmsDesc' },
  { key: 'push_groups', labelKey: 'settings.push.groups', descKey: 'settings.push.groupsDesc' },
  { key: 'push_room_mentions', labelKey: 'settings.push.roomMentions', descKey: 'settings.push.roomMentionsDesc' },
  { key: 'new_message', labelKey: 'settings.notificationNew_message', descKey: 'settings.notificationNew_messageDesc' },
  { key: 'friend_request', labelKey: 'settings.notificationFriend_request', descKey: 'settings.notificationFriend_requestDesc' },
  { key: 'gift_received', labelKey: 'settings.notificationGift_received', descKey: 'settings.notificationGift_receivedDesc' },
  { key: 'rank_up', labelKey: 'settings.notificationRank_up', descKey: 'settings.notificationRank_upDesc' },
  { key: 'war_start', labelKey: 'settings.notificationWar_start', descKey: 'settings.notificationWar_startDesc' },
  { key: 'season_end', labelKey: 'settings.notificationSeason_end', descKey: 'settings.notificationSeason_endDesc' },
  { key: 'announcement', labelKey: 'settings.notificationAnnouncement', descKey: 'settings.notificationAnnouncementDesc' },
];

interface SettingsResponse {
  notifications: {
    push: {
      dmMessages: boolean;
      groupMessages: boolean;
      roomMentions: boolean;
      newMessage: boolean;
      friendRequest: boolean;
      giftReceived: boolean;
      rankUp: boolean;
      warStart: boolean;
      seasonEnd: boolean;
      announcement: boolean;
    };
  };
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary-600' : 'bg-neutral-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white dark:bg-neutral-800 shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function NotificationsPage() {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ success: boolean; data: SettingsResponse }>('/users/me/settings')
      .then(({ data }) => {
        const push = data.data.notifications.push;
        setValues({
          push_dms: push.dmMessages ?? true,
          push_groups: push.groupMessages ?? true,
          push_room_mentions: push.roomMentions ?? true,
          new_message: push.newMessage ?? true,
          friend_request: push.friendRequest ?? true,
          gift_received: push.giftReceived ?? true,
          rank_up: push.rankUp ?? true,
          war_start: push.warStart ?? true,
          season_end: push.seasonEnd ?? true,
          announcement: push.announcement ?? true,
        });
      })
      .catch(() => { /* keep defaults (all true) — section still renders */ })
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: string, next: boolean) {
    const previous = values;
    setValues((prev) => ({ ...prev, [key]: next }));
    setSaving(true);
    try {
      await apiClient.patch('/users/me/settings', { [NOTIF_KEY_MAP[key]]: next });
    } catch {
      setValues(previous); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">{t('action.loading', 'Loading…')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4">
      <div className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-xl bg-white dark:bg-neutral-800 px-4 shadow-card">
        {TOGGLE_I18N.map(({ key, labelKey, descKey }) => (
          <div key={key} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(labelKey)}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t(descKey)}</p>
            </div>
            <Toggle checked={values[key] ?? true} onChange={(v) => void toggle(key, v)} disabled={saving} />
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/notifications')({
  component: NotificationsPage,
});
