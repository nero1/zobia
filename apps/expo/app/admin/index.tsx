import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface AdminStats {
  totalUsers: number;
  activeRooms: number;
  dailyLogins: number;
  pendingReports: number;
  pendingPayouts: number;
  coinsInCirculation: number;
}

/** Format a count (integer) for display in admin stat cards. */
function formatAdminStat(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

function StatCard({
  title, value, route, color
}: {
  title: string; value: number | string; route: string; color: string;
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      className={`flex-1 m-2 p-4 rounded-xl ${color}`}
      onPress={() => router.push(route as Parameters<typeof router.push>[0])}
    >
      <Text className="text-white text-2xl font-bold">{value}</Text>
      <Text className="text-white/80 text-sm mt-1">{title}</Text>
    </TouchableOpacity>
  );
}

export default function AdminOverviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const currency = useCurrency();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStats() {
    setError(false);
    try {
      const { data } = await apiClient.get('/admin/overview');
      setStats(data.data?.stats ?? null);
    } catch (err) {
      console.error('[admin] Failed to load overview stats:', err);
      setError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadStats(); }, []);

  if (loading) return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" color="#2563EB" />
    </View>
  );

  if (error) return (
    <View className="flex-1 items-center justify-center p-8 gap-4">
      <Text className="text-gray-700 text-center text-base">{t('admin.statsLoadError', 'Failed to load dashboard stats.')}</Text>
      <TouchableOpacity
        className="bg-blue-600 px-6 py-3 rounded-xl"
        onPress={() => { setLoading(true); void loadStats(); }}
      >
        <Text className="text-white font-semibold">{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadStats(); }} />}
    >
      <View className="px-4 pt-6 pb-2">
        <Text className="text-2xl font-bold text-gray-900">{t('admin.dashboardTitle', 'Admin Dashboard')}</Text>
        <Text className="text-gray-500 text-sm mt-1">{t('admin.dashboardSubtitle', 'Platform overview')}</Text>
      </View>

      <View className="flex-row flex-wrap px-2">
        <StatCard title={t('admin.totalUsers', 'Total Users')} value={formatAdminStat(stats?.totalUsers ?? 0)} route="/admin/users" color="bg-blue-600" />
        <StatCard title={t('admin.activeRooms', 'Active Rooms')} value={formatAdminStat(stats?.activeRooms ?? 0)} route="/rooms" color="bg-emerald-600" />
        <StatCard title={t('admin.dailyLogins', 'Daily Logins')} value={formatAdminStat(stats?.dailyLogins ?? 0)} route="/admin/users" color="bg-violet-600" />
        <StatCard title={t('admin.pendingReports', 'Pending Reports')} value={formatAdminStat(stats?.pendingReports ?? 0)} route="/admin/moderation" color="bg-red-500" />
        <StatCard title={t('admin.pendingPayouts', 'Pending Payouts')} value={formatAdminStat(stats?.pendingPayouts ?? 0)} route="/admin/financial" color="bg-amber-500" />
        <StatCard title={t('admin.coinsInCirculation', '{{currency}} in Circulation', { currency: currency.softPlural })} value={formatAdminStat(stats?.coinsInCirculation ?? 0)} route="/admin/financial" color="bg-teal-600" />
      </View>

      <View className="mx-4 mt-4">
        <Text className="text-gray-700 font-semibold text-base mb-3">{t('admin.quickActions', 'Quick Actions')}</Text>
        {[
          { label: "Moderation Queue", route: "/admin/moderation", icon: "🛡️" },
          { label: "Financial Overview", route: "/admin/financial", icon: "💰" },
          { label: "System Alerts", route: "/admin/alerts", icon: "🔔" },
          { label: "Compose Message", route: "/admin/messages", icon: "✉️" },
          { label: "Announcements", route: "/admin/announcements", icon: "📢" },
          { label: "Refunds", route: "/admin/refunds", icon: "↩️" },
          { label: "Flash XP Events", route: "/admin/flash-xp", icon: "⚡" },
          { label: "Branded Rooms", route: "/admin/branded-rooms", icon: "🏢" },
          { label: "Platform Events", route: "/admin/events", icon: "🗓️" },
          { label: "Sponsored Quests", route: "/admin/sponsored-quests", icon: "🎯" },
          { label: "Config & Flags", route: "/admin/config", icon: "⚙️" },
          { label: "AI Settings", route: "/admin/ai-settings", icon: "🤖" },
          { label: "Feature Flags", route: "/admin/feature-flags", icon: "🚩" },
          { label: "Actions Log", route: "/admin/actions-log", icon: "📋" },
          { label: "Automated Actions", route: "/admin/automated-actions", icon: "🤖" },
          { label: "Email Settings", route: "/admin/email-settings", icon: "📧" },
          { label: "Footer Scripts", route: "/admin/footer-scripts", icon: "🧩" },
          { label: "Leaderboard Banners", route: "/admin/leaderboard-banners", icon: "🏆" },
          { label: "Creator Spotlight", route: "/admin/creator-spotlight", icon: "⭐" },
          { label: "Gift Drops", route: "/admin/gift-drop", icon: "🎁" },
          { label: "Seasons", route: "/admin/seasons", icon: "🗓️" },
          { label: "Payouts", route: "/admin/payouts", icon: "💸" },
          { label: "Community Notes", route: "/admin/community-notes", icon: "📝" },
        ].map((action) => (
          <TouchableOpacity
            key={action.route}
            className="flex-row items-center bg-white rounded-xl px-4 py-3 mb-2 shadow-sm"
            onPress={() => router.push(action.route as Parameters<typeof router.push>[0])}
          >
            <Text className="text-xl mr-3">{action.icon}</Text>
            <Text className="text-gray-800 font-medium">{action.label}</Text>
            <Text className="ml-auto text-gray-400">›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
