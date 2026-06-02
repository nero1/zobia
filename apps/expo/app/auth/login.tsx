/**
 * Zobia Social — Login screen.
 *
 * Phase 1 implementation:
 *  - Google OAuth button (launches browser-based OAuth flow)
 *  - Telegram Login button (deep-links to Telegram bot)
 *
 * No purple, no gradients. Clean blue/green/gold palette only.
 */

import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/hooks';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import type { AuthUser } from '@/lib/auth/context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Telegram bot username that handles Zobia login. */
const TELEGRAM_BOT = 'ZobiaSocialBot';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LoginScreen — entry point for unauthenticated users.
 *
 * After a successful OAuth exchange the backend returns a JWT + user payload
 * which are persisted via `signIn` from the auth context.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /**
   * Initiates the Google OAuth flow.
   *
   * In Phase 1 this is a stub that shows a placeholder alert.
   * Phase 2 will integrate `expo-auth-session` with the backend /auth/google endpoint.
   */
  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try {
      // TODO Phase 2: replace with expo-auth-session OAuth flow.
      // const result = await promptAsync();
      // const { data } = await apiClient.post('/auth/google', { code: result.params.code });
      // await signIn(data.token, data.user);
      // router.replace('/(tabs)');

      Alert.alert(
        'Google Sign-In',
        'Google OAuth will be enabled in Phase 2. Stay tuned!',
      );
    } catch (err) {
      Alert.alert(t('common.error'), String(err));
    } finally {
      setGoogleLoading(false);
    }
  }

  /**
   * Initiates Telegram login by opening the Telegram bot deep link.
   *
   * Phase 2 will add the Telegram Login Widget callback via a WebView.
   */
  async function handleTelegramLogin() {
    setTelegramLoading(true);
    try {
      const url = `https://t.me/${TELEGRAM_BOT}?start=login`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Telegram',
          'Please install Telegram to use this login method.',
        );
      }
    } catch (err) {
      Alert.alert(t('common.error'), String(err));
    } finally {
      setTelegramLoading(false);
    }
  }

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
          label={t('auth.loginWithGoogle')}
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
          label={t('auth.loginWithTelegram')}
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
        By continuing you agree to our Terms of Service and Privacy Policy.
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
    fontSize: 16,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 22,
  },
  buttons: {
    gap: 12,
    paddingBottom: 24,
  },
  authButton: {
    width: '100%',
  },
  legal: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
