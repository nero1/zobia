/**
 * apps/android/src/components/layout/BottomNav.tsx
 *
 * Mobile web-matching six-tab bottom navigation bar.
 */

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { Icon, type IconName } from '@/components/ui/Icon';

const TAB_ICON_NAMES: Record<string, IconName> = {
  Home: 'home',
  Quests: 'quests',
  Games: 'games',
  Friends: 'friends',
  Wallet: 'wallet',
  Profile: 'profile',
};

function TabIcon({ label, isActive }: { label: string; isActive: boolean }) {
  const name = TAB_ICON_NAMES[label];
  if (!name) return null;
  return <Icon name={name} active={isActive} className="text-xl leading-none" />;
}

export function BottomNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { user } = useAuth();

  const bottomTabItems = [
    { href: '/home', label: 'Home', shortLabel: t('nav.home') },
    { href: '/quests', label: 'Quests', shortLabel: t('nav.quests') },
    { href: '/games', label: 'Games', shortLabel: t('nav.games') },
    { href: '/friends', label: 'Friends', shortLabel: t('nav.friends') },
    { href: '/wallet', label: 'Wallet', shortLabel: t('nav.wallet') },
    { href: user?.username ? `/profile/${user.username}` : '/settings', label: 'Profile', shortLabel: t('nav.profile') },
  ] as const;

  return (
    // Not `fixed` — a normal flex child of the __root AppShell column (see
    // TopBar for the same pattern/rationale). A `fixed bottom-0` nav's real
    // rendered height (content + this env(safe-area-inset-bottom) padding)
    // doesn't match a hardcoded `mb-*` offset on the scrollable `main` above
    // it, so the last bit of page content could sit behind the nav on
    // devices with a bottom gesture-nav inset. In-flow layout needs no offset.
    <nav
      className="relative z-40 flex-none border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800"
      aria-label="Mobile navigation"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-6">
        {bottomTabItems.map((item) => {
          const isActive =
            item.label === 'Profile'
              ? pathname.startsWith('/profile') || pathname === '/settings'
              : pathname.startsWith(item.href);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate({ to: item.href as never })}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${isActive ? 'text-primary-600 dark:text-primary-300' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <TabIcon label={item.label} isActive={isActive} />
              <span className="text-[9px] leading-none">{item.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
