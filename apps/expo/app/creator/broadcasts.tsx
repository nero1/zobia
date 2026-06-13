/**
 * app/creator/broadcasts.tsx
 *
 * Creator Broadcasts screen (PRD §14).
 *
 * Send broadcast messages to all followers.
 * - Rising tier: 3/month (paid per send at 200 coins)
 * - Verified tier: 3 free/month; 200 coins per additional send
 * - Elite/Icon tier: unlimited free broadcasts
 *
 * Shows monthly allowance, compose sheet, and broadcast history.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BroadcastAllowance {
  tier: string;
  freeRemaining: number;
  freeTotal: number;
  additionalCoinCost: number;
  canSend: boolean;
  reason?: string;
}

interface Broadcast {
  id: string;
  subject: string | null;
  content: string;
  recipientCount: number;
  costCoins: number;
  createdAt: string;
}

interface BroadcastsResponse {
  allowance: BroadcastAllowance;
  broadcasts: Broadcast[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchBroadcasts(): Promise<BroadcastsResponse> {
  const { data } = await apiClient.get('/creator/broadcasts');
  return data;
}

async function sendBroadcast(payload: {
  subject?: string;
  content: string;
  confirmPayment: boolean;
}): Promise<{ broadcast: Broadcast; costCoins: number; requiresConfirmation?: boolean }> {
  const { data } = await apiClient.post('/creator/broadcasts', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Compose modal
// ---------------------------------------------------------------------------

interface ComposeModalProps {
  visible: boolean;
  allowance: BroadcastAllowance;
  onClose: () => void;
  onSend: (subject: string, content: string) => void;
  sending: boolean;
}

function ComposeModal({ visible, allowance, onClose, onSend, sending }: ComposeModalProps) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const { colors: themeColors } = useTheme();

  const handleSend = () => {
    if (!content.trim()) {
      Alert.alert(t('broadcasts.errorTitle'), t('broadcasts.errorEmpty'));
      return;
    }
    onSend(subject.trim(), content.trim());
  };

  const reset = () => {
    setSubject('');
    setContent('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={reset}
    >
      <KeyboardAvoidingView
        style={[styles.composeContainer, { backgroundColor: themeColors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={[styles.composeHeader, { borderBottomColor: themeColors.border }]}>
          <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel={t('broadcasts.composeCancel')}>
            <Text style={[styles.composeCancel, { color: themeColors.textMuted }]}>
              {t('broadcasts.composeCancel')}
            </Text>
          </Pressable>
          <Text style={[styles.composeTitle, { color: themeColors.text }]}>
            {t('broadcasts.composeTitle')}
          </Text>
          <Pressable
            onPress={handleSend}
            disabled={sending || !content.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('broadcasts.composeSend')}
          >
            <Text
              style={[
                styles.composeSend,
                { color: content.trim() && !sending ? colors.brand.blue : themeColors.textMuted },
              ]}
            >
              {sending ? t('broadcasts.composeSending') : t('broadcasts.composeSend')}
            </Text>
          </Pressable>
        </View>

        {/* Allowance banner */}
        <View style={[styles.allowanceBanner, { backgroundColor: themeColors.surface }]}>
          {allowance.freeRemaining > 0 ? (
            <Text style={[styles.allowanceText, { color: themeColors.textMuted }]}>
              {allowance.freeRemaining === 1
                ? t('broadcasts.freeBannerSingle', { count: allowance.freeRemaining })
                : t('broadcasts.freeBannerPlural', { count: allowance.freeRemaining })}
            </Text>
          ) : (
            <Text style={[styles.allowanceText, { color: themeColors.textMuted }]}>
              {t('broadcasts.noFreeLeft', { count: allowance.additionalCoinCost.toLocaleString() })}
            </Text>
          )}
        </View>

        {/* Form */}
        <View style={styles.composeForm}>
          <TextInput
            style={[styles.subjectInput, { color: themeColors.text, borderBottomColor: themeColors.border }]}
            placeholder={t('broadcasts.subjectPlaceholder')}
            placeholderTextColor={themeColors.textMuted}
            value={subject}
            onChangeText={setSubject}
            maxLength={200}
            returnKeyType="next"
          />
          <TextInput
            style={[styles.bodyInput, { color: themeColors.text }]}
            placeholder={t('broadcasts.bodyPlaceholder')}
            placeholderTextColor={themeColors.textMuted}
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={1000}
            autoFocus
          />
          <Text style={[styles.charCount, { color: content.length > 950 ? colors.semantic.error : themeColors.textMuted }]}>
            {t('broadcasts.charCount', { current: content.length })}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Broadcast history row
// ---------------------------------------------------------------------------

