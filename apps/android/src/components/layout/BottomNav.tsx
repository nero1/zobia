/**
 * apps/android/src/components/layout/BottomNav.tsx
 *
 * Mobile web-matching six-tab bottom navigation bar.
 */

import { useNavigate, useRouterState } from '@tanstack/react-router';

const bottomTabItems = [
  { href: '/home', label: 'Home', shortLabel: 'Home' },
  { href: '/quests', label: 'Quests', shortLabel: 'Quests' },
  { href: '/games', label: 'Games', shortLabel: 'Games' },
  { href: '/friends', label: 'Friends', shortLabel: 'Friends' },
  { href: '/wallet', label: 'Wallet', shortLabel: 'Wallet' },
  { href: '/profile', label: 'Profile', shortLabel: 'Profile' },
] as const;

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

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200 bg-white"
      aria-label="Mobile navigation"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-6">
        {bottomTabItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
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
