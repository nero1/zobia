/**
 * apps/android/src/components/layout/BottomNav.tsx
 *
 * Mobile web-matching six-tab bottom navigation bar.
 */

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home: { active: '🏠', inactive: '🏡' },
  Quests: { active: '🎯', inactive: '🎯' },
  Games: { active: '🎮', inactive: '🕹️' },
  Friends: { active: '👥', inactive: '👥' },
  Wallet: { active: '🪙', inactive: '🪙' },
  Profile: { active: '👤', inactive: '👤' },
};

function TabIcon({ label, isActive }: { label: string; isActive: boolean }) {
  const icon = TAB_ICONS[label];
  return (
    <span className="text-xl leading-none" aria-hidden="true">
      {isActive ? icon?.active : icon?.inactive}
    </span>
  );
}

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { user } = useAuth();

  const bottomTabItems = [
    { href: '/home', label: 'Home', shortLabel: 'Home' },
    { href: '/quests', label: 'Quests', shortLabel: 'Quests' },
    { href: '/games', label: 'Games', shortLabel: 'Games' },
    { href: '/friends', label: 'Friends', shortLabel: 'Friends' },
    { href: '/wallet', label: 'Wallet', shortLabel: 'Wallet' },
    { href: user?.username ? `/profile/${user.username}` : '/settings', label: 'Profile', shortLabel: 'Profile' },
  ] as const;

  return (
    // Not `fixed` — a normal flex child of the __root AppShell column (see
    // TopBar for the same pattern/rationale). A `fixed bottom-0` nav's real
    // rendered height (content + this env(safe-area-inset-bottom) padding)
    // doesn't match a hardcoded `mb-*` offset on the scrollable `main` above
    // it, so the last bit of page content could sit behind the nav on
    // devices with a bottom gesture-nav inset. In-flow layout needs no offset.
    <nav
      className="relative z-40 flex-none border-t border-neutral-200 bg-white"
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
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${isActive ? 'text-primary-600' : 'text-neutral-500 hover:text-neutral-700'}`}
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
