/**
 * app/(admin)/admin/layout.tsx
 *
 * Admin panel layout.
 *
 * Access control: Route middleware validates the JWT and checks `is_admin`
 * from the database (not just from the JWT claim) via a DB query on each
 * admin request.  This layout provides the visual admin shell.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Admin Panel",
    template: "%s | Zobia Admin",
  },
};

interface AdminLayoutProps {
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Admin sidebar nav items
// ---------------------------------------------------------------------------

const adminNavItems = [
  { href: "/admin", label: "Dashboard", icon: "◼" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/moderation", label: "Moderation", icon: "🚩" },
  { href: "/admin/community-notes", label: "Community Notes", icon: "📝" },
  { href: "/admin/financial", label: "Financial", icon: "💳" },
  { href: "/admin/payouts", label: "Payouts", icon: "💸" },
  { href: "/admin/refunds", label: "Refunds", icon: "↩️" },
  { href: "/admin/announcements", label: "Announcements", icon: "📢" },
  { href: "/admin/messages", label: "Messages", icon: "💬" },
  { href: "/admin/alerts", label: "Alerts", icon: "🔔" },
  { href: "/admin/config", label: "Config", icon: "⚙️" },
  { href: "/admin/feature-flags", label: "Feature Flags", icon: "🚀" },
  { href: "/admin/branded-rooms", label: "Branded Rooms", icon: "🏠" },
  { href: "/admin/leaderboards", label: "Leaderboards", icon: "📊" },
  { href: "/admin/leaderboard-banners", label: "Leaderboard Banners", icon: "🏆" },
  { href: "/admin/footer-scripts", label: "Footer Scripts", icon: "📄" },
  { href: "/admin/events", label: "Events", icon: "📅" },
  { href: "/admin/flash-xp", label: "Flash XP", icon: "⚡" },
  { href: "/admin/payouts/appeals", label: "Payout Appeals", icon: "⚖️" },
  { href: "/admin/actions-log", label: "Actions Log", icon: "📋" },
  { href: "/admin/automated-actions", label: "Auto Actions", icon: "🤖" },
  { href: "/admin/creator-spotlight", label: "Creator Spotlight", icon: "⭐" },
  { href: "/admin/gift-drop", label: "Gift Drop", icon: "🎁" },
  { href: "/admin/seasons", label: "Seasons", icon: "🏅" },
  { href: "/admin/sponsored-quests", label: "Sponsored Quests", icon: "🎯" },
] as const;

/**
 * Admin panel layout with sidebar navigation.
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="flex min-h-screen bg-neutral-100 dark:bg-neutral-950">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 w-56 border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {/* Brand */}
        <div className="flex h-16 items-center border-b border-neutral-200 px-5 dark:border-neutral-800">
          <span className="text-base font-bold text-neutral-900 dark:text-neutral-50">
            Zobia
          </span>
          <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-xs font-semibold text-gold-700 dark:bg-gold-900 dark:text-gold-300">
            ADMIN
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 p-3">
          {adminNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950"
            >
              <span className="text-base leading-none">→</span>
              Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col pl-56">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-16 items-center border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h1 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            Admin Panel
          </h1>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
