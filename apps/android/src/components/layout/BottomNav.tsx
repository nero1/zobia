/**
 * apps/android/src/components/layout/BottomNav.tsx
 *
 * 5-tab bottom navigation bar.
 * Tabs: Home, Games, Rooms, Notifications, Profile.
 * Height: 56px, fixed bottom, respects safe-area-inset-bottom.
 */

import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2563eb' : '#a3a3a3'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function GamesIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2563eb' : '#a3a3a3'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <circle cx="15.5" cy="11.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="13.5" r=".5" fill="currentColor" />
      <rect x="2" y="6" width="20" height="12" rx="2" />
    </svg>
  );
}

function RoomsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2563eb' : '#a3a3a3'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NotificationsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2563eb' : '#a3a3a3'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2563eb' : '#a3a3a3'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function BottomNav() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const tabs = [
    {
      href: '/home',
      label: t('android.nav.home'),
      icon: (active: boolean) => <HomeIcon active={active} />,
      isActive: pathname === '/home' || pathname === '/',
    },
    {
      href: '/games',
      label: t('android.nav.games'),
      icon: (active: boolean) => <GamesIcon active={active} />,
      isActive: pathname.startsWith('/games'),
    },
    {
      href: '/rooms',
      label: t('android.nav.rooms'),
      icon: (active: boolean) => <RoomsIcon active={active} />,
      isActive: pathname.startsWith('/rooms'),
    },
    {
      href: '/notifications',
      label: t('android.nav.notifications'),
      icon: (active: boolean) => <NotificationsIcon active={active} />,
      isActive: pathname === '/notifications',
    },
    {
      href: user ? `/profile/${user.username}` : '/settings',
      label: t('android.nav.profile'),
      icon: (active: boolean) => <ProfileIcon active={active} />,
      isActive: pathname.startsWith('/profile') || pathname === '/settings',
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-neutral-200 z-50 flex items-center"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          to={tab.href}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full"
        >
          {tab.icon(tab.isActive)}
          <span
            className={`text-xs font-medium ${tab.isActive ? 'text-primary-600' : 'text-neutral-400'}`}
          >
            {tab.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
