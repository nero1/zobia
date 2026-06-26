/**
 * app/settings/index.tsx
 *
 * Settings screen.
 *
 * Sections:
 *  - Account: display name, bio, email, password, PIN
 *  - Two-Factor Authentication (2FA)
 *  - Privacy & Data
 *  - Language picker (8 languages)
 *  - Theme toggle (light/dark)
 *  - Notification preferences (DMs, guild, streak)
 *  - Privacy: DM opt-out toggle
 *  - Appearance
 *  - Subscription
 *  - Danger zone: Logout, Delete Account (with confirmation)
 */

import React, { useEffect, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/hooks';
import type { AxiosError } from 'axios';
import i18n from 'i18next';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { translateApiError } from '@/lib/i18n/apiErrors';
import { getStorage, STORE_KEYS } from '@/lib/offline/store';
import { env } from '@/lib/env';
import { cacheDirectory, documentDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  displayName: string;
  bio: string;
  email: string;
  language: string;
  theme: 'light' | 'dark' | 'system';
  notifications: Record<string, boolean>;
  privacyDMOptOut: boolean;
  hdSendEnabled: boolean;
  pidginSuggestionsEnabled: boolean | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'ha', label: 'Hausa' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'am', label: 'አማርኛ' },
  { code: 'zu', label: 'IsiZulu' },
  { code: 'pt', label: 'Português' },
  { code: 'pidgin', label: 'Pidgin' },
];

type ThemeMode = 'light' | 'dark' | 'system';
const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: '☀️ Light' },
  { key: 'dark', label: '🌙 Dark' },
  { key: 'system', label: '⚙️ System' },
];

