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
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/Avatar";
import { useUnreadNotificationsCount } from "@/lib/notifications/useUnreadCount";
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess, type FeatureFlags } from "@/lib/hooks/useFeatureFlags";

interface NavUser {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  plan?: string | null;
  is_admin?: boolean;
  is_moderator?: boolean;
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

// `labelKey`/`shortLabelKey` are i18n keys (not literal strings), resolved via
// t() at render time so a non-English viewer sees a translated nav, not the
// key names below (matches the equivalent fix in apps/android's TopBar/BottomNav).
const bottomTabItems = [
  { href: "/home",    label: "Home",    shortLabelKey: "nav.home"    },
  { href: "/quests",  label: "Quests",  shortLabelKey: "nav.quests"  },
  { href: "/games",   label: "Games",   shortLabelKey: "nav.games"   },
  { href: "/friends", label: "Friends", shortLabelKey: "nav.friends" },
  { href: "/wallet",  label: "Wallet",  shortLabelKey: "nav.wallet"  },
  { href: "/profile", label: "Profile", shortLabelKey: "nav.profile" },
] as const;

interface PrimaryNavItem {
  href: string;
  labelKey: string;
  icon: string;
  /** When set, hides this entry from non-admins if the flag is off (see useFeatureFlags). */
  flagKey?: keyof FeatureFlags;
}

// Full nav for desktop + drawer
const primaryNavItems: PrimaryNavItem[] = [
  { href: "/home",         labelKey: "nav.home",         icon: "🏠" },
  { href: "/moments",      labelKey: "nav.moments",      icon: "⚡", flagKey: "moments" },
  { href: "/answers",      labelKey: "nav.answers",      icon: "❓", flagKey: "forum" },
  { href: "/forum",        labelKey: "nav.bbforum",      icon: "🗨️", flagKey: "bbforum" },
  { href: "/quests",       labelKey: "nav.quests",       icon: "🎯" },
  { href: "/games",        labelKey: "nav.games",        icon: "🎮", flagKey: "games" },
  { href: "/blogs",        labelKey: "nav.blogs",        icon: "📝", flagKey: "blogs" },
  { href: "/business",     labelKey: "nav.business",     icon: "🏢", flagKey: "businessAccounts" },
  { href: "/ads",          labelKey: "nav.ads",          icon: "📢", flagKey: "adsSystem" },
  { href: "/rooms",        labelKey: "nav.rooms",        icon: "🚪", flagKey: "rooms" },
  { href: "/guilds",       labelKey: "nav.guilds",       icon: "🏰" },
  { href: "/messages",     labelKey: "nav.messages",     icon: "💬" },
  { href: "/friends",      labelKey: "nav.friends",      icon: "👥" },
  { href: "/gifts",        labelKey: "nav.gifts",        icon: "🎁", flagKey: "gifts" },
  { href: "/wallet",       labelKey: "nav.wallet",       icon: "🪙" },
  { href: "/notifications",labelKey: "nav.notifications",icon: "🔔" },
  { href: "/events",       labelKey: "nav.events",       icon: "📅" },
  { href: "/inbox",        labelKey: "nav.inbox",        icon: "📬" },
  { href: "/elder",        labelKey: "nav.elder",        icon: "🎓" },
  { href: "/referrals",    labelKey: "nav.referrals",    icon: "🔗" },
  { href: "/classroom",    labelKey: "nav.classroom",    icon: "🏫", flagKey: "classrooms" },
  { href: "/leaderboards", labelKey: "nav.leaderboards", icon: "🏆", flagKey: "rankings" },
  { href: "/seasons",      labelKey: "nav.seasons",      icon: "🗓️" },
];

const secondaryNavItems = [
  { href: "/profile",  labelKey: "nav.profile",  icon: "👤" },
  { href: "/settings", labelKey: "nav.settings", icon: "⚙️" },
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
  const { t } = useTranslation();
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
              <span className="text-[9px] leading-none">{t(item.shortLabelKey)}</span>
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
  isModerator,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  displayName: string;
  onLogout: () => void;
  isAdmin?: boolean;
  isModerator?: boolean;
}) {
  const { t } = useTranslation();
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Hide nav entries for features an admin turned off. Admins always still
  // see the entry (with a small "off" indicator); moderators do too, but
  // only when the flag is on the admin-managed mod-visibility allow-list.
  const visibleNavItems = primaryNavItems.filter((item) => {
    if (!item.flagKey) return true;
    const access = resolveFeatureAccess(
      featureFlags[item.flagKey] !== false,
      modVisibleKeys.includes(item.flagKey as string),
      { isAdmin, isModerator }
    );
    return access.accessible;
  });

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
          aria-label={t("nav.closeMenu")}
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <span aria-hidden="true" className="text-xl leading-none">✕</span>
        </button>

        <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
          {/* Primary nav */}
          <nav className="space-y-0.5" aria-label="Primary">
            {isAdmin && (
              <Link
                href="/gate44"
                onClick={onClose}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname.startsWith("/gate44")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
                aria-current={pathname.startsWith("/gate44") ? "page" : undefined}
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">🛡️</span>
                {t("admin.link")}
              </Link>
            )}
            {(isModerator || isAdmin) && (
              <Link
                href="/moderation"
                onClick={onClose}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname.startsWith("/moderation")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
                aria-current={pathname.startsWith("/moderation") ? "page" : undefined}
              >
                <span className="w-5 text-center text-base leading-none" aria-hidden="true">🧭</span>
                {t("moderation.title", "Moderation Center")}
              </Link>
            )}
            {visibleNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const isOffForUsers = !!item.flagKey && featureFlags[item.flagKey] === false;
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
                  {t(item.labelKey)}
                  {isOffForUsers && (
                    <span title="Disabled for regular users" className="ml-auto text-xs text-amber-500">⚠️</span>
                  )}
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
                  {t(item.labelKey)}
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
            🚪 {t("nav.logout")}
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
  const { t } = useTranslation();
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
        aria-label={t("nav.userArea")}
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
          aria-label={t("nav.userArea")}
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
                {t("profile.dropdown.managePlan")}
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
              {t("profile.dropdown.viewProfile")}
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">⚙️</span>
              {t("profile.dropdown.profileSettings")}
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={handleThemeToggle}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
              {isDark ? t("profile.dropdown.themeLight") : t("profile.dropdown.themeDark")}
            </button>

            <Link
              href="/settings/subscription"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">⭐</span>
              {isMaxPlan(plan) ? t("profile.dropdown.managePlanNamed", { plan: plan.charAt(0).toUpperCase() + plan.slice(1) }) : t("profile.dropdown.upgradePlan")}
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
              {t("nav.logout")}
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
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const navUser = useNavUser();
  const displayName = navUser?.display_name ?? navUser?.username ?? "User";
  const unreadCount = useUnreadNotificationsCount();

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
      const touch = e.touches[0];
      // Activate if coming from left edge (to open) OR drawer is already open (to close)
      if (touch.clientX <= EDGE_PX || drawerOpenRef.current) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      } else {
        touchStartX = null;
        touchStartY = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX === null || touchStartY === null) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = Math.abs(touch.clientY - touchStartY);

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
              aria-label={t("nav.openMenu")}
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
                  {t(item.shortLabelKey)}
                </Link>
              );
            })}
          </nav>

          {/* Right: notifications + profile dropdown */}
          <div className="flex items-center gap-2">
            {navUser?.is_admin && (
              <Link
                href="/gate44"
                aria-label={t("admin.link")}
                className={clsx(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/gate44")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
              >
                🛡️ {t("admin.link")}
              </Link>
            )}
            {(navUser?.is_moderator || navUser?.is_admin) && (
              <Link
                href="/moderation"
                aria-label={t("moderation.title", "Moderation Center")}
                className={clsx(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/moderation")
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                )}
              >
                🧭 {t("moderation.title", "Moderation Center")}
              </Link>
            )}
            <Link
              href="/notifications"
              aria-label={unreadCount > 0 ? `${t("notifications.title")}, ${t("notifications.unread", { count: unreadCount })}` : t("notifications.title")}
              className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">🔔</span>
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white dark:ring-neutral-900"
                />
              )}
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
        isModerator={navUser?.is_moderator}
      />

      {/* Mobile bottom tab bar */}
      <MobileTabBar />
    </>
  );
}
