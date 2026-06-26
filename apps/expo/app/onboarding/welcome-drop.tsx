/**
 * Zobia Social — Onboarding Step 3: Welcome Drop.
 *
 * Celebrates onboarding completion with:
 *  - A large animated "+500 XP" counter using Reanimated
 *  - The user's chosen avatar emoji
 *  - A "Start exploring" CTA that navigates to the main tab navigator
 *
 * No purple, no gradients.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { STORE_KEYS, setItem, getItem, removeItem } from '@/lib/offline/store';
import { apiClient } from '@/lib/api/client';
import {
  getPendingReferralCode,
  clearPendingReferralCode,
} from '@/lib/deeplinks/referral';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * WelcomeDrop — final onboarding screen with 500 XP celebration animation.
 *
 * Marks onboarding as complete in the offline store so the app won't
 * redirect here again after restart.
 */
export default function WelcomeDrop() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    username: string;
    emoji: string;
    city: string;
    vibeAnswers: string;
    // birthYear/Month/Day are NOT in params — M-6 fix reads them from MMKV draft
  }>();

  // -------------------------------------------------------------------------
  // Animation values
  // -------------------------------------------------------------------------

  /** XP badge scale: starts at 0, springs up to 1 then settles. */
  const xpScale = useSharedValue(0);
  /** XP badge opacity */
  const xpOpacity = useSharedValue(0);
  /** Avatar scale: bounces in slightly after the XP badge. */
  const avatarScale = useSharedValue(0.6);
  /** CTA fade in last */
  const ctaOpacity = useSharedValue(0);

  const { username, emoji, city, vibeAnswers: vibeAnswersParam } = params;
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    // BUG-MEM-03 FIX: use AbortController so the request can be cancelled and
    // we avoid setState calls on an unmounted component.
    const controller = new AbortController();

    // Persist onboarding data to the server.
    let vibeAnswers: Record<string, unknown> = {};
    if (vibeAnswersParam) {
      try {
        vibeAnswers = JSON.parse(vibeAnswersParam);
      } catch {
        vibeAnswers = {};
      }
    }
    // M-6 FIX: read DOB from MMKV draft (written in index.tsx) so PII never
    // travels through URL params.
    const draftDob = getItem<{ birthYear?: string; birthMonth?: string; birthDay?: string }>(
      STORE_KEYS.ONBOARDING_DRAFT, {}
    );
    const { birthYear, birthMonth, birthDay } = draftDob;
    // Replay any referral code captured from a ?r= deep/universal link.
    let referralCode: string | null = null;
    try {
      referralCode = getPendingReferralCode();
    } catch {
      // MMKV read failure is non-fatal — proceed without referral attribution
    }
    apiClient
      .post('/onboarding/complete', {
        username: username,
        display_name: username,
        avatar_emoji: emoji,
        city: city,
        birth_year: birthYear ? parseInt(birthYear, 10) : undefined,
        birth_month: birthMonth ? parseInt(birthMonth, 10) : undefined,
        birth_day: birthDay ? parseInt(birthDay, 10) : undefined,
        vibe_quiz_responses: vibeAnswers,
        referral_code: referralCode ?? undefined,
      }, { signal: controller.signal })
      .then(() => {
        if (controller.signal.aborted) return;
        // Mark onboarding complete only after server confirms it.
        setItem(STORE_KEYS.ONBOARDING_COMPLETE, true);
        // Clear DOB draft now that the server has recorded it.
        removeItem(STORE_KEYS.ONBOARDING_DRAFT);
        // Attribution recorded — clear so a later organic signup on this
        // device is not misattributed to the same referrer.
        clearPendingReferralCode();
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const isCancel = (err as { name?: string })?.name === 'AbortError' || (err as { code?: string })?.code === 'ERR_CANCELED';
        if (isCancel) return;
        // BUG-024 FIX: status-aware error handling.
        // 409 Conflict → onboarding was already completed server-side; treat as
        //   success and mark complete locally so the user isn't stuck.
        // Other 4xx → server rejected the data; mark complete and let the user
        //   proceed (server completes onboarding on next login if needed).
        // 5xx / network errors → surface an error banner so the user knows.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409) {
          setItem(STORE_KEYS.ONBOARDING_COMPLETE, true);
          removeItem(STORE_KEYS.ONBOARDING_DRAFT);
          clearPendingReferralCode();
        } else if (status !== undefined && status >= 400 && status < 500) {
          setItem(STORE_KEYS.ONBOARDING_COMPLETE, true);
          removeItem(STORE_KEYS.ONBOARDING_DRAFT);
        } else {
          setSubmitError(true);
        }
      });

    // Sequence: avatar → XP badge → CTA
    avatarScale.value = withSpring(1, { damping: 12, stiffness: 180 });

    xpOpacity.value = withDelay(400, withTiming(1, { duration: 200 }));
    xpScale.value = withDelay(
      400,
      withSequence(
        withSpring(1.2, { damping: 8, stiffness: 200 }),
        withSpring(1, { damping: 14, stiffness: 160 }),
      ),
    );

    ctaOpacity.value = withDelay(
      1000,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }),
    );
    // BUG-MEM-03 FIX: cancel the request on unmount
    return () => controller.abort();
  }, [avatarScale, xpOpacity, xpScale, ctaOpacity, username, emoji, city, vibeAnswersParam]);

  const avatarAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: avatarScale.value }],
  }));

  const xpAnimStyle = useAnimatedStyle(() => ({
    opacity: xpOpacity.value,
    transform: [{ scale: xpScale.value }],
  }));

  const ctaAnimStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
  }));

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleGetStarted() {
    // Step 4: First Contact — invite contacts, explore first room, accept quest
    router.push('/onboarding/first-contact');
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.inner}>
        {/* Step badge */}
        <Text style={[styles.stepBadge, { color: colors.brand.blue }]}>Step 3 of 3</Text>

        {/* Animated avatar */}
        <Animated.View style={avatarAnimStyle}>
          <Avatar emoji={params.emoji ?? '🙂'} size="xl" rankTier="bronze" />
        </Animated.View>

        {/* Username greeting */}
        <Text style={[styles.greeting, { color: textColor }]}>
          {t('onboarding.step3Title')}
        </Text>
        <Text style={[styles.username, { color: colors.brand.blue }]}>
          @{params.username ?? 'explorer'}
        </Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {t('onboarding.step3Subtitle')}
        </Text>

        {/* XP badge */}
        <Animated.View
          style={[
            styles.xpBadge,
            { backgroundColor: colors.brand.gold + '20', borderColor: colors.brand.gold },
            xpAnimStyle,
          ]}
        >
          <Text style={[styles.xpAmount, { color: colors.brand.gold }]}>
            {t('onboarding.xpEarned')}
          </Text>
          <Text style={[styles.xpLabel, { color: subtitleColor }]}>
            {t('onboarding.xpDescription')}
          </Text>
        </Animated.View>

        {submitError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{t('onboarding.completeError')}</Text>
          </View>
        )}

        {/* CTA */}
        <Animated.View style={[styles.ctaContainer, ctaAnimStyle]}>
          <Button
            label={t('onboarding.getStarted')}
            size="lg"
            onPress={handleGetStarted}
            style={styles.cta}
          />
        </Animated.View>
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
    justifyContent: 'center',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingBottom: 40,
  },
  stepBadge: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  xpBadge: {
    marginTop: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    gap: 4,
  },
  xpAmount: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  xpLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  ctaContainer: {
    width: '100%',
    marginTop: 24,
  },
  cta: {
    width: '100%',
  },
  errorBanner: {
    width: '100%',
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    textAlign: 'center',
  },
});