const NOTIFICATION_TYPES: { key: string; label: string; description: string }[] = [
  { key: 'new_message', label: 'New messages', description: 'Direct messages and room mentions' },
  { key: 'friend_request', label: 'Friend requests', description: 'Someone wants to add you' },
  { key: 'gift_received', label: 'Gifts received', description: 'When someone sends you a gift' },
  { key: 'rank_up', label: 'Rank ups', description: 'When you reach a new rank' },
  { key: 'war_start', label: 'Guild wars', description: 'Guild war start and end alerts' },
  { key: 'season_end', label: 'Season end', description: 'Season summary and rewards' },
  { key: 'announcement', label: 'Announcements', description: 'Platform-wide announcements' },
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

/**
 * Chat push toggles — independently mute pushes for DMs, group messages, and
 * room @mentions. Self-contained (own fetch + patch) so it reflects the exact
 * server contract regardless of the broader settings mapping.
 */
function ChatPushToggles() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['user-settings'],
    queryFn: fetchSettings,
    select: (settings) => {
      const n = settings?.notifications ?? {};
      return {
        dm: n['dm_notifications'] ?? true,
        group: n['group_notifications'] ?? true,
        roomMention: n['room_mention_notifications'] ?? true,
      };
    },
  });
  const [local, setLocal] = useState<{ dm: boolean; group: boolean; roomMention: boolean } | null>(null);
  const value = local ?? data ?? { dm: true, group: true, roomMention: true };
  const mut = useMutation({
    mutationFn: (patch: Record<string, boolean>) => apiClient.patch('/users/me/settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-settings'] }),
  });
  const toggle = (k: 'dm' | 'group' | 'roomMention', column: string, v: boolean) => {
    setLocal({ ...value, [k]: v });
    mut.mutate({ [column]: v });
  };
  return (
    <>
      <ToggleRow
        label={t('settings.push.dms')}
        description={t('settings.push.dmsDesc')}
        value={value.dm}
        onChange={(v) => toggle('dm', 'dm_notifications', v)}
      />
      <ToggleRow
        label={t('settings.push.groups')}
        description={t('settings.push.groupsDesc')}
        value={value.group}
        onChange={(v) => toggle('group', 'group_notifications', v)}
      />
      <ToggleRow
        label={t('settings.push.roomMentions')}
        description={t('settings.push.roomMentionsDesc')}
        value={value.roomMention}
        onChange={(v) => toggle('roomMention', 'room_mention_notifications', v)}
      />
    </>
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
// TwoFactorSection
// ---------------------------------------------------------------------------

function TwoFactorSection() {
  const { colors: themeColors, isDark } = useTheme();
  const { t } = useTranslation();

  // FIX-35: Use React Query to fetch 2FA status (caches result, avoids duplicate fetches)
  const { data: meData, isLoading: loadingStatus } = useQuery({
    queryKey: ['user-me-totp'],
    queryFn: async () => {
      const res = await apiClient.get<{ user?: { totp_enabled?: boolean } }>('/users/me');
      return res.data;
    },
    staleTime: 60_000,
  });
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  // Sync totpEnabled from query data when available, unless locally overridden
  React.useEffect(() => {
    if (meData?.user?.totp_enabled !== undefined) {
      setTotpEnabled(meData.user.totp_enabled ?? false);
    }
  }, [meData]);
  const totpStatus = totpEnabled ?? meData?.user?.totp_enabled ?? false;

  // Setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupQrUrl, setSetupQrUrl] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  // Disable modal
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);


  const handleOpenSetup = async () => {
    setSetupCode('');
    setSetupSecret(null);
    setSetupQrUrl(null);
    setShowSetupModal(true);
    try {
      const res = await apiClient.get<{ secret: string; qrCodeUrl: string }>('/auth/2fa/setup');
      setSetupSecret(res.data.secret);
      setSetupQrUrl(res.data.qrCodeUrl);
    } catch {
      Alert.alert('Error', 'Failed to start 2FA setup. Please try again.');
      setShowSetupModal(false);
    }
  };

  const handleConfirmSetup = async () => {
    if (!setupCode.trim()) return;
    setSetupLoading(true);
    try {
      await apiClient.post('/auth/2fa/setup', { code: setupCode.trim() });
      setTotpEnabled(true);
      setShowSetupModal(false);
      Alert.alert('Success', 'Two-factor authentication has been enabled.');
    } catch (e) {
      const axiosErr = e as import('axios').AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Invalid code. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleOpenDisable = () => {
    Alert.alert(
      'Disable 2FA',
      'Are you sure you want to disable two-factor authentication? Your account will be less secure.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setDisableCode('');
            setShowDisableModal(true);
          },
        },
      ],
    );
  };

  const handleConfirmDisable = async () => {
    if (!disableCode.trim()) return;
    setDisableLoading(true);
    try {
      await apiClient.post('/auth/2fa/disable', { code: disableCode.trim() });
      setTotpEnabled(false);
      setShowDisableModal(false);
      Alert.alert('Disabled', 'Two-factor authentication has been disabled.');
    } catch (e) {
      const axiosErr = e as import('axios').AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Invalid code. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    } finally {
      setDisableLoading(false);
    }
  };

  const amberBox = {
    backgroundColor: isDark ? 'rgba(180,120,0,0.15)' : '#fffbeb',
    borderColor: isDark ? '#92400e' : '#f59e0b',
  };

  return (
    <>
      <SectionHeader title="TWO-FACTOR AUTHENTICATION" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        {/* Status row */}
        <View style={[styles.settingsRow, { borderBottomColor: themeColors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>
              {loadingStatus ? 'Loading…' : totpStatus ? '2FA Enabled' : '2FA Disabled'}
            </Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              {totpStatus
                ? 'Your account is protected with an authenticator app.'
                : 'Add an extra layer of security to your account.'}
            </Text>
          </View>
        </View>

        {/* Strongly recommended notice */}
        {!totpStatus && !loadingStatus && (
          <View style={[styles.amberNotice, amberBox]}>
            <Text style={[styles.amberNoticeText, { color: isDark ? '#fbbf24' : '#92400e' }]}>
              Strongly recommended — protects your account even if your password is compromised.
            </Text>
          </View>
        )}

        {/* Action button */}
        {!loadingStatus && (
          <View style={{ padding: 12 }}>
            {totpStatus ? (
              <Button
                label="Disable 2FA"
                variant="danger"
                onPress={handleOpenDisable}
              />
            ) : (
              <Button
                label="Enable 2FA"
                variant="secondary"
                onPress={handleOpenSetup}
              />
            )}
          </View>
        )}
      </View>

      {/* Setup Modal */}
      <Modal
        visible={showSetupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: themeColors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Enable 2FA</Text>
            <Pressable onPress={() => setShowSetupModal(false)} hitSlop={12}>
              <Text style={[styles.modalClose, { color: themeColors.textMuted }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ gap: 16 }}>
            <Text style={[styles.modalInstruction, { color: themeColors.text }]}>
              Open Google Authenticator or Authy and scan the QR code below, or manually enter the setup key.
            </Text>

            {setupSecret ? (
              <View style={[styles.secretBox, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], borderColor: themeColors.border }]}>
                <Text style={[styles.secretLabel, { color: themeColors.textMuted }]}>
                  Setup Key (manually enter in your authenticator app):
                </Text>
                <Text
                  style={[styles.secretText, { color: themeColors.text }]}
                  selectable
                >
                  {setupSecret}
                </Text>
                {setupQrUrl && (
                  <View style={{ alignItems: 'center', marginTop: 12, padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                    <QRCode value={setupQrUrl} size={180} />
                  </View>
                )}
              </View>
            ) : (
              <View style={[styles.secretBox, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], borderColor: themeColors.border }]}>
                <Text style={[styles.secretLabel, { color: themeColors.textMuted }]}>
                  Loading setup key…
                </Text>
              </View>
            )}

            <Text style={[styles.modalInstruction, { color: themeColors.text }]}>
              After adding the account to your authenticator app, enter the 6-digit code it shows:
            </Text>

            <TextInput
              style={[
                styles.codeInput,
                {
                  backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                  color: themeColors.text,
                  borderColor: themeColors.border,
                },
              ]}
              placeholder="000000"
              placeholderTextColor={themeColors.textMuted}
              value={setupCode}
              onChangeText={setSetupCode}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
            />

            <Button
              label={setupLoading ? 'Verifying…' : 'Verify & Enable'}
              variant="primary"
              onPress={handleConfirmSetup}
              disabled={setupLoading || setupCode.length !== 6}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Disable Modal */}
      <Modal
        visible={showDisableModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDisableModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: themeColors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Disable 2FA</Text>
            <Pressable onPress={() => setShowDisableModal(false)} hitSlop={12}>
              <Text style={[styles.modalClose, { color: themeColors.textMuted }]}>✕</Text>
            </Pressable>
          </View>

          <View style={[styles.modalBody, { gap: 16 }]}>
            <Text style={[styles.modalInstruction, { color: themeColors.text }]}>
              Enter the 6-digit code from your authenticator app to confirm you want to disable 2FA.
            </Text>

            <TextInput
              style={[
                styles.codeInput,
                {
                  backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                  color: themeColors.text,
                  borderColor: themeColors.border,
                },
              ]}
              placeholder="000000"
              placeholderTextColor={themeColors.textMuted}
              value={disableCode}
              onChangeText={setDisableCode}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              autoFocus
            />

            <Button
              label={disableLoading ? 'Disabling…' : 'Confirm Disable'}
              variant="danger"
              onPress={handleConfirmDisable}
              disabled={disableLoading || disableCode.length !== 6}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// PrivacyDataSection
// ---------------------------------------------------------------------------

function PrivacyDataSection() {
  const { colors: themeColors } = useTheme();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get('/users/me/export');
      const json = JSON.stringify(res.data, null, 2);
      // BUG-UX-05 FIX: write export to a temp file and share it as a proper
      // .json attachment instead of pasting raw JSON as a text message.
      const baseDir = cacheDirectory ?? documentDirectory;
      if (!baseDir) {
        Alert.alert('Error', 'Export not available — storage not ready. Please try again.');
        return;
      }
      const path = baseDir + 'zobia-export.json';
      await writeAsStringAsync(path, json, { encoding: EncodingType.UTF8 });
      await Share.share({ url: path, title: 'Zobia Data Export' });
    } catch {
      Alert.alert('Error', 'Could not export your data. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SectionHeader title="PRIVACY & DATA" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <View style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Export My Data</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              Download a copy of all your Zobia account data
            </Text>
          </View>
        </View>
        <View style={{ padding: 12, paddingTop: 0 }}>
          <Button
            label={exporting ? 'Requesting…' : 'Export My Data'}
            variant="secondary"
            onPress={handleExport}
            disabled={exporting}
          />
        </View>
      </View>
    </>
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { colors: themeColors, isDark, setUserTheme } = useTheme();
  const { signOut } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['user-settings'],
    queryFn: fetchSettings,
  });

  const { data: manifestFeatures } = useQuery({
    queryKey: ['manifest', 'features'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ features: { pidginAutocomplete: boolean } }>('/manifest');
      return data?.features ?? { pidginAutocomplete: false };
    },
    staleTime: 5 * 60_000,
  });

  const { data: featureFlags } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ twoFaEnabled: boolean; pinEnabled: boolean }>('/features');
      return data ?? { twoFaEnabled: true, pinEnabled: true };
    },
    staleTime: 5 * 60_000,
  });

  const [settings, setSettings] = useState<Partial<UserSettings>>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePin, setDeletePin] = useState('');
  const [deletePending, setDeletePending] = useState(false);

  // Date of birth — fetched via React Query (shares cache with TwoFactorSection's 'user-me-totp' query)
  const { data: meData } = useQuery({
    queryKey: ['user-me-totp'],
    queryFn: async () => {
      const res = await apiClient.get<{ user?: { totp_enabled?: boolean; date_of_birth?: string | null } }>('/users/me');
      return res.data;
    },
    staleTime: 60_000,
  });
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobSaving, setDobSaving] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);

  useEffect(() => {
    const dob = meData?.user?.date_of_birth;
    if (dob) setDateOfBirth(dob);
  }, [meData]);

  async function saveDateOfBirth() {
    if (!dateOfBirth.trim()) { setDobError('Please enter a date of birth.'); return; }
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(dateOfBirth.trim())) { setDobError('Please use YYYY-MM-DD format (e.g. 1995-06-15).'); return; }
    const parsedDob = new Date(dateOfBirth.trim());
    if (isNaN(parsedDob.getTime()) || parsedDob.toISOString().slice(0, 10) !== dateOfBirth.trim()) {
      setDobError(t('settings.invalidDate', 'Invalid date. Please check the day and month values.'));
      return;
    }
    setDobError(null);
    setDobSaving(true);
    try {
      await apiClient.put('/users/me', { date_of_birth: dateOfBirth.trim() });
      Alert.alert('Saved', 'Date of birth updated.');
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Could not save date of birth. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    } finally {
      setDobSaving(false);
    }
  }

  const defaultNotifications: Record<string, boolean> = {
    new_message: true,
    friend_request: true,
    gift_received: true,
    rank_up: true,
    war_start: true,
    season_end: true,
    announcement: true,
  };

  const mergedNotifications: Record<string, boolean> = {
    ...defaultNotifications,
    ...(data?.notifications ?? {}),
    ...(settings.notifications ?? {}),
  };

  const merged: UserSettings = {
    displayName: '',
    bio: '',
    email: '',
    language: 'en',
    theme: 'system',
    privacyDMOptOut: false,
    hdSendEnabled: false,
    ...data,
    ...settings,
    notifications: mergedNotifications,
    pidginSuggestionsEnabled: data?.pidginSuggestionsEnabled ?? settings?.pidginSuggestionsEnabled ?? null,
  };

  const patchMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-settings'] }),
    onError: (err: Error) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message;
      Alert.alert(t('common.error'), translateApiError(t, code, message));
    },
  });

  const set = (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => {
    const patch = { [key]: value } as Partial<UserSettings>;
    setSettings((prev) => ({ ...prev, ...patch }));
    patchMutation.mutate(patch);
  };

  // Updates local state only — use onEndEditing to fire the mutation.
  const setLocalField = (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logoutUser().catch(() => {});
          await signOut();
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
            setDeletePin('');
            setShowDeleteModal(true);
          },
        },
      ],
    );
  };

  const handleConfirmDelete = async () => {
    if (!deletePin.trim()) return;
    setDeletePending(true);
    try {
      await deleteAccount(deletePin.trim());
      setShowDeleteModal(false);
      await signOut();
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Could not delete account. Check your PIN.';
      Alert.alert('Error', translateApiError(t, code, message));
    } finally {
      setDeletePending(false);
    }
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
          onChangeText={(v) => setLocalField('displayName', v)}
          maxLength={40}
          returnKeyType="done"
          onEndEditing={() => patchMutation.mutate({ displayName: merged.displayName })}
        />
        <TextInput
          style={[styles.field, styles.fieldMulti, fieldStyle, { borderBottomColor: themeColors.border }]}
          placeholder="Bio (optional)"
          placeholderTextColor={themeColors.textMuted}
          value={merged.bio}
          onChangeText={(v) => setLocalField('bio', v)}
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
          onChangeText={(v) => setLocalField('email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="done"
          onEndEditing={() => patchMutation.mutate({ email: merged.email })}
        />
        {/* Date of birth */}
        <View style={[styles.dobRow, { borderBottomColor: themeColors.border }]}>
          <Text style={[styles.dobLabel, { color: themeColors.textMuted }]}>
            Date of Birth
          </Text>
          <View style={styles.dobInputRow}>
            <TextInput
              style={[styles.dobInput, {
                backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                color: themeColors.text,
                borderColor: dobError ? colors.semantic.error : themeColors.border,
              }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={themeColors.textMuted}
              value={dateOfBirth}
              onChangeText={(v) => { setDateOfBirth(v); if (dobError) setDobError(null); }}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              returnKeyType="done"
              accessibilityLabel="Date of birth in YYYY-MM-DD format"
            />
            <Pressable
              onPress={saveDateOfBirth}
              disabled={dobSaving}
              style={[styles.dobSaveBtn, { opacity: dobSaving ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Save date of birth"
            >
              <Text style={styles.dobSaveBtnText}>{dobSaving ? '…' : 'Save'}</Text>
            </Pressable>
          </View>
          {dobError
            ? <Text style={[styles.dobHint, { color: colors.semantic.error }]} accessibilityRole="alert">{dobError}</Text>
            : <Text style={[styles.dobHint, { color: themeColors.textMuted }]}>
                Full date of birth. Only your birth year was collected during signup.
              </Text>
          }
        </View>

        <Pressable
          style={[styles.settingsRow, { borderBottomColor: themeColors.border }]}
          onPress={() => router.push('/settings/change-password' as never)}
          accessibilityRole="button"
        >
          <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Change Password</Text>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
        {(featureFlags?.pinEnabled ?? true) && (
          <Pressable
            style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
            onPress={() => router.push('/settings/pin')}
            accessibilityRole="button"
          >
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Change PIN</Text>
            <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
          </Pressable>
        )}
      </View>

      {/* Two-Factor Authentication */}
      {(featureFlags?.twoFaEnabled ?? true) && <TwoFactorSection />}

      {/* Privacy & Data */}
      <PrivacyDataSection />

      {/* Language */}
      <SectionHeader title="LANGUAGE" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <View style={styles.languageGrid}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              onPress={() => {
                set('language', lang.code);
                void i18n.changeLanguage(lang.code);
                try { getStorage().set(STORE_KEYS.LANGUAGE_PREF, lang.code); } catch {}
              }}
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
            onPress={() => { set('theme', opt.key); setUserTheme(opt.key); }}
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
        <ChatPushToggles />
        {NOTIFICATION_TYPES.map(({ key, label, description }) => (
          <ToggleRow
            key={key}
            label={label}
            description={description}
            value={merged.notifications[key] ?? true}
            onChange={(v) => {
              const updated = { ...merged.notifications, [key]: v };
              set('notifications', updated);
            }}
          />
        ))}
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

      {/* Messaging */}
      {manifestFeatures?.pidginAutocomplete && (
        <>
          <SectionHeader title="MESSAGING" />
          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <ToggleRow
              label="Pidgin Suggestions"
              description="Show Pidgin word suggestions while typing in chats"
              value={merged.pidginSuggestionsEnabled ?? false}
              onChange={(v) => {
                patchMutation.mutate({ pidginSuggestionsEnabled: v });
                setSettings((prev) => ({ ...prev, pidginSuggestionsEnabled: v }));
              }}
            />
          </View>
        </>
      )}

      {/* Network */}
      <SectionHeader title="NETWORK" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <ToggleRow
          label="HD Send (Wi-Fi only)"
          description="Send higher-quality images when connected to Wi-Fi"
          value={merged.hdSendEnabled}
          onChange={(v) => set('hdSendEnabled', v)}
        />
      </View>

      {/* Appearance */}
      <SectionHeader title="APPEARANCE" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
          onPress={() => router.push('/settings/chat-theme' as never)}
          accessibilityRole="button"
          accessibilityLabel="Chat theme"
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Chat Themes</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              Customise DM bubble colours (Pro/Max)
            </Text>
          </View>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
      </View>

      {/* Subscription */}
      <SectionHeader title="SUBSCRIPTION" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
          onPress={() => router.push('/settings/subscription')}
          accessibilityRole="button"
          accessibilityLabel="Manage subscription plan"
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Plan Management</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              Upgrade or manage your current plan
            </Text>
          </View>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
      </View>

      {/* Business Account */}
      <SectionHeader title="BUSINESS" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
          onPress={() => router.push('/settings/business' as never)}
          accessibilityRole="button"
          accessibilityLabel="Business account"
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Business Account</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              Verified badge, broadcasts, analytics and more
            </Text>
          </View>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
      </View>

      {/* Legal */}
      <SectionHeader title="LEGAL" />
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: themeColors.border }]}
          onPress={() => Linking.openURL(`${env.API_BASE_URL}/terms`)}
          accessibilityRole="link"
          accessibilityLabel="Terms of Service"
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Terms of Service</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              View our terms and conditions
            </Text>
          </View>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
        <Pressable
          style={[styles.settingsRow, { borderBottomColor: 'transparent' }]}
          onPress={() => Linking.openURL(`${env.API_BASE_URL}/privacy`)}
          accessibilityRole="link"
          accessibilityLabel="Privacy Policy"
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: themeColors.text }]}>Privacy Policy</Text>
            <Text style={[styles.toggleDesc, { color: themeColors.textMuted }]}>
              How we collect and use your data
            </Text>
          </View>
          <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
        </Pressable>
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

      {/* Delete Account Modal — replaces Alert.prompt() (iOS-only) */}
      <Modal
        visible={showDeleteModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: themeColors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Confirm Deletion</Text>
            <Pressable onPress={() => setShowDeleteModal(false)} hitSlop={12}>
              <Text style={[styles.modalClose, { color: themeColors.textMuted }]}>✕</Text>
            </Pressable>
          </View>
          <View style={[styles.modalBody, { gap: 16 }]}>
            <Text style={[styles.modalInstruction, { color: themeColors.text }]}>
              Enter your 4-digit PIN to permanently delete your account. This cannot be undone.
            </Text>
            <TextInput
              style={[
                styles.codeInput,
                {
                  backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                  color: themeColors.text,
                  borderColor: themeColors.border,
                },
              ]}
              placeholder="PIN"
              placeholderTextColor={themeColors.textMuted}
              value={deletePin}
              onChangeText={setDeletePin}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              returnKeyType="done"
              autoFocus
            />
            <Button
              label={deletePending ? 'Deleting…' : 'Delete My Account'}
              variant="danger"
              onPress={handleConfirmDelete}
              disabled={deletePending || !deletePin.trim()}
            />
          </View>
        </View>
      </Modal>
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

  dobRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  dobLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dobInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dobInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
  },
  dobSaveBtn: {
    borderRadius: 10,
    backgroundColor: colors.brand.blue,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  dobSaveBtnText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '600',
  },
  dobHint: {
    fontSize: 11,
    lineHeight: 16,
  },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 52, borderRadius: 10, backgroundColor: colors.neutral[200] },

  // 2FA styles
  amberNotice: {
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  amberNoticeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },

  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalClose: {
    fontSize: 18,
    fontWeight: '400',
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  modalInstruction: {
    fontSize: 14,
    lineHeight: 20,
  },
  secretBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  secretLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  secretText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  qrUrlText: {
    fontSize: 11,
    lineHeight: 16,
  },
  codeInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 8,
    textAlign: 'center',
    minHeight: 56,
  },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
