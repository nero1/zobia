/**
 * Change Email Screen
 * Route: /settings/change-email
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { translateApiError } from '@/lib/i18n/apiErrors';

async function requestEmailChange(params: { currentPassword: string; newEmail: string }): Promise<void> {
  await apiClient.post('/auth/change-email', params);
}

export default function ChangeEmailScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: requestEmailChange,
    onSuccess: () => {
      setSuccess(true);
    },
    onError: (err: AxiosError<{ error?: { code?: string; message?: string }; message?: string }>) => {
      const code = err.response?.data?.error?.code ?? null;
      const message = err.response?.data?.error?.message ?? err.response?.data?.message ?? t('errors.default', 'Something went wrong. Please try again.');
      setFieldError(translateApiError(t, code, message));
    },
  });

  const handleSubmit = () => {
    setFieldError(null);
    if (!currentPassword || !newEmail || !confirmEmail) {
      setFieldError(t('validation.allFieldsRequired', 'All fields are required.'));
      return;
    }
    if (newEmail !== confirmEmail) {
      setFieldError(t('validation.emailMatch', 'Email addresses do not match.'));
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(newEmail)) {
      setFieldError(t('validation.invalidEmail', 'Enter a valid email address.'));
      return;
    }
    mutation.mutate({ currentPassword, newEmail });
  };

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← {t('common.back', 'Back')}</Text>
        </Pressable>
        <Text style={[styles.title, { color: themeColors.text }]}>
          {t('settings.changeEmail', 'Change Email')}
        </Text>
      </View>

      <View style={styles.container}>
        {success ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>
              {t('settings.changeEmailSuccess', `A verification link has been sent to ${newEmail}. Click the link to confirm the change.`)}
            </Text>
            <Button label={t('common.back', 'Back')} onPress={() => router.back()} style={styles.button} />
          </View>
        ) : (
          <>
            <Text style={[styles.description, { color: themeColors.textMuted }]}>
              {t('settings.changeEmailDescription', "Enter your current password and new email address. We'll send a verification link to confirm the change.")}
            </Text>

            <Input
              label={t('settings.currentPassword', 'Current Password')}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Input
              label={t('settings.newEmail', 'New Email Address')}
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Input
              label={t('settings.confirmNewEmail', 'Confirm New Email')}
              value={confirmEmail}
              onChangeText={setConfirmEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            {fieldError ? (
              <Text style={styles.errorText}>{fieldError}</Text>
            ) : null}

            {mutation.isPending ? (
              <ActivityIndicator color={colors.brand.blue} style={styles.loader} />
            ) : (
              <Button
                label={t('settings.sendVerification', 'Send Verification Link')}
                onPress={handleSubmit}
                style={styles.button}
              />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: { padding: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 16, color: colors.brand.blue, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '700' },
  container: { padding: 20, paddingTop: 4, gap: 16 },
  description: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  errorText: { color: colors.semantic.error, fontSize: 13, marginTop: 4 },
  loader: { marginTop: 24 },
  button: { marginTop: 8 },
  successBanner: { gap: 16, padding: 8 },
  successText: { fontSize: 15, lineHeight: 22, color: colors.semantic.success ?? colors.brand.green },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
