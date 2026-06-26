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
import { apiClient } from '@/lib/api/client';
import { storage, STORE_KEYS } from '@/lib/offline/store';
import type { AuthUser } from '@/lib/auth/context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTP_MAX_ATTEMPTS = 5;

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
  const [lockedOut, setLockedOut] = useState(() => {
    // M-2 FIX: restore lockout state from MMKV so it survives app restarts.
    try {
      const until = storage.getNumber(STORE_KEYS.TOTP_LOCKED_UNTIL) ?? 0;
      return until > Date.now();
    } catch { return false; }
  });

  // The actual pre-auth JWT resolved from the opaque preAuthCode.
  const preAuthTokenRef = useRef<string | null>(null);
  // M-2 FIX: persist attempt count to MMKV so lockout survives app restarts.
  // useRef starts at 0 and is hydrated from MMKV on mount (synchronous read,
  // only matters for event handlers so the timing is fine).
  const totpAttemptsRef = useRef(0);
  useEffect(() => {
    try { totpAttemptsRef.current = storage.getNumber(STORE_KEYS.TOTP_ATTEMPTS) ?? 0; } catch {}
  }, []);

  // -------------------------------------------------------------------------
  // Step 1: Exchange the opaque deep-link code for the real pre-auth JWT.
  // Uses apiClient so the auth interceptor and proxy config are applied.
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
        const { data } = await apiClient.post<{ preAuthToken?: string }>(
          '/auth/mobile-token',
          { pre_auth_code: preAuthCode }
        );

        if (cancelled) return;

        if (!data.preAuthToken) {
          setError(t('auth.twoFaVerify.invalidToken'));
          return;
        }

        preAuthTokenRef.current = data.preAuthToken;
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
  // Rate-limited to TOTP_MAX_ATTEMPTS failures before lockout.
  // -------------------------------------------------------------------------
  async function handleVerify() {
    if (lockedOut) return;

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
      const { data } = await apiClient.post<{
        success?: boolean;
        error?: string;
        accessToken?: string;
        refreshToken?: string;
        onboardingCompleted?: boolean;
        user?: AuthUser;
      }>(
        '/auth/2fa/verify',
        { code: trimmedCode, preAuthToken },
        { params: { platform: 'mobile' } }
      );

      if (!data.success) {
        totpAttemptsRef.current += 1;
        try { storage.set(STORE_KEYS.TOTP_ATTEMPTS, totpAttemptsRef.current); } catch {}
        if (totpAttemptsRef.current >= TOTP_MAX_ATTEMPTS) {
          const lockUntil = Date.now() + 15 * 60 * 1000; // 15-minute lockout
          try {
            storage.set(STORE_KEYS.TOTP_LOCKED_UNTIL, lockUntil);
            storage.delete(STORE_KEYS.TOTP_ATTEMPTS);
          } catch {}
          setLockedOut(true);
          setError(t('auth.twoFaVerify.lockedOut'));
        } else {
          setError(data.error ?? t('auth.twoFaVerify.error'));
        }
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
    } catch (err) {
      totpAttemptsRef.current += 1;
      try { storage.set(STORE_KEYS.TOTP_ATTEMPTS, totpAttemptsRef.current); } catch {}
      if (totpAttemptsRef.current >= TOTP_MAX_ATTEMPTS) {
        const lockUntil = Date.now() + 15 * 60 * 1000;
        try {
          storage.set(STORE_KEYS.TOTP_LOCKED_UNTIL, lockUntil);
          storage.delete(STORE_KEYS.TOTP_ATTEMPTS);
        } catch {}
        setLockedOut(true);
        setError(t('auth.twoFaVerify.lockedOut'));
      } else {
        const apiMsg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        setError(apiMsg ?? t('auth.twoFaVerify.networkError'));
      }
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
              editable={!lockedOut}
              error={error ?? undefined}
              style={styles.codeInput}
            />

            <Button
              label={loading ? t('auth.twoFaVerify.verifying') : t('auth.twoFaVerify.submit')}
              variant="primary"
              size="lg"
              loading={loading}
              disabled={loading || code.length !== 6 || lockedOut}
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
