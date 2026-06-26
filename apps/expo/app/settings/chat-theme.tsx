/**
 * app/settings/chat-theme.tsx
 *
 * Chat Theme selector screen.
 *
 * Allows Pro/Max users to pick a custom DM bubble colour theme.
 * Free/Plus users see the themes locked with an upgrade prompt.
 *
 * Themes: default, midnight, ocean, forest, sunset
 * Non-default themes require Pro or Max plan (PRD §3).
 */

import React, { useCallback } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { CHAT_THEMES, type ThemeConfig, type ChatTheme } from '@/lib/theme/chatThemes';
import { translateApiError } from '@/lib/i18n/apiErrors';

export type { ChatTheme };

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCurrentTheme(): Promise<ChatTheme> {
  const { data } = await apiClient.get('/users/me/theme');
  return (data.data?.theme ?? 'default') as ChatTheme;
}

async function fetchUserPlan(): Promise<string> {
  const { data } = await apiClient.get('/users/me');
  return data.user?.planTier ?? data.plan ?? 'free';
}

async function updateTheme(theme: ChatTheme): Promise<void> {
  await apiClient.put('/users/me/theme', { theme });
}

// ---------------------------------------------------------------------------
// Preview bubble
// ---------------------------------------------------------------------------

function BubblePreview({ theme }: { theme: ThemeConfig }) {
  return (
    <View style={styles.previewRow}>
      <View style={[styles.previewBubbleOther, { backgroundColor: theme.bubbleOther }]}>
        <Text style={styles.previewText}>Hey! 👋</Text>
      </View>
      <View style={[styles.previewBubbleOwn, { backgroundColor: theme.bubbleOwn }]}>
        <Text style={styles.previewTextOwn}>What's up! 😄</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ChatThemeScreen() {
  const { colors: themeColors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: currentTheme = 'default' } = useQuery({
    queryKey: ['chat-theme'],
    queryFn: fetchCurrentTheme,
  });

  const { data: userPlan = 'free' } = useQuery({
    queryKey: ['user-plan'],
    queryFn: fetchUserPlan,
    staleTime: 60_000,
  });

  const isPaidPlan = userPlan === 'pro' || userPlan === 'max';

  const mutation = useMutation({
    mutationFn: updateTheme,
    onSuccess: (_, theme) => {
      queryClient.setQueryData(['chat-theme'], theme);
    },
    onError: (err: Error) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Could not update theme. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const handleSelect = useCallback(
    (theme: ThemeConfig) => {
      if (theme.requiresPaid && !isPaidPlan) {
        Alert.alert(
          'Pro or Max Required',
          'Custom chat themes are available on Pro and Max plans. Upgrade to unlock this feature.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Upgrade',
              onPress: () => router.push('/settings/subscription' as never),
            },
          ]
        );
        return;
      }
      mutation.mutate(theme.id);
    },
    [isPaidPlan, mutation, router]
  );

  return (
    <Screen scrollable>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.pageTitle, { color: themeColors.text }]}>Chat Themes</Text>
        <Text style={[styles.pageDesc, { color: themeColors.textMuted }]}>
          Choose how your DM bubbles look. Custom themes require Pro or Max.
        </Text>

        {CHAT_THEMES.map((theme) => {
          const isActive = currentTheme === theme.id;
          const locked = theme.requiresPaid && !isPaidPlan;

          return (
            <Pressable
              key={theme.id}
              style={[
                styles.themeCard,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: isActive ? theme.bubbleOwn : themeColors.border,
                  borderWidth: isActive ? 2 : 1,
                },
                locked && styles.themeCardLocked,
              ]}
              onPress={() => handleSelect(theme)}
              accessibilityRole="radio"
              accessibilityState={{ checked: isActive }}
              accessibilityLabel={`${theme.label} theme${locked ? ', requires Pro or Max' : ''}`}
            >
              <View style={styles.themeCardHeader}>
                <Text style={styles.themeEmoji}>{theme.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.themeLabel, { color: locked ? themeColors.textMuted : themeColors.text }]}>
                    {theme.label}
                  </Text>
                  {theme.requiresPaid && (
                    <Text style={[styles.themePlanNote, { color: themeColors.textMuted }]}>
                      Pro / Max
                    </Text>
                  )}
                </View>
                {isActive && (
                  <View style={[styles.activeBadge, { backgroundColor: theme.bubbleOwn }]}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                )}
                {locked && (
                  <Text style={styles.lockIcon}>🔒</Text>
                )}
              </View>

              <BubblePreview theme={theme} />
            </Pressable>
          );
        })}

        {!isPaidPlan && (
          <View style={[styles.upgradeCard, { backgroundColor: `${colors.brand.blue}12`, borderColor: colors.brand.blue }]}>
            <Text style={[styles.upgradeTitle, { color: themeColors.text }]}>
              Unlock Custom Themes
            </Text>
            <Text style={[styles.upgradeDesc, { color: themeColors.textMuted }]}>
              Upgrade to Pro or Max to unlock 4 exclusive chat themes.
            </Text>
            <Pressable
              style={[styles.upgradeBtn, { backgroundColor: colors.brand.blue }]}
              onPress={() => router.push('/settings/subscription' as never)}
              accessibilityRole="button"
            >
              <Text style={styles.upgradeBtnText}>Upgrade Plan →</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },

  pageTitle: { fontSize: 22, fontWeight: '800', marginBottom: 2 },
  pageDesc: { fontSize: 14, lineHeight: 20, marginBottom: 4 },

  themeCard: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 14,
    gap: 10,
  },
  themeCardLocked: { opacity: 0.7 },
  themeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeEmoji: { fontSize: 24 },
  themeLabel: { fontSize: 16, fontWeight: '700' },
  themePlanNote: { fontSize: 11, fontWeight: '600', marginTop: 1 },

  activeBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  lockIcon: { fontSize: 18 },

  previewRow: {
    gap: 8,
    paddingTop: 2,
  },
  previewBubbleOther: {
    alignSelf: 'flex-start',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '70%',
  },
  previewBubbleOwn: {
    alignSelf: 'flex-end',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '70%',
  },
  previewText: { fontSize: 14, color: '#fff' },
  previewTextOwn: { fontSize: 14, color: '#fff' },

  upgradeCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    gap: 8,
    marginTop: 4,
  },
  upgradeTitle: { fontSize: 16, fontWeight: '800' },
  upgradeDesc: { fontSize: 14, lineHeight: 20 },
  upgradeBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  upgradeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
