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
  { href: "/gate44",                    label: "Dashboard",          icon: "◼" },
  { href: "/gate44/users",              label: "Users",              icon: "👥" },
  { href: "/gate44/moderation",         label: "Moderation",         icon: "🚩" },
  { href: "/moderation",               label: "Moderation Center",  icon: "🧭" },
  { href: "/gate44/answers",            label: "Answers",            icon: "❓" },
  { href: "/gate44/community-notes",    label: "Community Notes",    icon: "📝" },
  { href: "/gate44/financial",          label: "Financial",          icon: "💳" },
  { href: "/gate44/payouts",            label: "Payouts",            icon: "💸" },
  { href: "/gate44/refunds",            label: "Refunds",            icon: "↩️" },
  { href: "/gate44/announcements",      label: "Announcements",      icon: "📢" },
  { href: "/gate44/messages",           label: "Messages",           icon: "💬" },
  { href: "/gate44/contact-messages",   label: "Contact Messages",   icon: "✉️" },
  { href: "/gate44/alerts",             label: "Alerts",             icon: "🔔" },
  { href: "/gate44/config",             label: "Config",             icon: "⚙️" },
  { href: "/gate44/settings/privacy",   label: "Privacy Settings",   icon: "🔒" },
  { href: "/gate44/settings/security",  label: "Security",           icon: "🛡️" },
  { href: "/gate44/settings/profile-stats", label: "Profile Stats",  icon: "📊" },
  { href: "/gate44/ai-settings",        label: "AI Settings",        icon: "🤖" },
  { href: "/gate44/feature-flags",      label: "Feature Flags",      icon: "🚀" },
  { href: "/gate44/business",            label: "Business Accounts",  icon: "🏢" },
  { href: "/gate44/kyc",                 label: "Identity KYC",       icon: "🪪" },
  { href: "/gate44/rooms",               label: "Rooms",              icon: "🏛" },
  { href: "/gate44/guilds",             label: "Guilds",             icon: "🏰" },
  { href: "/gate44/branded-rooms",      label: "Branded Rooms",      icon: "🏠" },
  { href: "/gate44/leaderboards",       label: "Leaderboards",       icon: "📊" },
  { href: "/gate44/leaderboard-banners",label: "Leaderboard Banners",icon: "🏆" },
  { href: "/gate44/footer-scripts",     label: "Footer Scripts",     icon: "📄" },
  { href: "/gate44/events",             label: "Events",             icon: "📅" },
  { href: "/gate44/flash-xp",           label: "Flash XP",           icon: "⚡" },
  { href: "/gate44/payouts/appeals",    label: "Payout Appeals",     icon: "⚖️" },
  { href: "/gate44/actions-log",        label: "Actions Log",        icon: "📋" },
  { href: "/gate44/audit-logs",         label: "Audit Logs",         icon: "🧾" },
  { href: "/gate44/automated-actions",  label: "Auto Actions",       icon: "🤖" },
  { href: "/gate44/creator-spotlight",  label: "Creator Spotlight",  icon: "⭐" },
  { href: "/gate44/gifts",               label: "Gifts Catalog",      icon: "🛍️" },
  { href: "/gate44/gift-drop",          label: "Gift Drop",          icon: "🎁" },
  { href: "/gate44/seasons",            label: "Seasons",            icon: "🏅" },
  { href: "/gate44/sponsored-quests",   label: "Sponsored Quests",   icon: "🎯" },
  { href: "/gate44/ads",                label: "Ads",                icon: "🖼️" },
  { href: "/gate44/games",              label: "Games",              icon: "🎮" },
  { href: "/gate44/blogs",              label: "Blogs",              icon: "📝" },
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
          item.href === "/gate44"
            ? pathname === "/gate44"
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
// Status bar — magic-word reminder + maintenance-mode indicator
// ---------------------------------------------------------------------------

function AdminStatusBar() {
  const [magicWordSet, setMagicWordSet] = useState<boolean | null>(null);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/auth/magic-word", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { data?: { isSet: boolean } };
        if (!cancelled) setMagicWordSet(!!data.data?.isSet);
      } catch { /* ignore — non-critical reminder */ }
    })();
    (async () => {
      try {
        const res = await fetch("/api/admin/maintenance", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { data?: { enabled: boolean } };
        if (!cancelled) setMaintenance(data.data ?? null);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {maintenance?.enabled && (
        <div role="status" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white">
          🚧 Maintenance mode is ON — only admins and moderators can access Zobia right now.
        </div>
      )}
      {magicWordSet === false && (
        <div role="alert" className="flex items-center justify-center gap-2 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white">
          ⚠️ You haven&apos;t set a Secret Magic Word — you could be locked out permanently if your
          login is ever locked.{" "}
          <Link href="/gate44/settings/security" className="underline underline-offset-2">
            Set it now
          </Link>
        </div>
      )}
    </>
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

/** Pages inside (admin)/gate44 that are reachable while logged OUT. The nav
 * shell (menu, "Admin Panel" chrome, logout button) must never render on
 * these — an unauthenticated visitor should see nothing but the bare form. */
const LOGGED_OUT_PATHS = ["/gate44/login", "/gate44/setup-2fa"];

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

  // BUG: the admin nav (with every management link + logout button) used to
  // render unconditionally, including on the login screen itself — so a
  // logged-out visitor who found the login URL saw the full admin menu.
  // Those two auth-flow pages get a bare, unbranded shell instead. This check
  // runs after all hooks above so it never violates the Rules of Hooks.
  const isLoggedOutPath = LOGGED_OUT_PATHS.some((p) => pathname?.startsWith(p));
  if (isLoggedOutPath) {
    return <div className="min-h-screen bg-neutral-100 dark:bg-neutral-950">{children}</div>;
  }

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
      {/*
       * min-w-0 is required here: without it, a flex child's implicit
       * min-width:auto lets wide content (e.g. an inner overflow-x-auto
       * table) force this whole column wider instead of scrolling inside
       * its own wrapper, which pushes the ENTIRE page horizontally on
       * mobile instead of just the table. See admin table pages.
       */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
        {/* Status bar — maintenance mode + magic-word reminder */}
        <AdminStatusBar />

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

        <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
      </div>
    </div>
  );
}
