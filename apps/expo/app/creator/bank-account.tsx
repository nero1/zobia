/**
 * Creator bank account setup screen (Nigerian creators).
 *
 * Two-step flow:
 *   1. Select bank + enter account number → API resolves account name via Paystack
 *   2. Confirm account name → API creates Paystack transfer recipient
 *
 * Route: /creator/bank-account
 */

import React, { useState, useEffect } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { SUPPORTED_NIGERIAN_BANKS } from '@/lib/payments/supported-banks';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'idle' | 'confirm' | 'success';

interface BankAccountData {
  hasAccount: boolean;
  bankName?: string;
  accountName?: string;
  accountNumberLast4?: string;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function BankAccountScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [account, setAccount] = useState<BankAccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [accountNumber, setAccountNumber] = useState('');
  const [selectedBankCode, setSelectedBankCode] = useState('');
  const [selectedBankName, setSelectedBankName] = useState('');
  const [pinOrCode, setPinOrCode] = useState('');
  const [resolvedAccountName, setResolvedAccountName] = useState('');
  const [resolvedLast4, setResolvedLast4] = useState('');

  // Modal state
  const [bankPickerVisible, setBankPickerVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePin, setDeletePin] = useState('');
  const [showPinEncouragement, setShowPinEncouragement] = useState(false);

  const bg = isDark ? colors.neutral[900] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const cardBorder = isDark ? colors.neutral[700] : colors.neutral[200];
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const inputBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const inputBorder = isDark ? colors.neutral[600] : colors.neutral[300];

  useEffect(() => {
    apiClient
      .get<BankAccountData>('/creator/bank-account')
      .then((res) => setAccount(res.data))
      .catch(() => setAccount({ hasAccount: false }))
      .finally(() => setLoading(false));
  }, []);

  function reset() {
    setStep('idle');
    setAccountNumber('');
    setSelectedBankCode('');
    setSelectedBankName('');
    setPinOrCode('');
    setResolvedAccountName('');
    setResolvedLast4('');
    setError(null);
  }