function BroadcastRow({ broadcast }: { broadcast: Broadcast }) {
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();
  const date = new Date(broadcast.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={[styles.broadcastRow, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      {broadcast.subject ? (
        <Text style={[styles.broadcastSubject, { color: themeColors.text }]} numberOfLines={1}>
          {broadcast.subject}
        </Text>
      ) : null}
      <Text style={[styles.broadcastContent, { color: themeColors.textMuted }]} numberOfLines={2}>
        {broadcast.content}
      </Text>
      <View style={styles.broadcastMeta}>
        <Text style={[styles.broadcastMetaText, { color: themeColors.textMuted }]}>
          {t('broadcasts.recipientsDate', { count: broadcast.recipientCount.toLocaleString(), date })}
        </Text>
        {broadcast.costCoins > 0 && (
          <Text style={[styles.broadcastCost, { color: themeColors.textMuted }]}>
            {broadcast.costCoins.toLocaleString()} 🪙
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function BroadcastsScreen() {
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['creator-broadcasts'],
    queryFn: fetchBroadcasts,
  });

  const sendMutation = useMutation({
    mutationFn: sendBroadcast,
    onSuccess: (result) => {
      if (result.requiresConfirmation) {
        Alert.alert(
          t('broadcasts.confirmTitle'),
          t('broadcasts.confirmBody', { count: result.costCoins.toLocaleString() }),
          [
            { text: t('broadcasts.confirmCancel'), style: 'cancel' },
            {
              text: t('broadcasts.confirmSend'),
              onPress: () => {
                sendMutation.mutate({ ...pendingPayload!, confirmPayment: true });
              },
            },
          ]
        );
        return;
      }
      setComposing(false);
      setPendingPayload(null);
      queryClient.invalidateQueries({ queryKey: ['creator-broadcasts'] });
      Alert.alert(
        t('broadcasts.sentTitle'),
        t('broadcasts.sentBody', { count: result.broadcast.recipientCount.toLocaleString() })
      );
    },
    onError: (err: Error) => {
      Alert.alert(t('broadcasts.errorTitle'), err.message ?? t('broadcasts.errorFailed'));
    },
  });

  const [pendingPayload, setPendingPayload] = useState<{
    subject?: string;
    content: string;
    confirmPayment: boolean;
  } | null>(null);

  const handleSend = (subject: string, content: string) => {
    const payload = { subject: subject || undefined, content, confirmPayment: false };
    setPendingPayload(payload);
    sendMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.brand.blue} size="large" />
        </View>
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            {t('broadcasts.loadError')}
          </Text>
        </View>
      </Screen>
    );
  }

  const allowance = data?.allowance;
  const broadcasts = data?.broadcasts ?? [];

  return (
    <Screen disableBottomInset>
      {/* Allowance card */}
      {allowance && (
        <View style={[styles.allowanceCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <View style={styles.allowanceRow}>
            <View>
              <Text style={[styles.allowanceCount, { color: themeColors.text }]}>
                {allowance.freeRemaining}
                <Text style={[styles.allowanceTotal, { color: themeColors.textMuted }]}>
                  {t('broadcasts.allowanceFree', { total: allowance.freeTotal })}
                </Text>
              </Text>
              <Text style={[styles.allowanceTier, { color: themeColors.textMuted }]}>
                {t('broadcasts.allowanceTier', { tier: allowance.tier })}
                {allowance.additionalCoinCost > 0
                  ? t('broadcasts.additionalCost', { count: allowance.additionalCoinCost.toLocaleString() })
                  : ''}
              </Text>
            </View>
            {allowance.canSend && (
              <Pressable
                style={[styles.sendBtn, { backgroundColor: colors.brand.blue }]}
                onPress={() => setComposing(true)}
                accessibilityRole="button"
                accessibilityLabel={t('broadcasts.composeTitle')}
              >
                <Text style={styles.sendBtnText}>{t('broadcasts.sendBtnLabel')}</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.progressOuter}>
            <View
              style={[
                styles.progressInner,
                {
                  width: allowance.freeTotal > 0
                    ? `${Math.round((allowance.freeRemaining / allowance.freeTotal) * 100)}%`
                    : '0%',
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* History */}
      <FlatList
        data={broadcasts}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <BroadcastRow broadcast={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📢</Text>
            <Text style={[styles.emptyTitle, { color: themeColors.text }]}>
              {t('broadcasts.emptyTitle')}
            </Text>
            <Text style={[styles.emptyDesc, { color: themeColors.textMuted }]}>
              {t('broadcasts.emptyDesc')}
            </Text>
          </View>
        )}
      />

      {/* Compose modal */}
      {allowance && (
        <ComposeModal
          visible={composing}
          allowance={allowance}
          onClose={() => setComposing(false)}
          onSend={handleSend}
          sending={sendMutation.isPending}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  allowanceCard: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  allowanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  allowanceCount: { fontSize: 28, fontWeight: '800' },
  allowanceTotal: { fontSize: 16, fontWeight: '400' },
  allowanceTier: { fontSize: 12, marginTop: 2 },
  progressOuter: { height: 6, borderRadius: 3, backgroundColor: colors.neutral[200], overflow: 'hidden' },
  progressInner: { height: 6, borderRadius: 3, backgroundColor: colors.brand.blue },

  sendBtn: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  listContent: { padding: 16, gap: 10, paddingTop: 8 },

  broadcastRow: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  broadcastSubject: { fontSize: 14, fontWeight: '700' },
  broadcastContent: { fontSize: 13, lineHeight: 18 },
  broadcastMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  broadcastMetaText: { fontSize: 12 },
  broadcastCost: { fontSize: 12 },

  emptyState: { padding: 40, alignItems: 'center', gap: 8 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Compose modal
  composeContainer: { flex: 1 },
  composeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  composeCancel: { fontSize: 16 },
  composeTitle: { fontSize: 16, fontWeight: '700' },
  composeSend: { fontSize: 16, fontWeight: '700' },

  allowanceBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  allowanceText: { fontSize: 13 },

  composeForm: { flex: 1, padding: 16, gap: 4 },
  subjectInput: {
    fontSize: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  bodyInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  charCount: { fontSize: 12, textAlign: 'right' },
});
