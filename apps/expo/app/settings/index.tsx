/**
 * app/settings/index.tsx
 *
 * Settings screen.
 *
 * Sections:
 *  - Account: display name, bio, email, password, PIN
 *  - Language picker (8 languages)
 *  - Theme toggle (light/dark)
 *  - Notification preferences (DMs, guild, streak)
 *  - Privacy: DM opt-out toggle
 *  - Danger zone: Logout, Delete Account (with confirmation)
 */

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  displayName: string;
  bio: string;
  email: string;
  language: string;
  theme: 'light' | 'dark' | 'system';
  notifDMs: boolean;
  notifGuild: boolean;
  notifStreak: boolean;
  privacyDMOptOut: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'pt', label: 'Português' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'yo', label: 'Yorùbá' },
  { code: 'ha', label: 'Hausa' },
];

type ThemeMode = 'light' | 'dark' | 'system';
const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: '☀️ Light' },
  { key: 'dark', label: '🌙 Dark' },
  { key: 'system', label: '⚙️ System' },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchSettings(): Promise<UserSettings> {
  const { data } = await apiClient.get('/users/me/settings');
  return data.settings;
}

async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  await apiClient.patch('/users/me/settings', patch);
}

async function logoutUser(): Promise<void> {
  await apiClient.post('/auth/logout');
}

