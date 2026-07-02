/**
 * apps/android/src/components/layout/TopBar.tsx
 *
 * Fixed top navigation bar matching the mobile web Navbar pattern.
 * Includes the hamburger drawer/accordion-style menu used on web mobile.
 */

import { useState } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';

interface TopBarProps {
  title: string;
  rightActions?: React.ReactNode;
  showBack?: boolean;
}

const primaryNavItems = [
  { href: '/home', label: 'Home', icon: '🏠' },
  { href: '/games', label: 'Games', icon: '🎮' },
  { href: '/rooms', label: 'Rooms', icon: '🚪' },
  { href: '/messages', label: 'Messages', icon: '💬' },
  { href: '/moments', label: 'Moments', icon: '🎬' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
] as const;

const secondaryNavItems = [
  { href: '/settings', label: 'Settings', icon: '⚙️' },
] as const;

export function TopBar({ title, rightActions, showBack }: TopBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, clearAuth } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const profileHref = user?.username ? `/profile/${user.username}` : '/settings';

  const closeDrawer = () => setDrawerOpen(false);

  const handleLogout = async () => {
    closeDrawer();
    await clearAuth();
    router.navigate({ to: '/auth/login', replace: true });
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-neutral-200 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            aria-label="Open navigation menu"
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
            aria-label="Notifications"
            className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">🔔</span>
          </Link>
          {rightActions}
        </div>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={closeDrawer} />
      )}

      <div
        role="dialog"
        aria-label="Navigation menu"
        className={`fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white pt-14 shadow-xl transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          type="button"
          onClick={closeDrawer}
          aria-label="Close menu"
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
        >
          <span aria-hidden="true" className="text-xl leading-none">✕</span>
        </button>

        <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
          <nav className="space-y-0.5" aria-label="Primary">
            {primaryNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={closeDrawer}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="my-3 border-t border-neutral-200" />

          <nav className="space-y-0.5" aria-label="Secondary">
            <Link
              to={profileHref}
              onClick={closeDrawer}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <span className="w-5 text-center text-base leading-none" aria-hidden="true">👤</span>
              Profile
            </Link>
            {secondaryNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={closeDrawer}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            🚪 Log out
          </button>
        </div>
      </div>
    </>
  );
}
