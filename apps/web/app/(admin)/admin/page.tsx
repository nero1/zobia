"use client";

/**
 * app/(admin)/admin/page.tsx
 *
 * Admin dashboard overview — fetches live stats from GET /api/admin/overview.
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewStats {
  active_users: { dau: number; wau: number; mau: number };
  registrations: { today: number; this_week: number };
  revenue: { today: number; this_week: number; this_month: number; currency: string };
  rooms: { active: number };
  guilds: { active: number };
  guild_wars: { active: number };
  moderation: { pending_reports: number };
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-NG");
}

function fmtCurrency(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("en-NG")}`;
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: "blue" | "green" | "gold" | "red" | "neutral";
}

function StatCard({ label, value, sub, color = "neutral" }: StatCardProps) {
  const colorMap: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
    green: "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30",
    gold: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    red: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
    neutral: "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
  };
  return (
    <div className={`rounded-xl border p-5 shadow-card ${colorMap[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick action link
// ---------------------------------------------------------------------------

function QuickAction({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card transition-shadow hover:shadow-elevated dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</p>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StatSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mt-3 h-7 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mt-1.5 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/overview", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const err = new Error(body.error?.message ?? "Failed to load overview") as Error & { code?: string | null };
          err.code = body.error?.code ?? null;
          throw err;
        }
        const data = (await res.json()) as { data: OverviewStats };
        setStats(data.data);
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Error loading dashboard") : "Error loading dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Dashboard</h1>
        {stats && (
          <p className="text-xs text-neutral-400">
            Updated {new Date(stats.generated_at).toLocaleTimeString("en-GB")}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Active users */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Active Users</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Daily Active Users" value={fmt(stats?.active_users.dau ?? 0)} color="blue" />
            <StatCard label="Weekly Active Users" value={fmt(stats?.active_users.wau ?? 0)} color="blue" />
            <StatCard label="Monthly Active Users" value={fmt(stats?.active_users.mau ?? 0)} color="blue" />
          </>
        )}
      </div>

      {/* Revenue + registrations */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Revenue & Growth</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Revenue Today" value={fmtCurrency(stats?.revenue.today ?? 0, stats?.revenue.currency ?? "₦")} color="gold" />
            <StatCard label="Revenue This Week" value={fmtCurrency(stats?.revenue.this_week ?? 0, stats?.revenue.currency ?? "₦")} color="gold" />
            <StatCard label="Revenue This Month" value={fmtCurrency(stats?.revenue.this_month ?? 0, stats?.revenue.currency ?? "₦")} color="gold" />
            <StatCard label="New Users Today" value={fmt(stats?.registrations.today ?? 0)} sub={`${fmt(stats?.registrations.this_week ?? 0)} this week`} color="green" />
          </>
        )}
      </div>

      {/* Platform health */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Platform Health</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Active Rooms" value={fmt(stats?.rooms.active ?? 0)} color="green" />
            <StatCard label="Active Guilds" value={fmt(stats?.guilds.active ?? 0)} color="green" />
            <StatCard label="Active Guild Wars" value={fmt(stats?.guild_wars.active ?? 0)} color="green" />
            <StatCard
              label="Pending Reports"
              value={fmt(stats?.moderation.pending_reports ?? 0)}
              color={stats && stats.moderation.pending_reports > 10 ? "red" : "neutral"}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-500">Quick Actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickAction title="Review Reports" description="Check pending user reports" href="/admin/moderation" />
        <QuickAction title="Manage Users" description="View, ban, or verify users" href="/admin/users" />
        <QuickAction title="Announcements" description="Create or schedule announcements" href="/admin/announcements" />
        <QuickAction title="Feature Flags" description="Toggle platform features on/off" href="/admin/feature-flags" />
        <QuickAction title="Financial" description="Payouts, balances, transactions" href="/admin/financial" />
        <QuickAction title="Flash XP Events" description="Schedule double-XP announcements" href="/admin/flash-xp" />
        <QuickAction title="Events" description="Seasonal and platform events" href="/admin/events" />
        <QuickAction title="Config" description="CAPTCHA, age gate, provider settings" href="/admin/config" />
        <QuickAction title="Actions Log" description="Automated action history" href="/admin/actions-log" />
      </div>
    </div>
  );
}
