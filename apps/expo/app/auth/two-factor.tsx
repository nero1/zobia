/**
 * Zobia Social — Two-Factor Authentication screen (mobile).
 *
 * Shown during login when the user has TOTP enabled. Receives an opaque
 * pre-auth code via deep-link query params (?pre_auth_code=...) which is
 * first exchanged for the actual pre-auth JWT via /api/auth/mobile-token,
 * then the 6-digit TOTP code is verified via /api/auth/2fa/verify?platform=mobile.
 *
 * On success, the endpoint returns { accessToken, refreshToken, user } so the
 * app can call signIn() and complete the session without needing cookies.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth/hooks';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { env } from '@/lib/env';
import type { AuthUser } from '@/lib/auth/context';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TwoFactorScreen() {
  const { t } = useTranslation();
  const { preAuthCode } = useLocalSearchParams<{ preAuthCode: string }>();
  const { signIn } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolvingToken, setResolvingToken] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The actual pre-auth JWT resolved from the opaque preAuthCode.
  const preAuthTokenRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Step 1: Exchange the opaque deep-link code for the real pre-auth JWT.
  // This happens on mount, before the user enters a TOTP code.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!preAuthCode) {
      setError(t('auth.twoFaVerify.invalidToken'));
      setResolvingToken(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${env.API_BASE_URL}/api/auth/mobile-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: env.API_BASE_URL,
          },
          body: JSON.stringify({ pre_auth_code: preAuthCode }),
        });

        if (cancelled) return;

        if (!res.ok) {
          setError(t('auth.twoFaVerify.invalidToken'));
          return;
        }

        const { preAuthToken } = (await res.json()) as { preAuthToken?: string };
        if (cancelled) return;

        if (!preAuthToken) {
          setError(t('auth.twoFaVerify.invalidToken'));
          return;
        }

        preAuthTokenRef.current = preAuthToken;
      } catch {
        if (!cancelled) setError(t('auth.twoFaVerify.networkError'));
      } finally {
        if (!cancelled) setResolvingToken(false);
      }
    })();

    return () => { cancelled = true; };
  }, [preAuthCode, t]);

  // -------------------------------------------------------------------------
  // Step 2: User enters 6-digit TOTP code and submits.
  // -------------------------------------------------------------------------
  async function handleVerify() {
    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) return;

    const preAuthToken = preAuthTokenRef.current;
    if (!preAuthToken) {
      setError(t('auth.twoFaVerify.invalidToken'));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(
        `${env.API_BASE_URL}/api/auth/2fa/verify?platform=mobile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: env.API_BASE_URL,
          },
          body: JSON.stringify({ code: trimmedCode, preAuthToken }),
        }
      );

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        accessToken?: string;
        refreshToken?: string;
        onboardingCompleted?: boolean;
        user?: AuthUser;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? t('auth.twoFaVerify.error'));
        return;
      }

      if (!data.accessToken || !data.user) {
        setError(t('auth.twoFaVerify.networkError'));
        return;
      }

      await signIn(data.accessToken, data.user, data.refreshToken);

      if (!data.onboardingCompleted) {
        router.replace('/onboarding');
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      setError(t('auth.twoFaVerify.networkError'));
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.lockEmoji}>🔐</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {t('auth.twoFaVerify.title')}
        </Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {t('auth.twoFaVerify.instructions')}
        </Text>
      </View>

      <View style={styles.form}>
        {resolvingToken ? (
          <Text style={[styles.resolving, { color: subtitleColor }]}>
            {t('common.loading')}
          </Text>
        ) : (
          <>
            <Input
              label={t('settings.verificationCode')}
              placeholder={t('auth.twoFaVerify.placeholder')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              error={error ?? undefined}
              style={styles.codeInput}
            />

            <Button
              label={loading ? t('auth.twoFaVerify.verifying') : t('auth.twoFaVerify.submit')}
              variant="primary"
              size="lg"
              loading={loading}
              disabled={loading || code.length !== 6}
              onPress={handleVerify}
              style={styles.submitButton}
            />
          </>
        )}

        {!resolvingToken && (
          <Text
            style={[styles.backLink, { color: colors.brand.blue }]}
            onPress={() => router.replace('/auth/login')}
            accessibilityRole="link"
          >
            {t('auth.twoFaVerify.backToLogin')}
          </Text>
        )}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 40,
  },
  lockEmoji: {
    fontSize: 52,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 300,
    lineHeight: 20,
  },
  form: {
    gap: 16,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    letterSpacing: 8,
    fontWeight: '600',
  },
  submitButton: {
    width: '100%',
  },
  resolving: {
    textAlign: 'center',
    fontSize: 14,
  },
  backLink: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
});
