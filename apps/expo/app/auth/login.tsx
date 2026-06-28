/**
 * Zobia Social — Login screen.
 *
 * Implements:
 *  - Google OAuth via expo-web-browser (Chrome Custom Tab, PKCE-safe flow)
 *  - Telegram Login via deep link to the Zobia Telegram bot
 *
 * Auth flow for Google:
 *  1. Opens the backend /api/auth/google?platform=mobile&redirect=<deep-link>
 *     DIRECTLY inside a Chrome Custom Tab. The browser handles Set-Cookie
 *     from that response (CSRF + mobile-redirect cookies) so they are
 *     automatically included in the subsequent /api/auth/google/callback request.
 *  2. Backend handles OAuth with Google, then redirects to zobia://auth/callback?code=EXCHANGE_CODE
 *  3. Custom Tab detects the custom-scheme URL → openAuthSessionAsync resolves with the URL.
 *  4. App POSTs the code to /api/auth/mobile-token which returns tokens (never in URL).
 *
 * Previous approach (broken): fetching the init URL via Axios and then opening
 * the returned Google URL in the Custom Tab caused the CSRF cookie to be set
 * only on the Axios client (no cookie jar) — not in the browser — so the
 * CSRF check failed with "session_expired" and the user was bounced to the web.
 *
 * Auth flow for Telegram:
 *  1. Opens Telegram bot deep link with a random state token.
 *  2. Backend receives /api/auth/telegram/callback with the user's Telegram data.
 *  3. App polls /api/auth/telegram/status?state=... until approved, then calls signIn().
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const TELEGRAM_BOT: string =
  (Constants.expoConfig?.extra?.telegramBotName as string | undefined) ?? 'Zobia_bot_bot';

// ---------------------------------------------------------------------------
// Google icon (inline SVG path data rendered as a native View)
// ---------------------------------------------------------------------------

function GoogleLogo() {
  return (
    <View style={googleLogoStyles.container}>
      {/* Multi-path Google "G" using coloured rectangles to approximate the logo */}
      <View style={googleLogoStyles.outer}>
        <View style={[googleLogoStyles.arc, googleLogoStyles.blue]} />
        <View style={[googleLogoStyles.arc, googleLogoStyles.green]} />
        <View style={[googleLogoStyles.arc, googleLogoStyles.yellow]} />
        <View style={[googleLogoStyles.arc, googleLogoStyles.red]} />
        <View style={googleLogoStyles.inner} />
        <View style={googleLogoStyles.tab} />
      </View>
    </View>
  );
}

const LOGO_SIZE = 20;

