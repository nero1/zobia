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
import { setPreAuthToken } from '@/lib/auth/preAuth';
import { env } from '@/lib/env';

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
    const listenerPromise = CapApp.addListener('appUrlOpen', async ({ url }) => {
      try {
        const parsed = new URL(url);
        // Handle OAuth callback deep links: zobia://auth/callback?code=... or zobia://auth/callback?pre_auth_code=...
        const isOAuthCallback =
          parsed.hostname === 'auth' &&
          (parsed.pathname === '/callback' || parsed.pathname === '/telegram-callback');
        if (!isOAuthCallback) return;

        const code = parsed.searchParams.get('code');
        const preAuthCode = parsed.searchParams.get('pre_auth_code');

        if (!code && !preAuthCode) return;

        // Exchange the one-time code for tokens via the secure backend endpoint
        const body = code ? { code } : { pre_auth_code: preAuthCode };
        const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/mobile-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: env.VITE_API_BASE_URL,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          console.error('[auth] mobile-token exchange failed:', res.status, await res.text().catch(() => ''));
          return;
        }

        const data = await res.json() as {
          accessToken?: string;
          refreshToken?: string;
          preAuthToken?: string;
          user?: unknown;
        };

        if (preAuthCode && data.preAuthToken) {
          // 2FA flow: store pre-auth token and go to 2FA screen
          setPreAuthToken(data.preAuthToken);
          navigate({ to: '/auth/two-factor', replace: true });
          return;
        }

        if (data.accessToken && data.user) {
          const rawUser = data.user as Record<string, unknown>;
          const normalizedUser = {
            ...rawUser,
            email: (rawUser.email ?? null) as string | null,
            is_admin: Boolean(rawUser.is_admin ?? rawUser.isAdmin ?? false),
            is_creator: Boolean(rawUser.is_creator ?? rawUser.isCreator ?? false),
            avatar_url: (rawUser.avatar_url ?? null) as string | null,
          };
          const userParsed = AuthUserSchema.safeParse(normalizedUser);
          if (userParsed.success) {
            await setAuth(data.accessToken, userParsed.data, data.refreshToken);
            navigate({ to: '/home', replace: true });
          } else {
            console.error('[auth] user schema parse failed:', userParsed.error);
          }
        } else {
          console.error('[auth] mobile-token response missing accessToken or user:', data);
        }
      } catch (err) {
        console.error('[auth] appUrlOpen handler error:', err);
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
