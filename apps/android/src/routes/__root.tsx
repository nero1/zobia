/**
 * apps/android/src/routes/__root.tsx
 *
 * Root layout: AuthGuard + AppShell (TopBar + Outlet + BottomNav).
 */

import { useEffect } from 'react';
import { createRootRoute, Outlet, useRouterState, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminShell } from '@/components/admin/AdminShell';
import { useAuth } from '@/lib/auth/store';
import { AuthUserSchema } from '@zobia/shared/schemas/auth';
import { setPreAuthToken, endOAuthAttempt, isOAuthInProgress } from '@/lib/auth/preAuth';
import { env } from '@/lib/env';
import { usePresenceHeartbeat } from '@/lib/hooks/usePresenceHeartbeat';
import { initPushNotifications } from '@/lib/push';
import { apiClient } from '@/lib/api/client';
import { useReferralCaptureFromLink } from '@/lib/deeplinks/referral';

// Tab roots that don't show a back button
const TAB_ROOTS = ['/home', '/games', '/rooms', '/messages', '/notifications', '/settings', '/quests', '/friends', '/wallet'];
const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/auth/two-factor'];

function AppShell() {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const navigate = useNavigate();
  const router = useRouter();
  const { setAuth, token } = useAuth();

  // Keeps last_active_at / online status warm app-wide — see usePresenceHeartbeat.ts.
  usePresenceHeartbeat();

  // Captures `?r=CODE` from a shared referral deep link (zobia://... or a
  // verified https://zobia.org/... App Link) into Preferences so the
  // onboarding screen can redeem it — was previously defined but never
  // mounted anywhere (ZB-AND-02 fix).
  useReferralCaptureFromLink();

  // Register for push notifications once the user's identity is established
  // (matches apps/expo/app/_layout.tsx's convention — the token registration
  // call is authenticated, so it's pointless before login).
  useEffect(() => {
    if (!token) return;
    initPushNotifications(router).catch((err) => console.error('[push] init failed:', err));
  }, [token, router]);

  useEffect(() => {
    const listenerPromise = CapApp.addListener('appUrlOpen', async ({ url }) => {
      try {
        const parsed = new URL(url);

        // Handle zobia://gift/:userId — mirrors web's app/(app)/gift/[userId]/page.tsx:
        // resolve the recipient's username, then hand off to the Gifts Hub send flow
        // instead of a dedicated screen (gifts.tsx already preselects via search params).
        if (parsed.hostname === 'gift') {
          const userId = parsed.pathname.replace(/^\//, '');
          if (userId) {
            try {
              const { data } = await apiClient.get<{ user?: { username?: string | null } }>(`/users/${userId}`);
              const username = data.user?.username ?? undefined;
              navigate({ to: '/gifts', search: username ? { recipientId: userId, username } : { recipientId: userId } });
            } catch (err) {
              console.error('[deeplink] gift resolve failed:', err);
              navigate({ to: '/gifts', search: { recipientId: userId } });
            }
          }
          return;
        }

        // Handle OAuth callback deep links.
        // BUG-CAP-04 fix: accept both the verified https App Link
        // (https://<web-origin>/auth/callback?code=...) and the legacy
        // zobia://auth/callback custom-scheme form as a fallback for
        // devices/browsers where App Links verification hasn't succeeded.
        const webOrigin = (() => {
          try { return new URL(env.VITE_WEB_BASE_URL).hostname; } catch { return null; }
        })();
        const isHttpsCallback =
          (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          webOrigin !== null &&
          parsed.hostname === webOrigin &&
          (parsed.pathname === '/auth/callback' || parsed.pathname === '/auth/telegram-callback');
        const isCustomSchemeCallback =
          parsed.hostname === 'auth' &&
          (parsed.pathname === '/callback' || parsed.pathname === '/telegram-callback');
        const isOAuthCallback = isHttpsCallback || isCustomSchemeCallback;
        if (!isOAuthCallback) return;

        // ZSB-22 fix: the login/register screens' loading spinner used to
        // clear as soon as `Browser.open(...)` resolved (i.e. the instant the
        // Custom Tab opened), giving almost no protection against
        // double-tapping the button mid-flow. Now it stays set until this
        // handler — which only fires once we're actually looking at an OAuth
        // callback deep link — finishes, success or failure.
        try {
          const code = parsed.searchParams.get('code');
          const preAuthCode = parsed.searchParams.get('pre_auth_code');

          if (!code && !preAuthCode) return;

          // Dismiss the OAuth Custom Tab now that we have the exchange code — otherwise
          // it can linger on top of the app, making a successful login look like it
          // "returned to the login page".
          await Browser.close().catch(() => {});

          // Exchange the one-time code for tokens via the secure backend endpoint
          const body = code ? { code } : { pre_auth_code: preAuthCode };
          const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/mobile-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
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
            onboardingCompleted?: boolean;
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
              is_moderator: Boolean(rawUser.is_moderator ?? rawUser.isModerator ?? false),
              is_support: Boolean(rawUser.is_support ?? rawUser.isSupport ?? false),
              is_senior_support: Boolean(rawUser.is_senior_support ?? rawUser.isSeniorSupport ?? false),
              is_creator: Boolean(rawUser.is_creator ?? rawUser.isCreator ?? false),
              avatar_url: (rawUser.avatar_url ?? null) as string | null,
            };
            const userParsed = AuthUserSchema.safeParse(normalizedUser);
            if (userParsed.success) {
              await setAuth(data.accessToken, userParsed.data, data.refreshToken);
              // BUG ZB-AND-03 fix: mobile-token's own top-level `onboardingCompleted`
              // (not a field on the Zod-parsed AuthUser — the shared schema
              // intentionally excludes it, same contract web/Expo share) decides
              // whether a brand-new OAuth signup lands on /onboarding first,
              // mirroring apps/expo/app/auth/login.tsx's identical branch.
              navigate({ to: data.onboardingCompleted === false ? '/onboarding' : '/home', replace: true });
            } else {
              console.error('[auth] user schema parse failed:', userParsed.error);
            }
          } else {
            console.error('[auth] mobile-token response missing accessToken or user:', data);
          }
        } finally {
          endOAuthAttempt();
        }
      } catch (err) {
        console.error('[auth] appUrlOpen handler error:', err);
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }, [setAuth, navigate]);

  // ZSB-22 fix (abandon path): if the user backgrounds the OAuth Custom Tab
  // and returns to the app *without* completing sign-in (closes the tab,
  // switches apps and comes back, etc.), `appUrlOpen` above never fires, so
  // nothing would otherwise clear `_oauthInProgress`. On every foreground
  // resume, if an attempt is still marked in-progress, give the callback a
  // grace window (it may be about to fire) before treating it as abandoned
  // and re-enabling the login/register buttons. 6s (not a shorter window)
  // because the real completion path this races against does Browser.close()
  // then a full network round-trip (POST /api/auth/mobile-token) before it
  // calls endOAuthAttempt() itself — a short window could fire first on a
  // slow connection and prematurely re-enable the button mid-exchange.
  useEffect(() => {
    const listenerPromise = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || !isOAuthInProgress()) return;
      setTimeout(() => {
        if (isOAuthInProgress()) endOAuthAttempt();
      }, 6000);
    });
    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }, []);

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isTabRoot = TAB_ROOTS.some((r) => pathname === r);
  const showBack = !isTabRoot && !isPublicRoute && pathname !== '/';

  // Derive title from route
  const getTitle = () => {
    if (pathname === '/home' || pathname === '/') return t('home.title');
    if (pathname.startsWith('/games')) return t('android.games.title');
    if (pathname.startsWith('/rooms')) return t('rooms.title');
    if (pathname.startsWith('/messages')) return t('messages.title');
    if (pathname.startsWith('/moments')) return t('moments.title');
    if (pathname.startsWith('/answers')) return t('answers.title');
    if (pathname.startsWith('/forum')) return t('bbforum.forum.title');
    if (pathname === '/notifications') return t('notifications.title');
    if (pathname.startsWith('/profile')) return t('profile.title');
    if (pathname === '/settings') return t('settings.title');
    if (pathname.startsWith('/quests')) return t('quests.title');
    if (pathname.startsWith('/friends')) return t('friends.title');
    if (pathname.startsWith('/gifts')) return t('gifts.title');
    if (pathname.startsWith('/wallet')) return t('wallet.title');
    if (pathname.startsWith('/events')) return t('events.title');
    if (pathname.startsWith('/inbox')) return t('inbox.title');
    if (pathname.startsWith('/elder')) return t('elder.title');
    if (pathname.startsWith('/referrals')) return t('referrals.title');
    if (pathname.startsWith('/classroom')) return t('classroom.title');
    if (pathname.startsWith('/leaderboards')) return t('leaderboards.title');
    if (pathname === '/guild') return t('guild.title');
    if (pathname.startsWith('/guilds')) return t('guilds.title');
    if (pathname.startsWith('/council')) return t('council.title');
    if (pathname.startsWith('/community-notes')) return t('communityNotes.title');
    if (pathname.startsWith('/nemesis')) return t('nemesis.title');
    if (pathname.startsWith('/prestige')) return t('prestige.title', 'Prestige');
    if (pathname.startsWith('/seasons')) return t('seasons.title', 'Seasons');
    if (pathname.startsWith('/creator')) return t('creator.title', 'Creator Dashboard');
    if (pathname.startsWith('/merch')) return t('merch.title', 'Merch Stores');
    if (pathname.startsWith('/stickers')) return t('stickers.title', 'Sticker Store');
    if (pathname.startsWith('/kyc')) return t('kyc.title');
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

  // Onboarding is a full-screen, auth-required flow with no TopBar/BottomNav
  // chrome — same treatment as the public auth screens above, but wrapped in
  // AuthGuard since it needs a valid token to call POST /api/onboarding/complete.
  if (pathname === '/onboarding') {
    return (
      <AuthGuard>
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </AuthGuard>
    );
  }

  // In-app game player is full-screen, chrome-free — the embedded game needs
  // the whole viewport, and TopBar/BottomNav would eat into it plus not make
  // sense while inside a game (see routes/games/$slug/play.tsx).
  if (/^\/games\/[^/]+\/play$/.test(pathname)) {
    return (
      <AuthGuard>
        <div className="h-full">
          <Outlet />
        </div>
      </AuthGuard>
    );
  }

  // The admin section (/admin/*) is a distinct area with its own drawer nav and
  // no bottom tab bar — mirrors web's separate (admin) route group / AdminLayoutShell.
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  if (isAdminRoute) {
    return (
      <AuthGuard>
        <AdminShell>
          <Outlet />
        </AdminShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="h-full flex flex-col">
        <TopBar title={getTitle()} showBack={showBack} />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto">
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
