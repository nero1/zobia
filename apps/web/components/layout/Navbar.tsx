/**
 * components/layout/Navbar.tsx
 *
 * Top navigation bar for the authenticated app.
 * - Fixed top bar (all screen sizes)
 * - Mobile hamburger that opens a full nav drawer
 * - Mobile bottom tab bar (Home, Quests, Messages, Friends, Wallet, Profile)
 * - Profile avatar dropdown (top right, all screen sizes)
 *
 * NO purple colors. NO gradients.
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";

interface NavUser {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  plan?: string | null;
  is_admin?: boolean;
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
  { href: "/home",    label: "Home",    shortLabel: "Home"   },
  { href: "/quests",  label: "Quests",  shortLabel: "Quests" },
  { href: "/games",   label: "Games",   shortLabel: "Games"  },
  { href: "/friends", label: "Friends", shortLabel: "Friends"},
  { href: "/wallet",  label: "Wallet",  shortLabel: "Wallet" },
  { href: "/profile", label: "Profile", shortLabel: "Profile"},
] as const;

// Full nav for desktop + drawer
const primaryNavItems = [
  { href: "/home",         label: "Home",         icon: "🏠" },
  { href: "/moments",      label: "Moments",      icon: "⚡" },
  { href: "/answers",      label: "Answers",      icon: "❓" },
  { href: "/quests",       label: "Quests",       icon: "🎯" },
  { href: "/games",        label: "Games",        icon: "🎮" },
  { href: "/blogs",        label: "Blogs",        icon: "📝" },
  { href: "/business",     label: "Business",     icon: "🏢" },
  { href: "/ads",          label: "Ads",           icon: "📢" },
  { href: "/rooms",        label: "Rooms",        icon: "🚪" },
  { href: "/messages",     label: "Messages",     icon: "💬" },
  { href: "/friends",      label: "Friends",      icon: "👥" },
  { href: "/gifts",        label: "Gifts",        icon: "🎁" },
  { href: "/wallet",       label: "Wallet",       icon: "🪙" },
  { href: "/notifications",label: "Notifications",icon: "🔔" },
  { href: "/events",       label: "Events",       icon: "📅" },
  { href: "/inbox",        label: "Inbox",        icon: "📬" },
  { href: "/elder",        label: "Elder",        icon: "🎓" },
  { href: "/referrals",    label: "Referrals",    icon: "🔗" },
  { href: "/classroom",    label: "Classroom",    icon: "🏫" },
  { href: "/leaderboards", label: "Leaderboards", icon: "🏆" },
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
  Home:    { active: "🏠", inactive: "🏡" },
  Quests:  { active: "🎯", inactive: "🎯" },
  Games:   { active: "🎮", inactive: "🕹️" },
  Friends: { active: "👥", inactive: "👥" },
  Wallet:  { active: "🪙", inactive: "🪙" },
  Profile: { active: "👤", inactive: "👤" },
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
// Plan badge helpers
// ---------------------------------------------------------------------------

const PLAN_BADGE: Record<string, string> = {
  free:  "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  plus:  "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pro:   "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  max:   "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

function planBadgeClass(plan: string | null | undefined) {
  return PLAN_BADGE[(plan ?? "free").toLowerCase()] ?? PLAN_BADGE.free;
}

function isMaxPlan(plan: string | null | undefined) {
  return (plan ?? "").toLowerCase() === "max";
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
      <div className="grid grid-cols-6">
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
              <span className="text-[9px] leading-none">{item.shortLabel}</span>
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
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  displayName: string;
  onLogout: () => void;
  isAdmin?: boolean;
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
            {isAdmin && (
              <Link
                href="/admin"
                onClick={onClose}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
                aria-current={pathname.startsWith("/admin") ? "page" : undefined}
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">🛡️</span>
                Admin
              </Link>
            )}
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
// Profile dropdown
// ---------------------------------------------------------------------------

function ProfileDropdown({
  user,
  onLogout,
}: {
  user: NavUser | null;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const displayName = user?.display_name ?? user?.username ?? "User";
  const username = user?.username ?? "";
  const plan = (user?.plan ?? "free").toLowerCase();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleThemeToggle = useCallback(() => {
    // Toggle between light / dark / system by cycling through them
    const root = document.documentElement;
    const current = root.classList.contains("dark") ? "dark" : "light";
    if (current === "dark") {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  }, []);

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Your profile"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
      >
        <Avatar name={displayName} emoji={user?.avatar_emoji ?? undefined} size="sm" rankTier="none" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          role="menu"
          aria-label="Profile menu"
        >
          {/* User info header */}
          <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {displayName}
            </p>
            {username && (
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                @{username}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", planBadgeClass(plan))}>
                {plan}
              </span>
              <Link
                href="/settings/subscription"
                onClick={() => setOpen(false)}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                Manage Plan
              </Link>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1" role="none">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">👤</span>
              View Profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">⚙️</span>
              Profile Settings
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={handleThemeToggle}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
              {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            </button>

            <Link
              href="/settings/subscription"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">⭐</span>
              {isMaxPlan(plan) ? `Manage ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan` : "Upgrade Plan"}
            </Link>
          </div>

          <div className="border-t border-neutral-100 py-1 dark:border-neutral-800" role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onLogout(); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              <span aria-hidden="true">🚪</span>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
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
  // Ref so touch handlers always see the latest open state without re-registering
  const drawerOpenRef = useRef(false);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/auth/login");
  }, [router]);

  // Left-edge swipe RIGHT to open drawer; LEFT swipe to close (mobile web / PWA)
  useEffect(() => {
    const EDGE_PX = 20;
    const MIN_SWIPE = 60;
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Activate if coming from left edge (to open) OR drawer is already open (to close)
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
        // Close on predominantly horizontal LEFT swipe
        if (dx < -MIN_SWIPE && dy < Math.abs(dx) * 0.75) {
          setDrawerOpen(false);
          touchStartX = null;
          touchStartY = null;
        }
      } else {
        // Open on predominantly horizontal RIGHT swipe from left edge
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
  }, []); // Registered once; drawerOpenRef provides up-to-date state

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

          {/* Desktop nav links — uses bottomTabItems to stay in sync with the mobile bottom bar */}
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

          {/* Right: notifications + profile dropdown */}
          <div className="flex items-center gap-2">
            {navUser?.is_admin && (
              <Link
                href="/admin"
                aria-label="Admin panel"
                className={clsx(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
              >
                🛡️ Admin
              </Link>
            )}
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">🔔</span>
            </Link>
            <ProfileDropdown user={navUser} onLogout={handleLogout} />
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
        isAdmin={navUser?.is_admin}
      />

      {/* Mobile bottom tab bar */}
      <MobileTabBar />
    </>
  );
}
