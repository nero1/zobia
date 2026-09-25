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
import { useUnreadNotificationsCount, useHasNewNotifications } from '@/lib/notifications/queries';
import { useHasNewMessages, useHasNewAnnouncements } from '@/lib/notifications/useHasNewSince';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { Icon, type IconName } from '@/components/ui/Icon';

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
  icon: IconName;
  /** When set, hides this entry from non-staff if the flag is off (see useFeatureFlags). */
  flagKey?: string;
  /**
   * Council-only gate: visible to admins always, and to everyone else only
   * once the flag is on AND they hold an active council seat (user.is_council_member).
   * Unlike a plain flagKey, moderators do NOT get a mod-visibility exception here.
   */
  requiresCouncilMembership?: boolean;
}

const primaryNavItems: PrimaryNavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: 'home' },
  { href: '/search', labelKey: 'nav.search', icon: 'search' },
  { href: '/moments', labelKey: 'nav.moments', icon: 'moments', flagKey: 'moments' },
  { href: '/tweets', labelKey: 'nav.tweets', icon: 'tweets', flagKey: 'tweets' },
  { href: '/answers', labelKey: 'nav.answers', icon: 'answers', flagKey: 'forum' },
  { href: '/forum', labelKey: 'nav.bbforum', icon: 'forum', flagKey: 'bbforum' },
  { href: '/polls', labelKey: 'nav.polls', icon: 'polls', flagKey: 'polls' },
  { href: '/quizzes', labelKey: 'nav.quizzes', icon: 'quizzes', flagKey: 'quizzes' },
  { href: '/quests', labelKey: 'nav.quests', icon: 'quests' },
  { href: '/games', labelKey: 'nav.games', icon: 'games', flagKey: 'games' },
  { href: '/blogs', labelKey: 'nav.blogs', icon: 'blogs', flagKey: 'blogs' },
  { href: '/business', labelKey: 'nav.business', icon: 'business', flagKey: 'businessAccounts' },
  { href: '/ads', labelKey: 'nav.ads', icon: 'ads', flagKey: 'adsSystem' },
  { href: '/rooms', labelKey: 'nav.rooms', icon: 'rooms', flagKey: 'rooms' },
  { href: '/messages', labelKey: 'nav.messages', icon: 'messages' },
  { href: '/friends', labelKey: 'nav.friends', icon: 'friends' },
  { href: '/gifts', labelKey: 'nav.gifts', icon: 'gifts', flagKey: 'gifts' },
  { href: '/wallet', labelKey: 'nav.wallet', icon: 'wallet' },
  { href: '/market', labelKey: 'nav.market', icon: 'market' },
  { href: '/notifications', labelKey: 'nav.notifications', icon: 'notifications' },
  { href: '/events', labelKey: 'nav.events', icon: 'events' },
  { href: '/announcements', labelKey: 'nav.announcements', icon: 'announcements' },
  { href: '/elder', labelKey: 'nav.elder', icon: 'elder' },
  { href: '/referrals', labelKey: 'nav.referrals', icon: 'referrals' },
  { href: '/classroom', labelKey: 'nav.classroom', icon: 'classroom', flagKey: 'classrooms' },
  { href: '/leaderboards', labelKey: 'nav.leaderboards', icon: 'leaderboards', flagKey: 'rankings' },
  { href: '/seasons', labelKey: 'nav.seasons', icon: 'seasons' },
  { href: '/guild', labelKey: 'nav.guild', icon: 'guild' },
  { href: '/guilds', labelKey: 'nav.guilds', icon: 'guilds' },
  { href: '/council', labelKey: 'nav.council', icon: 'council', flagKey: 'platformCouncil', requiresCouncilMembership: true },
  { href: '/community-notes', labelKey: 'nav.communityNotes', icon: 'communityNotes', flagKey: 'communityNotes' },
  { href: '/nemesis', labelKey: 'nav.nemesis', icon: 'nemesis', flagKey: 'nemesisSystem' },
];

