/**
 * SessionExpiredModal
 *
 * App-wide "you've been signed out" notice for the Expo app.
 *
 * Mounted once in the root layout. The auth context flips `sessionExpired` to
 * true whenever a token refresh fails (the API client's 401 interceptor calls
 * `notifyUnauthenticated()`), which happens for a background screen — e.g. a
 * chat room left open while the session lapsed — the moment its next request or
 * the user's next action hits the server. Because the root layout does not
 * auto-navigate on logout, this modal is what surfaces the expiry and routes
 * the user back to sign-in.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/hooks';
import { colors } from '@/lib/theme/colors';

export function SessionExpiredModal() {
  const { t } = useTranslation();
  const { sessionExpired, clearSessionExpired } = useAuth();

  function handleSignIn() {
    // Only clear the flag here — do NOT call router.replace('/auth/login').
    // The auth gate in _layout.tsx already called router.replace('/auth/login')
    // when user became null (triggered by notifyUnauthenticated). Calling
    // replace again from here while already on the login screen is a no-op on
    // some navigators and caused the "nothing happens" bug on Android.
    clearSessionExpired();
  }

  return (
    <Modal
      visible={sessionExpired}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleSignIn}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{t('auth.sessionExpiredTitle')}</Text>
          <Text style={styles.body}>{t('auth.sessionExpiredMessage')}</Text>
          <Pressable
            style={styles.button}
            onPress={handleSignIn}
            accessibilityRole="button"
            accessibilityLabel={t('auth.sessionExpiredSignIn')}
          >
            <Text style={styles.buttonText}>{t('auth.sessionExpiredSignIn')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 18,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[700],
  },
  button: {
    marginTop: 8,
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.neutral[0],
    fontSize: 15,
    fontWeight: '600',
  },
});
