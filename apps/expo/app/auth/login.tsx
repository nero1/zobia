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
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import * as Crypto from 'expo-crypto';

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

const TELEGRAM_BOT = 'Zobia_bot_bot';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // Used for Telegram state polling
  const telegramStateRef = useRef<string | null>(null);
  const telegramPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Deep link listener — catches the callback from Google OAuth redirect
  // -------------------------------------------------------------------------

  async function handleDeepLink(event: { url: string }) {
    const url = event.url;
    if (!url.includes('auth/callback')) return;

    try {
      const parsed = ExpoLinking.parse(url);
      const code = parsed.queryParams?.code as string | undefined;

      if (!code) return;

      // Exchange the one-time code for tokens via HTTPS — tokens are never
      // exposed in the URL (prevents leakage via browser history / server logs).
      const exchangeRes = await fetch(`${env.API_BASE_URL}/api/auth/mobile-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': env.API_BASE_URL },
        body: JSON.stringify({ code }),
      });

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
      if (!onboardingCompleted) {
        router.replace('/onboarding');
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      Alert.alert(t('common.error'), t('auth.callbackError'));
    }
  }

  useEffect(() => {
    const subscription = ExpoLinking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [signIn, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try {
      const redirectUri = ExpoLinking.createURL('auth/callback');

      // Step 1: fetch the Google OAuth URL from the backend.
      // /api/auth/google returns JSON { url } — it does NOT redirect directly.
      const apiUrl =
        `${env.API_BASE_URL}/api/auth/google?platform=mobile&redirect=${encodeURIComponent(redirectUri)}`;
      const apiRes = await fetch(apiUrl);
      if (!apiRes.ok) throw new Error('Failed to initiate Google login');
      const { url: googleAuthUrl } = (await apiRes.json()) as { url: string };

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
    } catch (err) {
      Alert.alert(t('common.error'), t('auth.telegramError'));
      setTelegramLoading(false);
    }
  }

  function startTelegramPoll(state: string) {
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // 60 seconds total

    telegramPollRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data } = await apiClient.get(`/auth/telegram/status?state=${state}`);
        if (data.status === 'approved' && data.token && data.user) {
          stopTelegramPoll();
          await signIn(data.token, data.user as AuthUser, data.refreshToken);
          router.replace('/(tabs)');
        } else if (data.status === 'expired' || attempts >= MAX_ATTEMPTS) {
          stopTelegramPoll();
          Alert.alert(t('auth.loginTimeoutTitle'), t('auth.loginTimeoutBody'));
        }
      } catch {
        // Network error — keep polling
      }
    }, 2000);
  }

  function stopTelegramPoll() {
    if (telegramPollRef.current) {
      clearInterval(telegramPollRef.current);
      telegramPollRef.current = null;
    }
    setTelegramLoading(false);
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
          onPress={() => Linking.openURL('https://zobia.app/terms')}
          accessibilityRole="link"
        >
          {t('legal.termsOfService')}
        </Text>
        {' '}{t('legal.and')}{' '}
        <Text
          style={[styles.legalLink, { color: colors.brand.blue }]}
          onPress={() => Linking.openURL('https://zobia.app/privacy')}
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
});
