/**
 * Change Password Screen
 *
 * Allows authenticated users to update their account password by providing
 * their current password and a new password (confirmed twice).
 *
 * Route: /settings/change-password
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await apiClient.post('/auth/change-password', params);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      Alert.alert(
        t('common.success', 'Success'),
        t('settings.changePasswordSuccess'),
        [{ text: t('common.ok', 'OK'), onPress: () => router.back() }]
      );
    },
    onError: (err: AxiosError<{ error?: { code?: string; message?: string }; message?: string }>) => {
      const code = err.response?.data?.error?.code ?? null;
      const message = err.response?.data?.error?.message ?? err.response?.data?.message ?? t('errors.default', 'Something went wrong. Please try again.');
      setFieldError(translateApiError(t, code, message));
    },
  });

  const handleSubmit = () => {
    setFieldError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setFieldError(t('validation.allFieldsRequired', 'All fields are required.'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError(t('validation.passwordMatch'));
      return;
    }
    if (newPassword.length < 8) {
      setFieldError(t('validation.passwordMinLength', 'New password must be at least 8 characters.'));
      return;
    }
    mutation.mutate({ currentPassword, newPassword });
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: themeColors.surface,
      color: themeColors.text,
      borderColor: themeColors.border,
    },
  ];

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← {t('common.back', 'Back')}</Text>
        </Pressable>
        <Text style={[styles.title, { color: themeColors.text }]}>
          {t('settings.changePassword')}
        </Text>
      </View>

      <View style={styles.container}>
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>
          {t('settings.currentPassword')}
        </Text>
        <TextInput
          style={inputStyle}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          placeholderTextColor={themeColors.textSecondary}
          placeholder={t('settings.currentPassword')}
        />

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>
          {t('settings.newPassword')}
        </Text>
        <TextInput
          style={inputStyle}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          placeholderTextColor={themeColors.textSecondary}
          placeholder={t('settings.newPassword')}
        />

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>
          {t('settings.confirmNewPassword')}
        </Text>
        <TextInput
          style={inputStyle}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          placeholderTextColor={themeColors.textSecondary}
          placeholder={t('settings.confirmNewPassword')}
        />

        {fieldError ? (
          <Text style={styles.errorText}>{fieldError}</Text>
        ) : null}

        {mutation.isPending ? (
          <ActivityIndicator color={colors.brand.blue} style={styles.loader} />
        ) : (
          <Button
            title={t('settings.changePasswordButton')}
            onPress={handleSubmit}
            style={styles.button}
          />
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
  backBtn: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 16,
    color: colors.brand.blue,
    fontWeight: '500',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  container: {
    padding: 20,
    paddingTop: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  errorText: {
    color: colors.semantic.error,
    fontSize: 13,
    marginTop: 10,
  },
  loader: {
    marginTop: 24,
  },
  button: {
    marginTop: 24,
  },
});
