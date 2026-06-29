/**
 * apps/android/src/routes/__root.tsx
 *
 * Root layout: AuthGuard + AppShell (TopBar + Outlet + BottomNav).
 */

import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { AuthGuard } from '@/components/auth/AuthGuard';

// Tab roots that don't show a back button
const TAB_ROOTS = ['/home', '/games', '/rooms', '/notifications', '/settings'];
const PUBLIC_ROUTES = ['/auth/login', '/auth/register'];

function AppShell() {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isTabRoot = TAB_ROOTS.some((r) => pathname === r);
  const showBack = !isTabRoot && !isPublicRoute && pathname !== '/';

  // Derive title from route
  const getTitle = () => {
    if (pathname === '/home' || pathname === '/') return t('home.title');
    if (pathname.startsWith('/games')) return t('android.games.title');
    if (pathname.startsWith('/rooms')) return t('rooms.title');
    if (pathname.startsWith('/messages')) return t('messages.title');
    if (pathname === '/notifications') return t('notifications.title');
    if (pathname.startsWith('/profile')) return t('profile.title');
    if (pathname === '/settings') return t('settings.title');
    if (pathname === '/auth/login') return t('auth.login');
    if (pathname === '/auth/register') return t('auth.register');
    return 'Zobia';
  };

  if (isPublicRoute) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="h-full flex flex-col">
        <TopBar title={getTitle()} showBack={showBack} />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto mt-14 mb-14">
          <div className="page-slide-in h-full">
            <Outlet />
          </div>
        </main>
        <BottomNav />
      </div>
    </AuthGuard>
  );
}

export const Route = createRootRoute({
  component: AppShell,
});