const secondaryNavItems: { href: string; labelKey: string; icon: IconName }[] = [
  { href: '/profile', labelKey: 'nav.profile', icon: 'profile' },
  { href: '/settings', labelKey: 'nav.settings', icon: 'settings' },
];

export function TopBar({ title, rightActions, showBack }: TopBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { clearAuth, user } = useAuth();
  const unreadCount = useUnreadNotificationsCount();
  const hasNewNotifications = useHasNewNotifications();
  const hasNewMessages = useHasNewMessages();
  const hasNewAnnouncements = useHasNewAnnouncements();
  const newDotHrefs: Record<string, boolean | undefined> = {
    '/notifications': hasNewNotifications,
    '/messages': hasNewMessages,
    '/announcements': hasNewAnnouncements,
  };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();

  const closeDrawer = () => setDrawerOpen(false);

  // Hide nav entries for features an admin turned off. Admins always still
  // see the entry (with a small "off" indicator); moderators do too, but
  // only when the flag is on the admin-managed mod-visibility allow-list.
  const visibleNavItems = primaryNavItems.filter((item) => {
    if (item.requiresCouncilMembership) {
      if (user?.is_admin) return true;
      const enabled = !item.flagKey || featureFlags?.[item.flagKey] !== false;
      return enabled && !!user?.is_council_member;
    }
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
        className="relative z-50 flex-none bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label={t('nav.openMenu')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              <Icon name="menu" />
            </button>

            {showBack && (
              <button
                onClick={() => router.history.back()}
                className="rounded-lg p-2 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300"
                aria-label={t('action.back')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}

            <Link to="/home" className="text-lg font-bold text-primary-600 dark:text-primary-300">
              Zobia
            </Link>
          </div>

          <h1 className="sr-only">{title}</h1>

          <div className="flex items-center gap-2">
            <Link
              to="/search"
              aria-label={t('search.title')}
              className="rounded-full p-2 text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              <Icon name="search" className="text-lg leading-none" />
            </Link>
            <Link
              to="/notifications"
              aria-label={unreadCount > 0 ? `${t('notifications.title')}, ${t('notifications.unread', { count: unreadCount })}` : t('notifications.title')}
              className="relative rounded-full p-2 text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              <Icon name="notifications" className="text-lg leading-none" />
              {hasNewNotifications && (
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
        className={`fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white dark:bg-neutral-800 shadow-xl transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={closeDrawer}
          aria-label={t('nav.closeMenu')}
          className="absolute right-4 rounded-full p-2 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <Icon name="close" className="text-xl leading-none" />
        </button>

        <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
          <nav className="space-y-0.5" aria-label="Primary">
            {user?.is_admin && (
              <Link
                to="/admin"
                onClick={closeDrawer}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname.startsWith('/admin') ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
                aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
              >
                <Icon name="admin" className="w-5 text-center text-base leading-none" />
                {t('admin.link', 'Admin')}
              </Link>
            )}
            {(user?.is_moderator || user?.is_admin) && (
              <Link
                to="/watch56"
                onClick={closeDrawer}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname.startsWith('/watch56') ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
                aria-current={pathname.startsWith('/watch56') ? 'page' : undefined}
              >
                <Icon name="moderation" className="w-5 text-center text-base leading-none" />
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
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  <span className="relative w-5 text-center text-base leading-none">
                    <Icon name={item.icon} />
                    {newDotHrefs[item.href] && (
                      <span className="absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                    )}
                  </span>
                  {t(item.labelKey)}
                  {isOffForUsers && (
                    <span title="Disabled for regular users" className="ml-auto text-xs text-amber-500">⚠️</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="my-3 border-t border-neutral-200 dark:border-neutral-700" />

          <nav className="space-y-0.5" aria-label="Secondary">
            {secondaryNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={closeDrawer}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <Icon name={item.icon} className="w-5 text-center text-base leading-none" />
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
          >
            <Icon name="logout" className="inline-block align-[-2px] mr-1" aria-hidden />
            {t('nav.logout')}
          </button>
        </div>
      </div>
    </>
  );
}
