/**
 * apps/android/src/components/layout/TopBar.tsx
 *
 * Fixed top navigation bar matching the mobile web Navbar pattern.
 * Includes the hamburger drawer/accordion-style menu used on web mobile.
 */

import { useState } from 'react';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { useUnreadNotificationsCount } from '@/lib/notifications/queries';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';

interface TopBarProps {
  title: string;
  rightActions?: React.ReactNode;
  showBack?: boolean;
}

// Mirrors apps/web/components/layout/Navbar.tsx's primaryNavItems. Every
// href here must correspond to an actual route file under
// apps/android/src/routes. (guild/guilds/council/community-notes/nemesis
// below are additions from prior Android batches beyond web's drawer list.)
// Labels are i18n keys (not literal strings) — resolved via t() at render
// time so a non-English device language sees a translated drawer, not the
// key names below (ZB-AND-01 fix).
interface PrimaryNavItem {
  href: string;
  labelKey: string;
  icon: string;
  /** When set, hides this entry from non-staff if the flag is off (see useFeatureFlags). */
  flagKey?: string;
}

const primaryNavItems: PrimaryNavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: '🏠' },
  { href: '/moments', labelKey: 'nav.moments', icon: '🎬', flagKey: 'moments' },
  { href: '/answers', labelKey: 'nav.answers', icon: '❓', flagKey: 'forum' },
  { href: '/forum', labelKey: 'nav.bbforum', icon: '🗂️', flagKey: 'bbforum' },
  { href: '/quests', labelKey: 'nav.quests', icon: '🎯' },
  { href: '/games', labelKey: 'nav.games', icon: '🎮', flagKey: 'games' },
  { href: '/blogs', labelKey: 'nav.blogs', icon: '📝', flagKey: 'blogs' },
  { href: '/business', labelKey: 'nav.business', icon: '🏢', flagKey: 'businessAccounts' },
  { href: '/ads', labelKey: 'nav.ads', icon: '📢', flagKey: 'adsSystem' },
  { href: '/rooms', labelKey: 'nav.rooms', icon: '🚪', flagKey: 'rooms' },
  { href: '/messages', labelKey: 'nav.messages', icon: '💬' },
  { href: '/friends', labelKey: 'nav.friends', icon: '👥' },
  { href: '/gifts', labelKey: 'nav.gifts', icon: '🎁', flagKey: 'gifts' },
  { href: '/wallet', labelKey: 'nav.wallet', icon: '🪙' },
  { href: '/notifications', labelKey: 'nav.notifications', icon: '🔔' },
  { href: '/events', labelKey: 'nav.events', icon: '📅' },
  { href: '/inbox', labelKey: 'nav.inbox', icon: '📬' },
  { href: '/elder', labelKey: 'nav.elder', icon: '🎓' },
  { href: '/referrals', labelKey: 'nav.referrals', icon: '🔗' },
  { href: '/classroom', labelKey: 'nav.classroom', icon: '🏫', flagKey: 'classrooms' },
  { href: '/leaderboards', labelKey: 'nav.leaderboards', icon: '🏆', flagKey: 'rankings' },
  { href: '/seasons', labelKey: 'nav.seasons', icon: '🗓️' },
  { href: '/guild', labelKey: 'nav.guild', icon: '🛡️' },
  { href: '/guilds', labelKey: 'nav.guilds', icon: '🏰' },
  { href: '/council', labelKey: 'nav.council', icon: '⚖️', flagKey: 'platformCouncil' },
  { href: '/community-notes', labelKey: 'nav.communityNotes', icon: '📝', flagKey: 'communityNotes' },
  { href: '/nemesis', labelKey: 'nav.nemesis', icon: '👻', flagKey: 'nemesisSystem' },
];

const secondaryNavItems = [
  { href: '/profile', labelKey: 'nav.profile', icon: '👤' },
  { href: '/settings', labelKey: 'nav.settings', icon: '⚙️' },
] as const;

