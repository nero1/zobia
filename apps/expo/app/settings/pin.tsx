/**
 * PIN Setup / Change Screen
 *
 * Allows users to set up, change, or remove their optional 4-digit PIN
 * which protects login and sensitive operations (payments, payout requests).
 *
 * Route: /settings/pin
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { translateApiError } from '@/lib/i18n/apiErrors';
import { storage } from '@/lib/offline/store';

const PIN_PIN_MAX_ATTEMPTS = 5;
const PIN_PIN_LOCKOUT_MS = 60_000; // 1 minute
const PIN_ATTEMPTS_KEY = 'settings_pin_failed_attempts';
const PIN_LOCKED_UNTIL_KEY = 'settings_pin_locked_until';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchPinStatus(): Promise<{ hasPinSet: boolean }> {
  const { data } = await apiClient.get<{ hasPinSet: boolean }>('/auth/pin/status');
  return data;
}

async function setupPin(params: { pin: string; currentPin?: string }): Promise<void> {
  await apiClient.post('/auth/pin/setup', params);
}

async function removePinApi(params: { pin: string }): Promise<void> {
  await apiClient.delete('/auth/pin/remove', { data: params });
}

// ---------------------------------------------------------------------------
// PIN Dots display
// ---------------------------------------------------------------------------

function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length }).map((_, i) => (
        <View key={i} style={[styles.dot, i < filled && styles.dotFilled]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step type
// ---------------------------------------------------------------------------

type Step = 'enter_current' | 'enter_new' | 'confirm_new' | 'enter_remove';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PinScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  const [step, setStep] = useState<Step>('enter_current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [removePin, setRemovePin] = useState('');
  const [mode, setMode] = useState<'setup' | 'change' | 'remove' | null>(null);

  // BUG-SEC-02 FIX: persist PIN rate-limit state to MMKV so lockouts survive app restarts.

  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    try { return storage.getNumber(PIN_ATTEMPTS_KEY) ?? 0; } catch { return 0; }
  });
  const [lockedUntil, setLockedUntil] = useState<number | null>(() => {
    try { const v = storage.getNumber(PIN_LOCKED_UNTIL_KEY); return v ?? null; } catch { return null; }
  });

  useEffect(() => {
    try { storage.set(PIN_ATTEMPTS_KEY, failedAttempts); } catch {}
  }, [failedAttempts]);

  useEffect(() => {
    try {
      if (lockedUntil === null) storage.delete(PIN_LOCKED_UNTIL_KEY);
      else storage.set(PIN_LOCKED_UNTIL_KEY, lockedUntil);
    } catch {}
  }, [lockedUntil]);

  const inputRef = useRef<TextInput>(null);
  const advancingRef = useRef(false);

  const { data: pinStatus, isLoading } = useQuery({
    queryKey: ['auth', 'pin', 'status'],
    queryFn: fetchPinStatus,
  });

  const hasPinSet = pinStatus?.hasPinSet ?? false;

  useEffect(() => {
    if (!isLoading && pinStatus) {
      if (!hasPinSet) {
        // No PIN set — go directly to create new
        setMode('setup');
        setStep('enter_new');
      } else {
        setMode('change');
        setStep('enter_current');
      }
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isLoading, pinStatus, hasPinSet]);

  const setupMutation = useMutation({
    mutationFn: setupPin,
    onSuccess: () => {
      advancingRef.current = false;
      setFailedAttempts(0);
      setLockedUntil(null);
      Alert.alert('Success', hasPinSet ? 'PIN changed successfully.' : 'PIN set successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (err: Error) => {
      advancingRef.current = false;
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message;
      // Track failed attempts and apply client-side lockout
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= PIN_MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        setFailedAttempts(0);
      }
      Alert.alert('Error', translateApiError(t, code, message));
      reset();
    },
  });

  const removeMutation = useMutation({
    mutationFn: removePinApi,
    onSuccess: () => {
      advancingRef.current = false;
      setFailedAttempts(0);
      setLockedUntil(null);
      Alert.alert('Success', 'PIN removed successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (err: Error) => {
      advancingRef.current = false;
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? axiosErr.message;
      // Track failed attempts and apply client-side lockout
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= PIN_MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        setFailedAttempts(0);
      }
      Alert.alert('Error', translateApiError(t, code, message));
      setRemovePin('');
    },
  });

  const reset = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setRemovePin('');
    setStep(hasPinSet ? 'enter_current' : 'enter_new');
  };

  const activeValue =
    step === 'enter_current' ? currentPin :
    step === 'enter_new' ? newPin :
    step === 'confirm_new' ? confirmPin :
    removePin;

  const handleDigit = (digit: string) => {
    const setter =
      step === 'enter_current' ? setCurrentPin :
      step === 'enter_new' ? setNewPin :
      step === 'confirm_new' ? setConfirmPin :
      setRemovePin;

    const current = activeValue;
    if (current.length >= 4) return;
    const next = current + digit;
    setter(next);

    if (next.length === 4) {
      setTimeout(() => advance(next), 150);
    }
  };

  const handleDelete = () => {
    const setter =
      step === 'enter_current' ? setCurrentPin :
      step === 'enter_new' ? setNewPin :
      step === 'confirm_new' ? setConfirmPin :
      setRemovePin;
    setter((v) => v.slice(0, -1));
  };

  const advance = (value: string) => {
    // Client-side lockout check
    if (lockedUntil !== null && Date.now() < lockedUntil) {
      const secsLeft = Math.ceil((lockedUntil - Date.now()) / 1_000);
      Alert.alert('Too many attempts', `Please wait ${secsLeft} seconds before trying again.`);
      return;
    }
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (step === 'enter_current') {
      if (mode === 'remove') {
        removeMutation.mutate({ pin: value });
        // advancingRef reset via mutation callback
        return;
      } else {
        setStep('enter_new');
      }
    } else if (step === 'enter_new') {
      setStep('confirm_new');
    } else if (step === 'confirm_new') {
      if (value !== newPin) {
        Alert.alert('PINs do not match', 'Please try again.');
        setNewPin('');
        setConfirmPin('');
        setStep('enter_new');
        advancingRef.current = false;
        return;
      }
      setupMutation.mutate({
        pin: newPin,
        currentPin: hasPinSet ? currentPin : undefined,
      });
      // advancingRef reset via mutation callback
      return;
    } else if (step === 'enter_remove') {
      removeMutation.mutate({ pin: value });
      // advancingRef reset via mutation callback
      return;
    }
    advancingRef.current = false;
  };

  const headings: Record<Step, string> = {
    enter_current: 'Enter current PIN',
    enter_new: hasPinSet ? 'Enter new PIN' : 'Create a PIN',
    confirm_new: 'Confirm new PIN',
    enter_remove: 'Enter PIN to remove',
  };

  const subtext: Record<Step, string> = {
    enter_current: 'Enter your existing 4-digit PIN',
    enter_new: 'Choose a 4-digit PIN to protect sensitive operations',
    confirm_new: 'Re-enter the same 4-digit PIN',
    enter_remove: 'Enter your PIN to confirm removal',
  };

  const isPending = setupMutation.isPending || removeMutation.isPending;

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.blue} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable={false}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: themeColors.text }]}>PIN Settings</Text>
      </View>

      <View style={styles.body}>
        <Text style={[styles.heading, { color: themeColors.text }]}>{headings[step]}</Text>
        <Text style={[styles.subtext, { color: themeColors.textMuted }]}>{subtext[step]}</Text>

        <PinDots length={4} filled={activeValue.length} />

        {/* Hidden input for keyboard (accessibility) */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
          value={activeValue}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 4);
            const setter =
              step === 'enter_current' ? setCurrentPin :
              step === 'enter_new' ? setNewPin :
              step === 'confirm_new' ? setConfirmPin :
              setRemovePin;
            setter(digits);
            if (digits.length === 4) {
              setTimeout(() => advance(digits), 150);
            }
          }}
        />

        {/* Numpad */}
        <View style={styles.numpad}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [
                styles.numKey,
                key === '' && styles.numKeyEmpty,
                pressed && key !== '' && styles.numKeyPressed,
              ]}
              onPress={() => {
                if (key === '⌫') handleDelete();
                else if (key !== '') handleDigit(key);
              }}
              disabled={key === '' || isPending}
            >
              <Text style={[styles.numKeyText, { color: themeColors.text }]}>{key}</Text>
            </Pressable>
          ))}
        </View>

        {isPending && <ActivityIndicator color={colors.brand.blue} style={{ marginTop: 16 }} />}

        {/* Remove PIN option */}
        {hasPinSet && step === 'enter_current' && (
          <Pressable
            style={styles.removeLink}
            onPress={() => {
              setMode('remove');
              setStep('enter_current');
            }}
          >
            <Text style={styles.removeLinkText}>Remove PIN</Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  backBtn: { padding: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 16, color: colors.brand.blue, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtext: { fontSize: 14, textAlign: 'center', marginBottom: 32 },
  dotsRow: { flexDirection: 'row', gap: 16, marginBottom: 40 },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.neutral[400],
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blue,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  numpad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 240,
    gap: 16,
    justifyContent: 'center',
  },
  numKey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  numKeyEmpty: { backgroundColor: 'transparent' },
  numKeyPressed: { backgroundColor: colors.neutral[200] },
  numKeyText: { fontSize: 22, fontWeight: '500' },
  removeLink: { marginTop: 32 },
  removeLinkText: { fontSize: 14, color: colors.semantic.error, fontWeight: '600' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