const googleLogoStyles = StyleSheet.create({
  container: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outer: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#EA4335',
  },
  arc: {
    position: 'absolute',
    width: LOGO_SIZE / 2,
    height: LOGO_SIZE,
  },
  blue: {
    backgroundColor: '#4285F4',
    right: 0,
    top: 0,
  },
  green: {
    backgroundColor: '#34A853',
    right: 0,
    bottom: 0,
  },
  yellow: {
    backgroundColor: '#FBBC05',
    left: 0,
    bottom: 0,
  },
  red: {
    backgroundColor: '#EA4335',
    left: 0,
    top: 0,
  },
  inner: {
    position: 'absolute',
    width: LOGO_SIZE * 0.55,
    height: LOGO_SIZE * 0.55,
    borderRadius: (LOGO_SIZE * 0.55) / 2,
    backgroundColor: '#ffffff',
    top: LOGO_SIZE * 0.225,
    left: LOGO_SIZE * 0.225,
  },
  tab: {
    position: 'absolute',
    width: LOGO_SIZE * 0.45,
    height: LOGO_SIZE * 0.25,
    backgroundColor: '#4285F4',
    right: 0,
    top: LOGO_SIZE * 0.375,
  },
});

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

  // Warm up Chrome Custom Tab on Android so the first press feels instant.
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  // Used for Telegram state polling
  const telegramStateRef = useRef<string | null>(null);
  const telegramPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const telegramCancelledRef = useRef(false);
  // BUG-H04 FIX: idempotency guard — prevents double token exchange
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
      const isCustomScheme =
        parsed.protocol === 'zobia:' ||
        parsed.protocol === 'exp+zobia:' ||
        parsed.protocol === 'exp+zobia-social:';
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

      if (preAuthCode) {
        exchangingRef.current = false;
        router.replace({
          pathname: '/auth/two-factor',
          params: { preAuthCode },
        });
        return;
      }

      if (!code) {
        exchangingRef.current = false;
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      let exchangeRes: Response;
      try {
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
    exchangingRef.current = false;
    setGoogleLoading(true);
    try {
      const redirectUri = ExpoLinking.createURL('auth/callback');

      // Open the Google OAuth init endpoint DIRECTLY in the Chrome Custom Tab.
      // The Custom Tab (browser) stores the Set-Cookie headers (CSRF state +
      // mobile-redirect) so they are sent automatically to the callback URL.
      // Using apiClient.get() first (the old approach) silently discarded those
      // cookies because Axios has no persistent cookie jar on Android, causing
      // the CSRF check to fail and users to be bounced to the web login page.
      const googleInitUrl =
        `${env.API_BASE_URL}/api/auth/google?platform=mobile&redirect=${encodeURIComponent(redirectUri)}`;

      const result = await WebBrowser.openAuthSessionAsync(
        googleInitUrl,
        redirectUri,
        { showInRecents: false },
      );

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
      const randomBytes = await Crypto.getRandomBytesAsync(16);
      const shortState = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      telegramStateRef.current = shortState;

      const telegramUrl = `https://t.me/${TELEGRAM_BOT}?start=login_${shortState}`;
      const canOpen = await Linking.canOpenURL(telegramUrl);

      if (!canOpen) {
        Alert.alert(t('auth.telegramRequiredTitle'), t('auth.telegramRequiredBody'));
        setTelegramLoading(false);
        return;
      }

      await Linking.openURL(telegramUrl);
      startTelegramPoll(shortState);
    } catch {
      Alert.alert(t('common.error'), t('auth.telegramError'));
      setTelegramLoading(false);
    }
  }

  function startTelegramPoll(state: string) {
    const MAX_ATTEMPTS = 12;
    telegramCancelledRef.current = false;

    function scheduleNext(attempt: number) {
      if (telegramCancelledRef.current) return;
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
    if (mountedRef.current) setTelegramLoading(false);
  }

  useEffect(() => {
    return () => stopTelegramPoll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const cardBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const cardBorder = isDark ? colors.neutral[800] : colors.neutral[200];

  return (
    <Screen contentStyle={styles.content}>
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
        {/* Google sign-in button styled to match the standard Google button spec */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleGoogleLogin}
          disabled={googleLoading}
          accessibilityRole="button"
          accessibilityLabel={t('auth.loginWithGoogle')}
          style={[
            styles.googleButton,
            { backgroundColor: cardBg, borderColor: cardBorder },
            googleLoading && styles.buttonDisabled,
          ]}
        >
          {googleLoading ? (
            <Ionicons name="sync" size={20} color={subtitleColor} style={styles.spinning} />
          ) : (
            <GoogleLogo />
          )}
          <Text style={[styles.googleButtonText, { color: textColor }]}>
            {googleLoading ? t('auth.googleOpening') : t('auth.loginWithGoogle')}
          </Text>
        </TouchableOpacity>

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

      {/* Sign up prompt */}
      <View style={styles.signUpRow}>
        <Text style={[styles.signUpText, { color: subtitleColor }]}>
          {t('auth.noAccount')}{' '}
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(`${env.API_BASE_URL}/auth/register`)}
          accessibilityRole="link"
        >
          <Text style={[styles.signUpLink, { color: colors.brand.blue }]}>
            {t('auth.signUp')}
          </Text>
        </TouchableOpacity>
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 10,
    paddingHorizontal: 24,
  },
  googleButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  spinning: {
    // Spinning is only approximate in RN; activityIndicator is the proper solution
    // but the GoogleLogo placeholder looks better at rest
  },
  signUpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  signUpText: {
    fontSize: 14,
  },
  signUpLink: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legal: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
  legalLink: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
