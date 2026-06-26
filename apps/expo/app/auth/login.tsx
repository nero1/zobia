/**
 * Zobia Social — Login screen.
 *
 * Implements:
 *  - Google OAuth via expo-auth-session (browser-based PKCE flow)
 *  - Telegram Login via deep link to the Zobia Telegram bot
 *
 * Auth flow for Google:
 *  1. Opens an in-app browser to the backend /api/auth/google?platform=mobile endpoint.
 *  2. Backend handles OAuth with Google, then redirects to zobia://auth/callback?code=EXCHANGE_CODE
 *  3. App POSTs the code to /api/auth/mobile-token which returns tokens (never in URL).
 *
 * Auth flow for Telegram:
 *  1. Opens Telegram bot deep link with a random state token.
 *  2. Backend receives /api/auth/telegram/callback with the user's Telegram data.
 *  3. App polls /api/auth/telegram/status?state=... until approved, then calls signIn().
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import * as Crypto from 'expo-crypto';

import Constants from 'expo-constants';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/hooks';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import type { AuthUser } from '@/lib/auth/context';

WebBrowser.maybeCompleteAuthSession();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// BUG-024 FIX: read Telegram bot name from EAS app config so it can be changed
// without a code change or app store submission. Falls back to the original
// hardcoded value if the config entry is absent (e.g. in local development).
const TELEGRAM_BOT: string =
  (Constants.expoConfig?.extra?.telegramBotName as string | undefined) ?? 'Zobia_bot_bot';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, clearSessionExpired } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // BUG-MEM-01 FIX: track mounted state to prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Used for Telegram state polling
  const telegramStateRef = useRef<string | null>(null);
  const telegramPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancellation flag — set to true when stopTelegramPoll is called so that
  // any in-flight awaits after that point know to exit without touching state.
  const telegramCancelledRef = useRef(false);
  // BUG-H04 FIX: idempotency guard — prevents double token exchange when both
  // the Linking event listener and openAuthSessionAsync resolution fire for the
  // same redirect URL on Android.
  const exchangingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Deep link listener — catches the callback from Google OAuth redirect
  // -------------------------------------------------------------------------

  async function handleDeepLink(event: { url: string }) {
    // BUG-H04 FIX: guard against double invocation
    if (exchangingRef.current) return;

    const url = event.url;
    let isValidCallback = false;
    try {
      const parsed = new URL(url);
      // Custom scheme deep links (zobia://...) return 'null' for .origin in RN's JS engine,
      // so we must check the protocol instead of comparing origins.
      const isCustomScheme =
        parsed.protocol === 'zobia:' || parsed.protocol === 'exp+zobia-social:';
      const isUniversalLink =
        parsed.origin === new URL(env.API_BASE_URL).origin;
      const hasAuthPath =
        parsed.pathname === '/auth/callback' ||
        parsed.pathname.startsWith('/api/auth/callback');
      isValidCallback = (isCustomScheme || isUniversalLink) && hasAuthPath;
    } catch {
      // malformed URL
    }
    if (!isValidCallback) return;

    exchangingRef.current = true;
    try {
      const parsed = ExpoLinking.parse(url);
      const code = parsed.queryParams?.code as string | undefined;
      const preAuthCode = parsed.queryParams?.pre_auth_code as string | undefined;

      // 2FA required: server issued an opaque pre-auth code instead of an
      // exchange code. Route to the 2FA verification screen.
      if (preAuthCode) {
        // BUG-MISC-03 FIX: reset exchangingRef so the user can retry if they
        // cancel 2FA and return to the login screen.
        exchangingRef.current = false;
        router.replace({
          pathname: '/auth/two-factor',
          params: { preAuthCode },
        });
        return;
      }

      if (!code) {
        // BUG-MISC-03 FIX: reset exchangingRef on missing code so future
        // deep links are not blocked.
        exchangingRef.current = false;
        return;
      }

      // BUG-H09 FIX: 15-second timeout on the token exchange so that an
      // expired or slow code fails fast with a clear message instead of hanging.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      let exchangeRes: Response;
      try {
        // Exchange the one-time code for tokens via HTTPS — tokens are never
        // exposed in the URL (prevents leakage via browser history / server logs).
        exchangeRes = await fetch(`${env.API_BASE_URL}/api/auth/mobile-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Origin': env.API_BASE_URL },
          body: JSON.stringify({ code }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!exchangeRes.ok) {
        throw new Error('Token exchange failed');
      }

      const { accessToken, refreshToken, onboardingCompleted, user: authUser } =
        await exchangeRes.json() as {
          accessToken: string;
          refreshToken: string;
          userId: string;
          onboardingCompleted: boolean;
          user: AuthUser;
        };

      await signIn(accessToken, authUser, refreshToken);
      clearSessionExpired();
      if (!onboardingCompleted) {
        router.replace('/onboarding');
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
      exchangingRef.current = false;
      if (err instanceof Error && err.name === 'AbortError') {
        Alert.alert(t('common.error'), t('auth.loginTimeout'));
      } else {
        Alert.alert(t('common.error'), t('auth.callbackError'));
      }
    }
  }

  // Keep a ref to the latest handleDeepLink so the stable addEventListener
  // subscription always calls the current closure without re-subscribing.
  const handleDeepLinkRef = useRef(handleDeepLink);
  useEffect(() => { handleDeepLinkRef.current = handleDeepLink; });

  useEffect(() => {
    const subscription = ExpoLinking.addEventListener('url', (event) => handleDeepLinkRef.current(event));
    return () => subscription.remove();
  }, []);

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------

  async function handleGoogleLogin() {
    exchangingRef.current = false; // reset for a fresh login attempt
    setGoogleLoading(true);
    try {
      const redirectUri = ExpoLinking.createURL('auth/callback');

      // Step 1: fetch the Google OAuth URL from the backend via apiClient so
      // the Origin header and any future auth middleware are applied correctly.
      const { data: { url: googleAuthUrl } } = await apiClient.get<{ url: string }>(
        `/auth/google?platform=mobile&redirect=${encodeURIComponent(redirectUri)}`
      );

      // Step 2: open the actual Google consent screen and wait for the deep-link callback.
      const result = await WebBrowser.openAuthSessionAsync(googleAuthUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        await handleDeepLink({ url: result.url });
      }
      // 'cancel' and 'dismiss' are silent — user backed out
    } catch {
      Alert.alert(t('common.error'), t('auth.googleError'));
    } finally {
      setGoogleLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Telegram Login
  // -------------------------------------------------------------------------

  async function handleTelegramLogin() {
    setTelegramLoading(true);
    try {
      // Generate a cryptographically secure random state token (N-03)
      const randomBytes = await Crypto.getRandomBytesAsync(16);
      const shortState = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      telegramStateRef.current = shortState;

      // Open Telegram bot with the state token (32-char hex from 16 secure random bytes)
      const telegramUrl = `https://t.me/${TELEGRAM_BOT}?start=login_${shortState}`;
      const canOpen = await Linking.canOpenURL(telegramUrl);

      if (!canOpen) {
        Alert.alert(t('auth.telegramRequiredTitle'), t('auth.telegramRequiredBody'));
        setTelegramLoading(false);
        return;
      }

      await Linking.openURL(telegramUrl);

      // Poll the backend for the Telegram login result
      startTelegramPoll(shortState);
    } catch {
      Alert.alert(t('common.error'), t('auth.telegramError'));
      setTelegramLoading(false);
    }
  }

  function startTelegramPoll(state: string) {
    const MAX_ATTEMPTS = 12; // ~2 minutes total with exponential backoff (2,2,4,8,16,16,...)
    // Reset the cancellation flag for this new poll session.
    telegramCancelledRef.current = false;

    function scheduleNext(attempt: number) {
      if (telegramCancelledRef.current) return;
      // Exponential backoff: 2s, 2s, 2s, 4s, 8s, 16s, capped at 16s
      // (attempts 0-2 all get 2s because max(0, attempt-2) bottoms out at 0)
      const delayMs = Math.min(2000 * Math.pow(2, Math.max(0, attempt - 2)), 16_000);
      telegramPollRef.current = setTimeout(async () => {
        if (telegramCancelledRef.current) return;
        try {
          const { data } = await apiClient.get(`/auth/telegram/status?state=${state}`);
          if (telegramCancelledRef.current) return;

          if (data.status === 'approved' && data.token && data.user) {
            stopTelegramPoll();
            await signIn(data.token, data.user as AuthUser, data.refreshToken);
            if (telegramCancelledRef.current) return;
            clearSessionExpired();
            if (!data.onboardingCompleted) {
              router.replace('/onboarding');
            } else {
              router.replace('/(tabs)');
            }
            return;
          } else if (data.status === 'expired' || attempt >= MAX_ATTEMPTS) {
            stopTelegramPoll();
            Alert.alert(t('auth.loginTimeoutTitle'), t('auth.loginTimeoutBody'));
            return;
          }
        } catch {
          // Network error — retry with backoff, but still honour MAX_ATTEMPTS
          if (attempt >= MAX_ATTEMPTS) {
            stopTelegramPoll();
            Alert.alert(t('auth.loginTimeoutTitle'), t('auth.loginTimeoutBody'));
            return;
          }
        }
        scheduleNext(attempt + 1);
      }, delayMs);
    }

    scheduleNext(0);
  }

  function stopTelegramPoll() {
    telegramCancelledRef.current = true;
    if (telegramPollRef.current) {
      clearTimeout(telegramPollRef.current);
      telegramPollRef.current = null;
    }
    // BUG-MEM-01 FIX: only update state if still mounted to avoid the
    // "Can't perform a React state update on an unmounted component" warning.
    if (mountedRef.current) setTelegramLoading(false);
  }

  // Stop polling on unmount
  useEffect(() => {
    return () => stopTelegramPoll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  return (
    <Screen contentStyle={styles.content}>
      {/* Session-expired notice is handled globally by SessionExpiredModal in _layout.tsx */}

      {/* Logo / wordmark area */}
      <View style={styles.hero}>
        <Text style={[styles.logo, { color: colors.brand.blue }]}>Z</Text>
        <Text style={[styles.appName, { color: textColor }]}>Zobia Social</Text>
        <Text style={[styles.tagline, { color: subtitleColor }]}>
          {t('auth.loginSubtitle')}
        </Text>
      </View>

      {/* Auth buttons */}
      <View style={styles.buttons}>
        <Button
          label={googleLoading ? t('auth.googleOpening') : t('auth.loginWithGoogle')}
          variant="secondary"
          size="lg"
          loading={googleLoading}
          onPress={handleGoogleLogin}
          leftIcon={
            <Ionicons name="logo-google" size={20} color={colors.brand.blue} />
          }
          style={styles.authButton}
        />

        <Button
          label={telegramLoading ? t('auth.telegramWaiting') : t('auth.loginWithTelegram')}
          variant="primary"
          size="lg"
          loading={telegramLoading}
          onPress={handleTelegramLogin}
          leftIcon={
            <Ionicons name="send" size={20} color={colors.neutral[0]} />
          }
          style={[styles.authButton, { backgroundColor: colors.brand.blue }]}
        />
      </View>

      {/* Legal footnote */}
      <Text style={[styles.legal, { color: subtitleColor }]}>
        {t('legal.agreePrefix')}{' '}
        <Text
          style={[styles.legalLink, { color: colors.brand.blue }]}
          onPress={() => Linking.openURL(`${env.API_BASE_URL}/terms`)}
          accessibilityRole="link"
        >
          {t('legal.termsOfService')}
        </Text>
        {' '}{t('legal.and')}{' '}
        <Text
          style={[styles.legalLink, { color: colors.brand.blue }]}
          onPress={() => Linking.openURL(`${env.API_BASE_URL}/privacy`)}
          accessibilityRole="link"
        >
          {t('legal.privacyPolicy')}
        </Text>
        .
      </Text>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 40,
    paddingTop: 80,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    fontSize: 72,
    fontWeight: '800',
    letterSpacing: -2,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 280,
  },
  buttons: {
    gap: 12,
    width: '100%',
  },
  authButton: {
    width: '100%',
  },
  legal: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
  legalLink: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  expiredBanner: {
    borderRadius: 8,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  expiredText: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
});
