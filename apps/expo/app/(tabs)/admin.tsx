/**
 * app/(tabs)/admin.tsx
 *
 * Admin dashboard tab — only visible to users with is_admin === true.
 *
 * Shows quick stats (DAU, revenue today, pending reports, pending payouts)
 * and navigation cards to each admin sub-section.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminQuickStats {
  dau: number;
  revenueToday: number;
  pendingReports: number;
  pendingPayouts: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchQuickStats(): Promise<AdminQuickStats> {
  const { data } = await apiClient.get('/api/admin/overview');
  return {
    dau: data.activeUsers ?? 0,
    revenueToday: data.revenue ?? 0,
    pendingReports: data.moderationQueueDepth ?? 0,
    pendingPayouts: data.pendingPayouts ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  accent?: string;
}

function StatCard({ label, value, accent }: StatCardProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: themeColors.surface }]}>
      <Text style={[styles.statValue, { color: accent ?? themeColors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>{label}</Text>
    </View>
  );
}

interface NavCardProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function NavCard({ icon, title, subtitle, onPress }: NavCardProps) {
  const { colors: themeColors } = useTheme();
  return (
    <Pressable
      style={[styles.navCard, { backgroundColor: themeColors.surface }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.navIcon}>{icon}</Text>
      <View style={styles.navInfo}>
        <Text style={[styles.navTitle, { color: themeColors.text }]}>{title}</Text>
        <Text style={[styles.navSubtitle, { color: themeColors.textMuted }]}>{subtitle}</Text>
      </View>
      <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * AdminDashboardTab — entry point for the admin section.
 */
export default function AdminDashboardTab() {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'quick-stats'],
    queryFn: fetchQuickStats,
    refetchInterval: 30_000,
  });

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>Admin</Text>
        <Text style={[styles.subtitle, { color: themeColors.textMuted }]}>
          Platform dashboard
        </Text>
      </View>

      {/* Quick stats */}
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand.blue} />
        </View>
      ) : (
        <View style={styles.statsGrid}>
          <StatCard
            label="DAU"
            value={stats?.dau.toLocaleString() ?? '—'}
            accent={colors.brand.blue}
          />
          <StatCard
            label="Revenue Today"
            value={`₦${(stats?.revenueToday ?? 0).toLocaleString()}`}
            accent={colors.semantic.success}
          />
          <StatCard
            label="Pending Reports"
            value={String(stats?.pendingReports ?? '—')}
            accent={
              (stats?.pendingReports ?? 0) > 10
                ? colors.semantic.error
                : themeColors.text
            }
          />
          <StatCard
            label="Pending Payouts"
            value={String(stats?.pendingPayouts ?? '—')}
            accent={
              (stats?.pendingPayouts ?? 0) > 5
                ? colors.semantic.warning
                : themeColors.text
            }
          />
        </View>
      )}

      {/* Navigation cards */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>SECTIONS</Text>
        <NavCard
          icon="📊"
          title="Platform Overview"
          subtitle="Users, rooms, guilds, revenue"
          onPress={() => router.push('/admin/overview')}
        />
        <NavCard
          icon="👥"
          title="User Management"
          subtitle="Search, suspend, ban, restore"
          onPress={() => router.push('/admin/users')}
        />
        <NavCard
          icon="🚨"
          title="Moderation Queue"
          subtitle="Review reported content"
          onPress={() => router.push('/admin/moderation')}
        />
        <NavCard
          icon="💰"
          title="Financial"
          subtitle="Payouts, balances, approvals"
          onPress={() => router.push('/admin/financial')}
        />
        <NavCard
          icon="⚠️"
          title="System Alerts"
          subtitle="Active alerts and history"
          onPress={() => router.push('/admin/alerts')}
        />
        <NavCard
          icon="📨"
          title="Messages"
          subtitle="Broadcast to users"
          onPress={() => router.push('/admin/messages')}
        />
      </View>
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
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },

  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  statCard: {
    width: '47%',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },

  section: {
    paddingHorizontal: 20,
    marginTop: 24,
    gap: 8,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },

  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    minHeight: 64,
  },
  navIcon: { fontSize: 26 },
  navInfo: { flex: 1 },
  navTitle: { fontSize: 15, fontWeight: '700' },
  navSubtitle: { fontSize: 12, marginTop: 1 },
  chevron: { fontSize: 22, fontWeight: '300' },
});
