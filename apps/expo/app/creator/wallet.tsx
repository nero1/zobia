/**
 * Creator USDT/Tron wallet address screen (global creators).
 *
 * Lets creators add, update, or remove their Tron wallet address for
 * receiving USDT crypto payouts (processed manually by admin).
 *
 * Prominent warning about the irreversibility of incorrect addresses.
 *
 * Route: /creator/wallet
 */

import React, { useState, useEffect } from 'react';
import {
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
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletData {
  hasWallet: boolean;
  addressMasked?: string;
  network?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function WalletScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [pinOrCode, setPinOrCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [showPinEncouragement, setShowPinEncouragement] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePin, setDeletePin] = useState('');

  const bg = isDark ? colors.neutral[900] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const cardBorder = isDark ? colors.neutral[700] : colors.neutral[200];
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const inputBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const inputBorder = isDark ? colors.neutral[600] : colors.neutral[300];

  useEffect(() => {
    apiClient
      .get<WalletData>('/creator/wallet-address')
      .then((res) => setWallet(res.data))
      .catch(() => setWallet({ hasWallet: false }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!confirmed) {
      setError('Please confirm you have read and understood the warning.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiClient.post<{
        addressMasked: string;
        showPinModal?: boolean;
      }>('/creator/wallet-address', {
        address,
        pinOrCode: pinOrCode || undefined,
      });
      setWallet({
        hasWallet: true,
        addressMasked: res.data.addressMasked,
        network: 'tron',
        currency: 'USDT',
      });
      setEditing(false);
      setAddress('');
      setPinOrCode('');
      setConfirmed(false);
      if (res.data.showPinModal) setShowPinEncouragement(true);
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const msg = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Failed to save wallet address.';
      setError(translateApiError(t, code, msg));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await apiClient.delete('/creator/wallet-address', {
        data: { pinOrCode: deletePin || undefined },
      });
      setWallet({ hasWallet: false });
      setShowDeleteModal(false);
      setDeletePin('');
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const msg = axiosErr.response?.data?.error?.message ?? axiosErr.message ?? 'Failed to remove wallet.';
      setError(translateApiError(t, code, msg));
    } finally {
      setSubmitting(false);
    }
  }

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
          USDT Wallet Address
        </Text>
        <Text style={[styles.pageSubtitle, { color: mutedColor }]}>
          Add your Tron (TRC20) wallet address to receive USDT crypto payouts. Payouts are processed manually by our team.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: mutedColor }]}>Loading…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.scrollContent, { backgroundColor: bg }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Critical warning */}
            <View style={styles.warningCard}>
              <View style={styles.warningInner}>
                <Text style={styles.warningIcon}>⚠️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Important — Read Before Proceeding</Text>
                  <Text style={styles.warningBody}>
                    This <Text style={{ fontWeight: '700' }}>must be a Tron (TRC20) network</Text> wallet address that can receive USDT. If you enter an incorrect address, or an address from a different network,{' '}
                    <Text style={{ fontWeight: '700' }}>funds sent to it will be permanently lost and cannot be recovered or resent</Text>. You bear full responsibility for the accuracy of this address.
                  </Text>
                </View>
              </View>
            </View>

            {/* Current wallet display */}
            {wallet?.hasWallet && !editing && (
              <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                <Text style={[styles.cardLabel, { color: mutedColor }]}>Current Wallet</Text>
                <Text style={[styles.walletAddress, { color: textColor }]}>
                  {wallet.addressMasked}
                </Text>
                <Text style={[styles.walletMeta, { color: mutedColor }]}>
                  {wallet.network?.toUpperCase()} — {wallet.currency}
                </Text>
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => setEditing(true)}
                    style={styles.textBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Update wallet address"
                  >
                    <Text style={[styles.textBtnLabel, { color: colors.brand.blue }]}>
                      Update address
                    </Text>
                  </Pressable>
                  <Text style={[styles.separator, { color: mutedColor }]}>|</Text>
                  <Pressable
                    onPress={() => setShowDeleteModal(true)}
                    style={styles.textBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Remove wallet address"
                  >
                    <Text style={[styles.textBtnLabel, { color: colors.semantic.error }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Form */}
            {(!wallet?.hasWallet || editing) && (
              <>
                {wallet?.hasWallet && editing && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: textColor }]}>PIN / Password</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor }]}
                      value={pinOrCode}
                      onChangeText={setPinOrCode}
                      placeholder="Required to update wallet"
                      placeholderTextColor={mutedColor}
                      secureTextEntry
                    />
                  </View>
                )}

                <View style={styles.field}>
                  <Text style={[styles.label, { color: textColor }]}>Tron (TRC20) USDT Wallet Address</Text>
                  <TextInput
                    style={[styles.input, styles.monoInput, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor }]}
                    value={address}
                    onChangeText={(v) => setAddress(v.trim())}
                    placeholder="T…"
                    placeholderTextColor={mutedColor}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={34}
                  />
                  <Text style={[styles.hint, { color: mutedColor }]}>
                    Must start with 'T' and be exactly 34 characters.
                  </Text>
                </View>

                {/* Confirmation checkbox replacement — toggle button */}
                <Pressable
                  style={[
                    styles.confirmToggle,
                    { borderColor: confirmed ? colors.brand.blue : inputBorder },
                    confirmed && { backgroundColor: isDark ? '#1e3a5f' : '#eff6ff' },
                  ]}
                  onPress={() => setConfirmed(!confirmed)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: confirmed }}
                  accessibilityLabel="Confirm wallet address accuracy"
                >
                  <View style={[styles.checkbox, confirmed && { backgroundColor: colors.brand.blue, borderColor: colors.brand.blue }]}>
                    {confirmed && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.confirmText, { color: textColor, flex: 1 }]}>
                    I confirm that this is a valid Tron (TRC20) USDT wallet address and I understand that any funds sent to an incorrect address cannot be recovered.
                  </Text>
                </Pressable>

                <View style={styles.btnRow}>
                  <Button
                    label={submitting ? 'Saving…' : 'Save Wallet Address'}
                    size="lg"
                    onPress={handleSave}
                    loading={submitting}
                    style={styles.flex1}
                    accessibilityLabel="Save wallet address"
                  />
                  {editing && (
                    <Button
                      label="Cancel"
                      size="lg"
                      variant="secondary"
                      onPress={() => {
                        setEditing(false);
                        setError(null);
                        setAddress('');
                        setPinOrCode('');
                        setConfirmed(false);
                      }}
                      style={[styles.flex1, { marginLeft: 8 }]}
                      accessibilityLabel="Cancel editing wallet address"
                    />
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Delete modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: isDark ? colors.neutral[900] : colors.neutral[0] }]}>
            <Text style={[styles.overlayTitle, { color: textColor }]}>Remove Wallet Address</Text>
            <Text style={[styles.overlaySub, { color: mutedColor }]}>
              Enter your PIN or password to confirm.
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textColor, marginBottom: 16 }]}
              value={deletePin}
              onChangeText={setDeletePin}
              placeholder="PIN / password"
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
                accessibilityLabel="Confirm remove wallet address"
              />
              <Button
                label="Cancel"
                size="md"
                variant="secondary"
                onPress={() => { setShowDeleteModal(false); setDeletePin(''); setError(null); }}
                style={styles.flex1}
                accessibilityLabel="Cancel removing wallet address"
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
              Set a PIN to protect sensitive actions like updating your payout wallet address.
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
    gap: 14,
    flexGrow: 1,
  },
  warningCard: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
    padding: 14,
  },
  warningInner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  warningIcon: {
    fontSize: 20,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 4,
  },
  warningBody: {
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 18,
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
  walletAddress: {
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  walletMeta: {
    fontSize: 12,
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
  monoInput: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  hint: {
    fontSize: 11,
    marginTop: 2,
  },
  confirmToggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  confirmText: {
    fontSize: 13,
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: 'row',
  },
  flex1: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
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