  async function handleResolve() {
    setError(null);
    if (!/^\d{10}$/.test(accountNumber)) {
      setError('Account number must be exactly 10 digits.');
      return;
    }
    if (!selectedBankCode) {
      setError('Please select a bank.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.post<{
        requiresConfirmation: boolean;
        accountName: string;
        bankName: string;
        accountNumberLast4: string;
      }>('/creator/bank-account', {
        accountNumber,
        bankCode: selectedBankCode,
        bankName: selectedBankName,
        confirmed: false,
        ...(account?.hasAccount ? { pinOrCode } : {}),
      });
      setResolvedAccountName(res.data.accountName);
      setResolvedLast4(res.data.accountNumberLast4);
      setStep('confirm');
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const msg = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Failed to verify account.';
      setError(translateApiError(t, code, msg));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ success: boolean; showPinModal?: boolean }>(
        '/creator/bank-account',
        {
          accountNumber,
          bankCode: selectedBankCode,
          bankName: selectedBankName,
          confirmed: true,
          accountName: resolvedAccountName,
          pinOrCode: pinOrCode || undefined,
        }
      );
      setAccount({
        hasAccount: true,
        bankName: selectedBankName,
        accountName: resolvedAccountName,
        accountNumberLast4: resolvedLast4,
      });
      setStep('success');
      if (res.data.showPinModal) setShowPinEncouragement(true);
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const msg = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Failed to save account.';
      setError(translateApiError(t, code, msg));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await apiClient.delete('/creator/bank-account', {
        data: { pinOrCode: deletePin || undefined },
      });
      setAccount({ hasAccount: false });
      setDeleteModalVisible(false);
      setDeletePin('');
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const msg = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Failed to remove account.';
      Alert.alert('Error', translateApiError(t, code, msg));
    } finally {
      setSubmitting(false);
    }
  }

  const renderIdle = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { backgroundColor: bg }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current account */}
        {account?.hasAccount && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.cardLabel, { color: mutedColor }]}>Current Account</Text>
            <Text style={[styles.accountName, { color: textColor }]}>{account.accountName}</Text>
            <Text style={[styles.accountSub, { color: mutedColor }]}>
              {account.bankName} ····{account.accountNumberLast4}
            </Text>
            <View style={styles.cardActions}>
              <Pressable
                onPress={() => reset()}
                accessibilityRole="button"
                accessibilityLabel="Update bank account"
                style={styles.textBtn}
              >
                <Text style={[styles.textBtnLabel, { color: colors.brand.blue }]}>
                  Update account
                </Text>
              </Pressable>
              <Text style={[styles.separator, { color: mutedColor }]}>|</Text>
              <Pressable
                onPress={() => setDeleteModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Remove bank account"
                style={styles.textBtn}
              >
                <Text style={[styles.textBtnLabel, { color: colors.semantic.error }]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: isDark ? '#451a0320' : '#fffbeb', borderColor: isDark ? '#78350f' : '#fcd34d' }]}>
          <Text style={[styles.infoBannerText, { color: isDark ? '#fbbf24' : '#92400e' }]}>
            <Text style={{ fontWeight: '700' }}>Note: </Text>
            Bank account details are locked at the time you submit a withdrawal request. Updating your account will not affect in-progress payouts.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* PIN field when editing existing */}
        {account?.hasAccount && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: textColor }]}>PIN / Authenticator Code / Password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor }]}
              value={pinOrCode}
              onChangeText={setPinOrCode}
              placeholder="Required to update account"
              placeholderTextColor={mutedColor}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
        )}

        {/* Bank selector */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: textColor }]}>Bank</Text>
          <Pressable
            style={[styles.input, styles.selectInput, { backgroundColor: inputBg, borderColor: inputBorder }]}
            onPress={() => setBankPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Select bank"
          >
            <Text style={[{ color: selectedBankName ? textColor : mutedColor }]}>
              {selectedBankName || 'Select bank…'}
            </Text>
            <Text style={{ color: mutedColor }}>▾</Text>
          </Pressable>
        </View>

        {/* Account number */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: textColor }]}>Account Number</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor }]}
            value={accountNumber}
            onChangeText={(v) => setAccountNumber(v.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit account number"
            placeholderTextColor={mutedColor}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>

        <Button
          label={submitting ? 'Verifying…' : 'Verify Account'}
          size="lg"
          onPress={handleResolve}
          loading={submitting}
          style={{ marginTop: 8 }}
          accessibilityLabel="Verify bank account"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderConfirm = () => (
    <View style={[styles.scrollContent, { backgroundColor: bg }]}>
      <View style={[styles.confirmCard, { backgroundColor: isDark ? '#1e3a5f' : '#eff6ff', borderColor: isDark ? '#1d4ed8' : '#bfdbfe' }]}>
        <Text style={[styles.confirmQuestion, { color: mutedColor }]}>Are these details correct?</Text>
        <Text style={[styles.confirmName, { color: textColor }]}>{resolvedAccountName}</Text>
        <Text style={[styles.confirmSub, { color: mutedColor }]}>
          {selectedBankName} ····{resolvedLast4}
        </Text>
      </View>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Button
          label={submitting ? 'Saving…' : 'Yes, Save'}
          size="lg"
          onPress={handleConfirm}
          loading={submitting}
          style={[styles.flex1, { marginRight: 8 }]}
          accessibilityLabel="Confirm and save bank account"
        />
        <Button
          label="No, Edit"
          size="lg"
          variant="secondary"
          onPress={reset}
          disabled={submitting}
          style={styles.flex1}
          accessibilityLabel="Go back and edit bank account details"
        />
      </View>
    </View>
  );

  const renderSuccess = () => (
    <View style={[styles.successContainer, { backgroundColor: bg }]}>
      <Text style={styles.successEmoji}>✅</Text>
      <Text style={[styles.successTitle, { color: textColor }]}>Account Saved</Text>
      <Text style={[styles.successSub, { color: mutedColor }]}>
        Your bank account has been verified and saved. Payouts will be sent to this account.
      </Text>
      <Button
        label="Done"
        size="lg"
        onPress={reset}
        style={{ marginTop: 16, width: '100%' }}
        accessibilityLabel="Done"
      />
    </View>
  );

  return (
    <Screen scrollable={false} disableBottomInset>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: bg }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backText, { color: colors.brand.blue }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.pageTitle, { color: isDark ? colors.neutral[50] : colors.neutral[900] }]}>
          Bank Account
        </Text>
        <Text style={[styles.pageSubtitle, { color: mutedColor }]}>
          Add your Nigerian bank account to receive payout transfers via Paystack.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: mutedColor }]}>Loading…</Text>
        </View>
      ) : step === 'idle' ? (
        renderIdle()
      ) : step === 'confirm' ? (
        renderConfirm()
      ) : (
        renderSuccess()
      )}

      {/* Bank picker modal */}
      <Modal
        visible={bankPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setBankPickerVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: isDark ? colors.neutral[900] : colors.neutral[0] }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Select Bank</Text>
            <Pressable
              onPress={() => setBankPickerVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close bank picker"
            >
              <Text style={{ color: colors.brand.blue, fontSize: 16 }}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={SUPPORTED_NIGERIAN_BANKS}
            keyExtractor={(b) => b.code}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.bankOption,
                  { borderBottomColor: cardBorder },
                  selectedBankCode === item.code && { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[100] },
                ]}
                onPress={() => {
                  setSelectedBankCode(item.code);
                  setSelectedBankName(item.name);
                  setBankPickerVisible(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.name}`}
              >
                <Text style={[styles.bankOptionText, { color: textColor }]}>{item.name}</Text>
                {selectedBankCode === item.code && (
                  <Text style={{ color: colors.brand.blue }}>✓</Text>
                )}
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: isDark ? colors.neutral[900] : colors.neutral[0] }]}>
            <Text style={[styles.overlayTitle, { color: textColor }]}>Remove Bank Account</Text>
            <Text style={[styles.overlaySub, { color: mutedColor }]}>
              Enter your PIN, authenticator code, or password to confirm removal.
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor, marginBottom: 16 }]}
              value={deletePin}
              onChangeText={setDeletePin}
              placeholder="PIN / code / password"
              placeholderTextColor={mutedColor}
              secureTextEntry
            />
            <View style={styles.row}>
              <Button
                label={submitting ? 'Removing…' : 'Remove'}
                size="md"
                onPress={handleDelete}
                loading={submitting}
                style={[styles.flex1, { marginRight: 8, backgroundColor: colors.semantic.error }]}
                accessibilityLabel="Confirm remove bank account"
              />
              <Button
                label="Cancel"
                size="md"
                variant="secondary"
                onPress={() => { setDeleteModalVisible(false); setDeletePin(''); }}
                style={styles.flex1}
                accessibilityLabel="Cancel removing bank account"
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* PIN encouragement modal */}
      <Modal
        visible={showPinEncouragement}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPinEncouragement(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: isDark ? colors.neutral[900] : colors.neutral[0] }]}>
            <Text style={styles.overlayEmoji}>🔐</Text>
            <Text style={[styles.overlayTitle, { color: textColor }]}>Protect Your Account</Text>
            <Text style={[styles.overlaySub, { color: mutedColor }]}>
              We recommend setting a PIN to protect sensitive actions like changing your bank account or requesting payouts.
            </Text>
            <View style={styles.row}>
              <Button
                label="Set PIN"
                size="md"
                onPress={() => { setShowPinEncouragement(false); router.push('/settings/pin' as never); }}
                style={[styles.flex1, { marginRight: 8 }]}
                accessibilityLabel="Go to PIN setup"
              />
              <Button
                label="Later"
                size="md"
                variant="secondary"
                onPress={() => setShowPinEncouragement(false)}
                style={styles.flex1}
                accessibilityLabel="Dismiss PIN encouragement"
              />
            </View>
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  backBtn: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  pageSubtitle: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    flexGrow: 1,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  accountName: {
    fontSize: 17,
    fontWeight: '700',
  },
  accountSub: {
    fontSize: 13,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  textBtn: {
    minHeight: 36,
    justifyContent: 'center',
  },
  textBtnLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  separator: {
    fontSize: 14,
  },
  infoBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  infoBannerText: {
    fontSize: 12,
    lineHeight: 17,
  },
  errorBanner: {
    borderRadius: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: colors.semantic.error,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 48,
  },
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confirmCard: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 20,
    gap: 6,
    marginBottom: 16,
  },
  confirmQuestion: {
    fontSize: 13,
  },
  confirmName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  confirmSub: {
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
  },
  flex1: {
    flex: 1,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  successEmoji: {
    fontSize: 52,
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  successSub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Modals
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  bankOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  bankOptionText: {
    fontSize: 15,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  overlayEmoji: {
    fontSize: 36,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  overlaySub: {
    fontSize: 14,
    lineHeight: 20,
  },
});
