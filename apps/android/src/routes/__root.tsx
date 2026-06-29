/**
 * apps/android/src/routes/__root.tsx
 *
 * Root layout: AuthGuard + AppShell (TopBar + Outlet + BottomNav).
 */

import { useEffect } from 'react';
import { createRootRoute, Outlet, useRouterState, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { App as CapApp } from '@capacitor/app';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/lib/auth/store';
import { AuthUserSchema } from '@zobia/shared/schemas/auth';

// Tab roots that don't show a back button
const TAB_ROOTS = ['/home', '/games', '/rooms', '/notifications', '/settings'];
const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/auth/two-factor'];

function AppShell() {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  useEffect(() => {
    const listenerPromise = CapApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'auth' && (parsed.pathname === '/callback' || parsed.pathname === '/telegram-callback')) {
          const token = parsed.searchParams.get('token');
          const userJson = parsed.searchParams.get('user');
          if (token && userJson) {
            const userParsed = AuthUserSchema.safeParse(JSON.parse(userJson));
            if (userParsed.success) {
              setAuth(token, userParsed.data).then(() => {
                navigate({ to: '/home', replace: true });
              });
            }
          }
        }
      } catch {
        // malformed deep link — ignore
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }, [setAuth, navigate]);

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
    if (pathname === '/auth/two-factor') return t('auth.2fa.title');
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
