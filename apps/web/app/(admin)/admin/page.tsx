/**
 * app/(admin)/admin/page.tsx
 *
 * Admin dashboard overview page.
 * Displays key metrics and quick-action cards.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  description?: string;
  color?: "blue" | "green" | "gold" | "neutral";
}

function StatCard({ label, value, description, color = "neutral" }: StatCardProps) {
  const colorClasses: Record<string, string> = {
    blue: "border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950",
    green: "border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-950",
    gold: "border-gold-200 bg-gold-50 dark:border-gold-800 dark:bg-gold-950",
    neutral: "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
  };

  return (
    <div className={`rounded-xl border p-5 shadow-card ${colorClasses[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {value}
      </p>
      {description && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick action
// ---------------------------------------------------------------------------

interface QuickActionProps {
  title: string;
  description: string;
  href: string;
}

function QuickAction({ title, description, href }: QuickActionProps) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card transition-shadow hover:shadow-elevated dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Admin dashboard overview.
 * In production, stats would be loaded via server-side data fetching.
 */
export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Dashboard
      </h1>

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Users" value="—" description="Loading…" color="blue" />
        <StatCard label="Active Rooms" value="—" description="Loading…" color="green" />
        <StatCard label="Reports Today" value="—" description="Pending review" color="gold" />
        <StatCard label="Revenue (MTD)" value="—" description="Loading…" color="neutral" />
      </div>

      {/* Quick actions */}
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Quick Actions
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickAction
          title="Review Reports"
          description="Check pending user reports"
          href="/(admin)/admin/reports"
        />
        <QuickAction
          title="Manage Users"
          description="View, ban, or verify users"
          href="/(admin)/admin/users"
        />
        <QuickAction
          title="Broadcast Message"
          description="Send a system announcement"
          href="/(admin)/admin/broadcast"
        />
        <QuickAction
          title="App Settings"
          description="Feature flags, limits, and more"
          href="/(admin)/admin/settings"
        />
        <QuickAction
          title="Analytics"
          description="Usage trends and engagement"
          href="/(admin)/admin/analytics"
        />
        <QuickAction
          title="Payments"
          description="Transaction history and payouts"
          href="/(admin)/admin/payments"
        />
      </div>
    </div>
  );
}
