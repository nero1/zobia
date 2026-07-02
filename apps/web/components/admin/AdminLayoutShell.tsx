"use client";

/**
 * components/admin/AdminLayoutShell.tsx
 *
 * Client shell for the admin layout:
 * - Mobile / PWA: hamburger → slide-out drawer (accordion pattern)
 * - Desktop: fixed sidebar with overflow-y-auto so all links are reachable
 * - All surfaces include a "← User Area" link back to /home
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";

const adminNavItems = [
  { href: "/admin",                    label: "Dashboard",          icon: "◼" },
  { href: "/admin/users",              label: "Users",              icon: "👥" },
  { href: "/admin/moderation",         label: "Moderation",         icon: "🚩" },
  { href: "/admin/forum",              label: "Answers",            icon: "❓" },
  { href: "/admin/community-notes",    label: "Community Notes",    icon: "📝" },
  { href: "/admin/financial",          label: "Financial",          icon: "💳" },
  { href: "/admin/payouts",            label: "Payouts",            icon: "💸" },
  { href: "/admin/refunds",            label: "Refunds",            icon: "↩️" },
  { href: "/admin/announcements",      label: "Announcements",      icon: "📢" },
  { href: "/admin/messages",           label: "Messages",           icon: "💬" },
  { href: "/admin/alerts",             label: "Alerts",             icon: "🔔" },
  { href: "/admin/config",             label: "Config",             icon: "⚙️" },
  { href: "/admin/settings/privacy",   label: "Privacy Settings",   icon: "🔒" },
  { href: "/admin/settings/profile-stats", label: "Profile Stats",  icon: "📊" },
  { href: "/admin/ai-settings",        label: "AI Settings",        icon: "🤖" },
  { href: "/admin/feature-flags",      label: "Feature Flags",      icon: "🚀" },
  { href: "/admin/business",            label: "Business Accounts",  icon: "🏢" },
  { href: "/admin/kyc",                 label: "Identity KYC",       icon: "🪪" },
  { href: "/admin/rooms",               label: "Rooms",              icon: "🏛" },
  { href: "/admin/branded-rooms",      label: "Branded Rooms",      icon: "🏠" },
  { href: "/admin/leaderboards",       label: "Leaderboards",       icon: "📊" },
  { href: "/admin/leaderboard-banners",label: "Leaderboard Banners",icon: "🏆" },
  { href: "/admin/footer-scripts",     label: "Footer Scripts",     icon: "📄" },
  { href: "/admin/events",             label: "Events",             icon: "📅" },
  { href: "/admin/flash-xp",           label: "Flash XP",           icon: "⚡" },
  { href: "/admin/payouts/appeals",    label: "Payout Appeals",     icon: "⚖️" },
  { href: "/admin/actions-log",        label: "Actions Log",        icon: "📋" },
  { href: "/admin/automated-actions",  label: "Auto Actions",       icon: "🤖" },
  { href: "/admin/creator-spotlight",  label: "Creator Spotlight",  icon: "⭐" },
  { href: "/admin/gifts",               label: "Gifts Catalog",      icon: "🛍️" },
  { href: "/admin/gift-drop",          label: "Gift Drop",          icon: "🎁" },
  { href: "/admin/seasons",            label: "Seasons",            icon: "🏅" },
  { href: "/admin/sponsored-quests",   label: "Sponsored Quests",   icon: "🎯" },
  { href: "/admin/ads",                label: "Ads",                icon: "🖼️" },
  { href: "/admin/games",              label: "Games",              icon: "🎮" },
  { href: "/admin/blogs",              label: "Blogs",              icon: "📝" },
] as const;

// ---------------------------------------------------------------------------
// Nav link list (shared by sidebar and drawer)
// ---------------------------------------------------------------------------

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5" aria-label="Admin navigation">
      {/* Back to user area — always first */}
      <Link
        href="/home"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950 dark:hover:text-blue-200"
      >
        <span className="text-base leading-none">←</span>
        User Area
      </Link>

      <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />

      {adminNavItems.map((item) => {
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <div
        role="dialog"
        aria-label="Admin navigation menu"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-xl transition-transform duration-300 dark:bg-neutral-900 lg:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Drawer header */}
        <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-neutral-900 dark:text-neutral-50">Zobia</span>
            <span className="rounded bg-gold-100 px-1.5 py-0.5 text-xs font-semibold text-gold-700 dark:bg-gold-900 dark:text-gold-300">
              ADMIN
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span aria-hidden="true" className="text-xl leading-none">✕</span>
          </button>
        </div>

        {/* Scrollable nav */}
        <div className="h-[calc(100%-3.5rem)] overflow-y-auto p-3">
          <NavLinks onNavigate={onClose} />

          <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
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
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  // Left-edge swipe RIGHT to open; LEFT swipe to close (mobile web / PWA)
  useEffect(() => {
    const EDGE_PX = 20;
    const MIN_SWIPE = 60;
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t.clientX <= EDGE_PX || drawerOpenRef.current) {
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      } else {
        touchStartX = null;
        touchStartY = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX === null || touchStartY === null) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartX;
      const dy = Math.abs(t.clientY - touchStartY);
      if (drawerOpenRef.current) {
        if (dx < -MIN_SWIPE && dy < Math.abs(dx) * 0.75) {
          setDrawerOpen(false);
          touchStartX = null;
          touchStartY = null;
        }
      } else {
        if (dx > MIN_SWIPE && dy < dx * 0.75) {
          setDrawerOpen(true);
          touchStartX = null;
          touchStartY = null;
        }
      }
    };

    const onTouchEnd = () => {
      touchStartX = null;
      touchStartY = null;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-neutral-100 dark:bg-neutral-950">
      {/* Desktop sidebar — scrollable */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center border-b border-neutral-200 px-5 dark:border-neutral-800">
          <span className="text-base font-bold text-neutral-900 dark:text-neutral-50">Zobia</span>
          <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-xs font-semibold text-gold-700 dark:bg-gold-900 dark:text-gold-300">
            ADMIN
          </span>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-neutral-200 p-3 dark:border-neutral-800">
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

      {/* Mobile drawer */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Main content */}
      <div className="flex flex-1 flex-col lg:pl-56">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-16 items-center border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900 lg:px-6">
          {/* Hamburger (mobile only) */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open admin menu"
            className="mr-3 rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 lg:hidden"
          >
            <span aria-hidden="true" className="block text-xl leading-none">☰</span>
          </button>

          <h1 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            Admin Panel
          </h1>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
