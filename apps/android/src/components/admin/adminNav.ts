/**
 * apps/android/src/components/admin/adminNav.ts
 *
 * Admin section nav item list — mirrors apps/web/components/admin/AdminLayoutShell.tsx's
 * `adminNavItems` 1:1 (same labels/icons/order) so the Android drawer matches the web/PWA
 * admin sidebar. Every `href` here must correspond to an actual route file under
 * apps/android/src/routes/admin.
 */

export interface AdminNavItem {
  href: string;
  labelKey: string;
  labelDefault: string;
  icon: string;
}

export const adminNavItems: AdminNavItem[] = [
  { href: '/admin', labelKey: 'admin.nav.dashboard', labelDefault: 'Dashboard', icon: '◼' },
  { href: '/admin/users', labelKey: 'admin.nav.users', labelDefault: 'Users', icon: '👥' },
  { href: '/admin/moderation', labelKey: 'admin.nav.moderation', labelDefault: 'Moderation', icon: '🚩' },
  { href: '/moderation', labelKey: 'moderation.title', labelDefault: 'Moderation Center', icon: '🧭' },
  { href: '/admin/forum', labelKey: 'admin.nav.forum', labelDefault: 'Answers', icon: '❓' },
  { href: '/admin/community-notes', labelKey: 'admin.nav.communityNotes', labelDefault: 'Community Notes', icon: '📝' },
  { href: '/admin/financial', labelKey: 'admin.nav.financial', labelDefault: 'Financial', icon: '💳' },
  { href: '/admin/payouts', labelKey: 'admin.nav.payouts', labelDefault: 'Payouts', icon: '💸' },
  { href: '/admin/refunds', labelKey: 'admin.nav.refunds', labelDefault: 'Refunds', icon: '↩️' },
  { href: '/admin/announcements', labelKey: 'admin.nav.announcements', labelDefault: 'Announcements', icon: '📢' },
  { href: '/admin/messages', labelKey: 'admin.nav.messages', labelDefault: 'Messages', icon: '💬' },
  { href: '/admin/alerts', labelKey: 'admin.nav.alerts', labelDefault: 'Alerts', icon: '🔔' },
  { href: '/admin/config', labelKey: 'admin.nav.config', labelDefault: 'Config', icon: '⚙️' },
  { href: '/admin/settings/privacy', labelKey: 'admin.nav.privacySettings', labelDefault: 'Privacy Settings', icon: '🔒' },
  { href: '/admin/settings/profile-stats', labelKey: 'admin.nav.profileStats', labelDefault: 'Profile Stats', icon: '📊' },
  { href: '/admin/ai-settings', labelKey: 'admin.nav.aiSettings', labelDefault: 'AI Settings', icon: '🤖' },
  { href: '/admin/feature-flags', labelKey: 'admin.nav.featureFlags', labelDefault: 'Feature Flags', icon: '🚀' },
  { href: '/admin/business', labelKey: 'admin.nav.business', labelDefault: 'Business Accounts', icon: '🏢' },
  { href: '/admin/kyc', labelKey: 'admin.nav.kyc', labelDefault: 'Identity KYC', icon: '🪪' },
  { href: '/admin/rooms', labelKey: 'admin.nav.rooms', labelDefault: 'Rooms', icon: '🏛' },
  { href: '/admin/guilds', labelKey: 'admin.nav.guilds', labelDefault: 'Guilds', icon: '🏰' },
  { href: '/admin/branded-rooms', labelKey: 'admin.nav.brandedRooms', labelDefault: 'Branded Rooms', icon: '🏠' },
  { href: '/admin/leaderboards', labelKey: 'admin.nav.leaderboards', labelDefault: 'Leaderboards', icon: '📊' },
  { href: '/admin/leaderboard-banners', labelKey: 'admin.nav.leaderboardBanners', labelDefault: 'Leaderboard Banners', icon: '🏆' },
  { href: '/admin/footer-scripts', labelKey: 'admin.nav.footerScripts', labelDefault: 'Footer Scripts', icon: '📄' },
  { href: '/admin/events', labelKey: 'admin.nav.events', labelDefault: 'Events', icon: '📅' },
  { href: '/admin/flash-xp', labelKey: 'admin.nav.flashXp', labelDefault: 'Flash XP', icon: '⚡' },
  { href: '/admin/payouts/appeals', labelKey: 'admin.nav.payoutAppeals', labelDefault: 'Payout Appeals', icon: '⚖️' },
  { href: '/admin/actions-log', labelKey: 'admin.nav.actionsLog', labelDefault: 'Actions Log', icon: '📋' },
  { href: '/admin/automated-actions', labelKey: 'admin.nav.automatedActions', labelDefault: 'Auto Actions', icon: '🤖' },
  { href: '/admin/creator-spotlight', labelKey: 'admin.nav.creatorSpotlight', labelDefault: 'Creator Spotlight', icon: '⭐' },
  { href: '/admin/gifts', labelKey: 'admin.nav.gifts', labelDefault: 'Gifts Catalog', icon: '🛍️' },
  { href: '/admin/gift-drop', labelKey: 'admin.nav.giftDrop', labelDefault: 'Gift Drop', icon: '🎁' },
  { href: '/admin/seasons', labelKey: 'admin.nav.seasons', labelDefault: 'Seasons', icon: '🏅' },
  { href: '/admin/sponsored-quests', labelKey: 'admin.nav.sponsoredQuests', labelDefault: 'Sponsored Quests', icon: '🎯' },
  { href: '/admin/ads', labelKey: 'admin.nav.ads', labelDefault: 'Ads', icon: '🖼️' },
  { href: '/admin/games', labelKey: 'admin.nav.games', labelDefault: 'Games', icon: '🎮' },
  { href: '/admin/blogs', labelKey: 'admin.nav.blogs', labelDefault: 'Blogs', icon: '✍️' },
];