async function deleteAccount(pin: string): Promise<void> {
  await apiClient.delete('/users/me', { data: { pin } });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  const { colors: themeColors } = useTheme();
  return (
    <Text style={[styles.sectionHeader, { color: themeColors.textMuted }]}>
      {title}
    </Text>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.toggleRow, { borderBottomColor: themeColors.border }]}>
      <View style={styles.toggleInfo}>
        <Text style={[styles.toggleLabel, { color: themeColors.text }]}>{label}</Text>
        {description && (
          <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        thumbColor={colors.neutral[0]}
        trackColor={{ false: colors.neutral[300], true: colors.brand.blue }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SettingsSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5, 6].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * SettingsScreen — account, preferences, privacy, and danger zone.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors, isDark } = useTheme();

  const { data, isLoading } = useQuery({
    queryKey: ['user-settings'],
    queryFn: fetchSettings,
  });

  const [settings, setSettings] = useState<Partial<UserSettings>>({});

  const merged: UserSettings = {
    displayName: '',
    bio: '',
    email: '',
    language: 'en',
    theme: 'system',
    notifDMs: true,
    notifGuild: true,
    notifStreak: true,
    privacyDMOptOut: false,
    ...data,
    ...settings,
  };

  const patchMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-settings'] }),
  });

  const set = (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => {
    const patch = { [key]: value } as Partial<UserSettings>;
    setSettings((prev) => ({ ...prev, ...patch }));
    patchMutation.mutate(patch);
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logoutUser().catch(() => {});
          router.replace('/auth/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This is permanent and cannot be undone. Enter your PIN to confirm.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.prompt(
              'Confirm PIN',
              'Enter your 4-digit PIN',
              async (pin) => {
                if (!pin) return;
                try {
                  await deleteAccount(pin);
                  router.replace('/auth/login');
                } catch {
                  Alert.alert('Error', 'Could not delete account. Check your PIN.');
                }
              },
              'secure-text',
            );
          },
        },
      ],
    );
  };

  const fieldStyle = {
    backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
    color: themeColors.text,
  };

  if (isLoading) return <Screen><SettingsSkeleton /></Screen>;

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Account */}
      <SectionHeader title="ACCOUNT" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <TextInput
          style={[styles.field, fieldStyle, { borderBottomColor: themeColors.border }]}
          placeholder="Display name"
          placeholderTextColor={themeColors.textMuted}
          value={merged.displayName}
          onChangeText={(v) => set('displayName', v)}
          maxLength={40}
          returnKeyType="done"
          onEndEditing={() => patchMutation.mutate({ displayName: merged.displayName })}
        />
        <TextInput
          style={[styles.field, styles.fieldMulti, fieldStyle, { borderBottomColor: themeColors.border }]}
          placeholder="Bio (optional)"
          placeholderTextColor={themeColors.textMuted}
          value={merged.bio}
          onChangeText={(v) => set('bio', v)}
          maxLength={150}
          multiline
          numberOfLines={3}
          onEndEditing={() => patchMutation.mutate({ bio: merged.bio })}
        />
        <TextInput
          style={[styles.field, fieldStyle, { borderBottomColor: themeColors.border }]}
          placeholder="Email"
          placeholderTextColor={themeColors.textMuted}
          value={merged.email}
          onChangeText={(v) => set('email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="done"
        />
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: themeColors.border }]}
          onPress={() => Alert.alert('Change Password', 'Password change flow would open here.')}
          accessibilityRole="button"
        >
          <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Change Password</Text>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
          onPress={() => Alert.alert('Change PIN', 'PIN change flow would open here.')}
          accessibilityRole="button"
        >
          <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Change PIN</Text>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
      </View>

      {/* Language */}
      <SectionHeader title="LANGUAGE" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <View style={styles.languageGrid}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              onPress={() => set('language', lang.code)}
              style={[
                styles.langPill,
                merged.language === lang.code && {
                  backgroundColor: colors.brand.blue,
                  borderColor: colors.brand.blue,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: merged.language === lang.code }}
            >
              <Text
                style={[
                  styles.langPillText,
                  merged.language === lang.code
                    ? { color: colors.neutral[0] }
                    : { color: themeColors.text },
                ]}
              >
                {lang.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Theme */}
      <SectionHeader title="THEME" />
      <View style={[styles.card, styles.themeRow, { backgroundColor: themeColors.surface }]}>
        {THEME_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => set('theme', opt.key)}
            style={[
              styles.themeBtn,
              merged.theme === opt.key && { backgroundColor: colors.brand.blue },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: merged.theme === opt.key }}
          >
            <Text
              style={[
                styles.themeBtnText,
                merged.theme === opt.key
                  ? { color: colors.neutral[0] }
                  : { color: themeColors.text },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Notifications */}
      <SectionHeader title="NOTIFICATIONS" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <ToggleRow
          label="Direct Messages"
          value={merged.notifDMs}
          onChange={(v) => set('notifDMs', v)}
        />
        <ToggleRow
          label="Guild Activity"
          value={merged.notifGuild}
          onChange={(v) => set('notifGuild', v)}
        />
        <ToggleRow
          label="Streak Reminders"
          description="Daily reminder to maintain your streak"
          value={merged.notifStreak}
          onChange={(v) => set('notifStreak', v)}
        />
      </View>

      {/* Privacy */}
      <SectionHeader title="PRIVACY" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <ToggleRow
          label="Disable Direct Messages"
          description="Prevent non-friends from sending you DMs"
          value={merged.privacyDMOptOut}
          onChange={(v) => set('privacyDMOptOut', v)}
        />
      </View>

      {/* Danger zone */}
      <SectionHeader title="DANGER ZONE" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Button
          label="Log Out"
          variant="secondary"
          onPress={handleLogout}
          style={styles.dangerBtn}
        />
        <Button
          label="Delete Account"
          variant="danger"
          onPress={handleDeleteAccount}
          style={styles.dangerBtn}
        />
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4, paddingBottom: 40 },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 6,
  },

  card: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
  },

  field: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldMulti: { minHeight: 80, textAlignVertical: 'top' },

  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  settingsRowLabel: { fontSize: 15 },
  chevron: { fontSize: 20, fontWeight: '300' },

  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
  },
  langPill: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  langPillText: { fontSize: 13, fontWeight: '600' },

  themeRow: {
    flexDirection: 'row',
    padding: 8,
    gap: 6,
  },
  themeBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  themeBtnText: { fontSize: 13, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
    gap: 12,
  },
  toggleInfo: { flex: 1 },
  toggleLabel: { fontSize: 15 },
  toggleDesc: { fontSize: 12, marginTop: 2 },

  dangerBtn: { margin: 8 },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 52, borderRadius: 10, backgroundColor: colors.neutral[200] },
});