export function TopBar({ title, rightActions, showBack }: TopBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { clearAuth, user } = useAuth();
  const unreadCount = useUnreadNotificationsCount();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();

  const closeDrawer = () => setDrawerOpen(false);

  // Hide nav entries for features an admin turned off. Admins always still
  // see the entry (with a small "off" indicator); moderators do too, but
  // only when the flag is on the admin-managed mod-visibility allow-list.
  const visibleNavItems = primaryNavItems.filter((item) => {
    if (!item.flagKey) return true;
    const enabled = featureFlags?.[item.flagKey] !== false;
    const access = resolveFeatureAccess(enabled, modVisibleKeys.includes(item.flagKey), {
      isAdmin: user?.is_admin,
      isModerator: user?.is_moderator,
    });
    return access.accessible;
  });

  const handleLogout = async () => {
    closeDrawer();
    await clearAuth();
    router.navigate({ to: '/auth/login', replace: true });
  };

  return (
    <>
      {/*
        Not `fixed` — a normal flex child of the __root AppShell column, so the
        WebView lays out header/content/nav in-flow and nothing needs a
        hardcoded height to offset against (see BottomNav for the same
        pattern). The `env(safe-area-inset-top)` padding keeps the row below
        the status bar on edge-to-edge Android (API 35+, forced for apps
        targeting SDK 35+) without shrinking the 56px content row itself —
        a `fixed top-0` header ignores body's own safe-area padding (fixed
        elements aren't affected by an ancestor's padding), which is what
        made the top of the app look cut off under the status bar.
      */}
      <header
        className="relative z-50 flex-none bg-white border-b border-neutral-200"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label={t('nav.openMenu')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <rect x="2" y="4" width="16" height="2" rx="1" />
                <rect x="2" y="9" width="16" height="2" rx="1" />
                <rect x="2" y="14" width="16" height="2" rx="1" />
              </svg>
            </button>

            {showBack && (
              <button
                onClick={() => router.history.back()}
                className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label={t('action.back')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}

            <Link to="/home" className="text-lg font-bold text-primary-600">
              Zobia
            </Link>
          </div>

          <h1 className="sr-only">{title}</h1>

          <div className="flex items-center gap-2">
            <Link
              to="/notifications"
              aria-label={unreadCount > 0 ? `${t('notifications.title')}, ${t('notifications.unread', { count: unreadCount })}` : t('notifications.title')}
              className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              <span aria-hidden="true" className="text-lg leading-none">🔔</span>
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white"
                />
              )}
            </Link>
            {rightActions}
          </div>
        </div>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={closeDrawer} />
      )}

      <div
        role="dialog"
        aria-label={t('nav.userArea')}
        className={`fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white shadow-xl transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={closeDrawer}
          aria-label={t('nav.closeMenu')}
          className="absolute right-4 rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
          style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <span aria-hidden="true" className="text-xl leading-none">✕</span>
        </button>

        <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
          <nav className="space-y-0.5" aria-label="Primary">
            {user?.is_admin && (
              <Link
                to="/admin"
                onClick={closeDrawer}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname.startsWith('/admin') ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
                aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">🛡️</span>
                {t('admin.link', 'Admin')}
              </Link>
            )}
            {(user?.is_moderator || user?.is_admin) && (
              <Link
                to="/moderation"
                onClick={closeDrawer}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname.startsWith('/moderation') ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
                aria-current={pathname.startsWith('/moderation') ? 'page' : undefined}
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">🧭</span>
                {t('moderation.title', 'Moderation Center')}
              </Link>
            )}
            {visibleNavItems.map((item) => {
              const isOffForUsers = !!item.flagKey && featureFlags?.[item.flagKey] === false;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={closeDrawer}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                  {t(item.labelKey)}
                  {isOffForUsers && (
                    <span title="Disabled for regular users" className="ml-auto text-xs text-amber-500">⚠️</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="my-3 border-t border-neutral-200" />

          <nav className="space-y-0.5" aria-label="Secondary">
            {secondaryNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={closeDrawer}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            🚪 {t('nav.logout')}
          </button>
        </div>
      </div>
    </>
  );
}
