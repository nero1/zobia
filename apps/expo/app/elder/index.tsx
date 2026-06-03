/**
 * app/elder/index.tsx
 *
 * Elder / Mentorship screen.
 *
 * States:
 *  - Elder: shows mentee list with progress bars + mentorship XP earned
 *  - Eligible but not yet elder: shows requirements
 *  - Below Hustler: shows "Request a Mentor" button
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mentee {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  progressPercent: number;
  rankLabel: string;
}

type ElderStatus = 'elder' | 'eligible' | 'below_hustler';

interface ElderData {
  status: ElderStatus;
  isElder: boolean;
  mentorshipXPThisSeason: number;
  mentees: Mentee[];
  requirements?: {
    prestigeRequired: number;
    currentPrestige: number;
    activeDaysRequired: number;
    activeDays: number;
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchElderData(): Promise<ElderData> {
  const { data } = await apiClient.get('/api/elder');
  return data;
}

async function requestMentor(): Promise<void> {
  await apiClient.post('/api/elder/request-mentor');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.progressOuter}>
      <View
        style={[styles.progressInner, { width: `${Math.min(progress, 100)}%` }]}
      />
    </View>
  );
}

function MenteeCard({ mentee }: { mentee: Mentee }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.menteeCard, { borderColor: themeColors.border }]}>
      <View style={styles.menteeAvatar}>
        <Text style={styles.menteeAvatarEmoji}>{mentee.avatarEmoji}</Text>
      </View>
      <View style={styles.menteeInfo}>
        <Text style={[styles.menteeName, { color: themeColors.text }]} numberOfLines={1}>
          {mentee.displayName}
        </Text>
        <Text style={[styles.menteeRank, { color: themeColors.textMuted }]}>
          {mentee.rankLabel}
        </Text>
        <ProgressBar progress={mentee.progressPercent} />
        <Text style={[styles.menteeProgress, { color: themeColors.textMuted }]}>
          {mentee.progressPercent}% to next rank
        </Text>
      </View>
    </View>
  );
}

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ElderScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['elder'],
    queryFn: fetchElderData,
  });

  const requestMutation = useMutation({
    mutationFn: requestMentor,
    onSuccess: () => {
      Alert.alert('Request Sent', 'Your mentor request has been submitted. An elder will reach out soon.');
      queryClient.invalidateQueries({ queryKey: ['elder'] });
    },
    onError: () => Alert.alert('Error', 'Could not send mentor request. Please try again.'),
  });

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load elder data. Check your connection.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: themeColors.surface }]}>
        <Text style={styles.heroEmoji}>🌿</Text>
        <Text style={[styles.heroTitle, { color: themeColors.text }]}>
          {data.isElder ? 'Elder Status' : 'Mentorship'}
        </Text>
        {data.isElder && (
          <View style={styles.xpChip}>
            <Text style={styles.xpChipText}>
              +{data.mentorshipXPThisSeason.toLocaleString()} XP this season
            </Text>
          </View>
        )}
      </View>

      {/* Elder — mentee list */}
      {data.isElder && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
            Your Mentees ({data.mentees.length})
          </Text>
          {data.mentees.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No active mentees yet. They'll appear here once assigned.
              </Text>
            </View>
          ) : (
            data.mentees.map((mentee) => (
              <MenteeCard key={mentee.userId} mentee={mentee} />
            ))
          )}
        </View>
      )}

      {/* Eligible but not elder */}
      {data.status === 'eligible' && !data.isElder && (
        <View style={[styles.infoCard, { backgroundColor: `${colors.brand.green}10` }]}>
          <Text style={styles.infoCardTitle}>You're eligible to become an Elder!</Text>
          <Text style={[styles.infoCardBody, { color: themeColors.textMuted }]}>
            You meet all requirements. An admin will review your account and grant Elder status shortly.
          </Text>
          <View style={styles.reqList}>
            <Text style={styles.reqItem}>✓ Prestige 3+</Text>
            <Text style={styles.reqItem}>✓ Active for 30+ days</Text>
          </View>
        </View>
      )}

      {/* Below Hustler */}
      {data.status === 'below_hustler' && (
        <View style={styles.section}>
          <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.infoCardTitle, { color: themeColors.text }]}>
              Requirements to become an Elder
            </Text>
            {data.requirements && (
              <View style={styles.reqList}>
                <Text style={[styles.reqItem, {
                  color: data.requirements.currentPrestige >= data.requirements.prestigeRequired
                    ? colors.semantic.success
                    : themeColors.textMuted,
                }]}>
                  {data.requirements.currentPrestige >= data.requirements.prestigeRequired ? '✓' : '○'}{' '}
                  Prestige {data.requirements.prestigeRequired}+
                  {' '}(you: {data.requirements.currentPrestige})
                </Text>
                <Text style={[styles.reqItem, {
                  color: data.requirements.activeDays >= data.requirements.activeDaysRequired
                    ? colors.semantic.success
                    : themeColors.textMuted,
                }]}>
                  {data.requirements.activeDays >= data.requirements.activeDaysRequired ? '✓' : '○'}{' '}
                  Active for {data.requirements.activeDaysRequired}+ days
                  {' '}(you: {data.requirements.activeDays})
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.requestBtn}
            onPress={() => requestMutation.mutate()}
            disabled={requestMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Request a mentor"
          >
            {requestMutation.isPending ? (
              <ActivityIndicator color={colors.neutral[0]} />
            ) : (
              <Text style={styles.requestBtnText}>Request a Mentor</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  heroEmoji: { fontSize: 48 },
  heroTitle: { fontSize: 22, fontWeight: '800' },
  xpChip: {
    backgroundColor: `${colors.brand.green}22`,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  xpChipText: {
    color: colors.brand.greenDark,
    fontSize: 13,
    fontWeight: '700',
  },

  section: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },

  menteeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  menteeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  menteeAvatarEmoji: { fontSize: 24 },
  menteeInfo: { flex: 1, gap: 3 },
  menteeName: { fontSize: 14, fontWeight: '600' },
  menteeRank: { fontSize: 12 },
  menteeProgress: { fontSize: 11 },

  progressOuter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  progressInner: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.green,
  },

  infoCard: {
    borderRadius: 14,
    padding: 16,
    gap: 8,
    margin: 16,
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.brand.greenDark,
  },
  infoCardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  reqList: { gap: 6, marginTop: 4 },
  reqItem: { fontSize: 14, fontWeight: '500' },

  requestBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginTop: 4,
  },
  requestBtnText: {
    color: colors.neutral[0],
    fontSize: 15,
    fontWeight: '700',
  },

  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 80, borderRadius: 12, backgroundColor: colors.neutral[200] },
});
