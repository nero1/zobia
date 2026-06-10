/**
 * components/layout/Navbar.tsx
 *
 * Top navigation bar for the authenticated app.
 * - Fixed top bar (all screen sizes)
 * - Mobile hamburger that opens a full nav drawer
 * - Mobile bottom tab bar (Home, Rooms, Messages, Wallet, Profile)
 *
 * NO purple colors. NO gradients.
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";

interface NavUser {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
}

function useNavUser() {
  const [user, setUser] = useState<NavUser | null>(null);
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json) setUser(json.user ?? json); })
      .catch(() => {});
  }, []);
  return user;
}

// ---------------------------------------------------------------------------
// Nav item definitions
// ---------------------------------------------------------------------------

const bottomTabItems = [
  { href: "/home",     label: "Home",    shortLabel: "Home"    },
  { href: "/rooms",    label: "Rooms",   shortLabel: "Rooms"   },
  { href: "/messages", label: "Messages",shortLabel: "Msgs"    },
  { href: "/wallet",   label: "Wallet",  shortLabel: "Wallet"  },
  { href: "/profile",  label: "Profile", shortLabel: "Profile" },
] as const;

// Full nav for desktop + drawer
const primaryNavItems = [
  { href: "/home",         label: "Home",         icon: "🏠" },
  { href: "/rooms",        label: "Rooms",        icon: "🚪" },
  { href: "/messages",     label: "Messages",     icon: "💬" },
  { href: "/notifications",label: "Notifications",icon: "🔔" },
  { href: "/events",       label: "Events",       icon: "📅" },
  { href: "/wallet",       label: "Wallet",       icon: "🪙" },
  { href: "/inbox",        label: "Inbox",        icon: "📬" },
  { href: "/elder",        label: "Elder",        icon: "🎓" },
  { href: "/referrals",    label: "Referrals",    icon: "🔗" },
  { href: "/classroom",    label: "Classroom",    icon: "🏫" },
  { href: "/leaderboards", label: "Leaderboards", icon: "🏆" },
  { href: "/quests",       label: "Quests",       icon: "🎯" },
  { href: "/seasons",      label: "Seasons",      icon: "🗓️" },
] as const;

const secondaryNavItems = [
  { href: "/profile",  label: "Profile",  icon: "👤" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
] as const;

// ---------------------------------------------------------------------------
// Bottom tab icon map
// ---------------------------------------------------------------------------

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home:     { active: "🏠", inactive: "🏡" },
  Rooms:    { active: "🚪", inactive: "🚪" },
  Messages: { active: "💬", inactive: "💭" },
  Wallet:   { active: "🪙", inactive: "🪙" },
  Profile:  { active: "👤", inactive: "👤" },
};

function TabIcon({ label, isActive }: { label: string; isActive: boolean }) {
  const icon = TAB_ICONS[label];
  return (
    <span className="text-xl leading-none" aria-hidden="true">
      {isActive ? icon?.active : icon?.inactive}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar
// ---------------------------------------------------------------------------

function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:hidden"
      aria-label="Mobile navigation"
    >
      <div className="grid grid-cols-5">
        {bottomTabItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
                isActive
                  ? "text-primary-600 dark:text-primary-400"
                  : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <TabIcon label={item.label} isActive={isActive} />
              <span className="text-[10px] leading-none">{item.shortLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile nav drawer
// ---------------------------------------------------------------------------

function MobileDrawer({
  open,
  onClose,
  pathname,
  displayName,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  displayName: string;
  onLogout: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Navigation menu"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white pt-14 shadow-xl transition-transform duration-300 dark:bg-neutral-900 lg:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <span aria-hidden="true" className="text-xl leading-none">✕</span>
        </button>

        <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
          {/* Primary nav */}
          <nav className="space-y-0.5" aria-label="Primary">
            {primaryNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Divider */}
          <div className="my-3 border-t border-neutral-200 dark:border-neutral-800" />

          {/* Secondary nav */}
          <nav className="space-y-0.5" aria-label="Secondary">
            {secondaryNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Logout */}
          <button
            type="button"
            onClick={() => { onClose(); onLogout(); }}
            className="mt-4 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            🚪 Log out
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top nav bar
// ---------------------------------------------------------------------------

/**
 * Top navigation bar + mobile bottom tab bar + mobile drawer.
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const navUser = useNavUser();
  const displayName = navUser?.display_name ?? navUser?.username ?? "User";

  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/auth/login");
  }, [router]);

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">

          {/* Left: hamburger (mobile) + logo */}
          <div className="flex items-center gap-2">
            {/* Hamburger — mobile only */}
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 lg:hidden"
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <rect x="2" y="4"  width="16" height="2" rx="1" />
                <rect x="2" y="9"  width="16" height="2" rx="1" />
                <rect x="2" y="14" width="16" height="2" rx="1" />
              </svg>
            </button>

            <Link
              href="/home"
              className="text-lg font-bold text-primary-600 dark:text-primary-400"
            >
              Zobia
            </Link>
          </div>

          {/* Desktop nav links */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
            {bottomTabItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: notifications + avatar */}
          <div className="flex items-center gap-2">
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">🔔</span>
            </Link>
            <Link href="/profile" aria-label="Your profile">
              <Avatar name={displayName} size="sm" rankTier="none" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile nav drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pathname={pathname}
        displayName={displayName}
        onLogout={handleLogout}
      />

      {/* Mobile bottom tab bar */}
      <MobileTabBar />
    </>
  );
}
