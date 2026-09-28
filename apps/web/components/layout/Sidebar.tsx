/**
 * components/layout/Sidebar.tsx
 *
 * Desktop sidebar navigation for the authenticated app.
 * Hidden on mobile (where the bottom tab bar takes over).
 *
 * NO purple colors. NO gradients.
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess, type FeatureFlags } from "@/lib/hooks/useFeatureFlags";
import { useHasNewNotifications } from "@/lib/notifications/useHasNewNotifications";
import { useHasNewMessages, useHasNewAnnouncements } from "@/lib/notifications/useHasNewSince";
import { useUserProfile } from "@/lib/auth/hooks";

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

interface PrimaryNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** When set, hides this entry from non-admins if the flag is off (see useFeatureFlags). */
  flagKey?: keyof FeatureFlags;
  /**
   * Council-only gate: visible to admins always, and to everyone else only
   * once the flag is on AND they hold an active council seat. Unlike a plain
   * flagKey, moderators get no mod-visibility exception here (PRD §15 — the
   * council is for members and admins, not staff at large).
   */
  requiresCouncilMembership?: boolean;
}

const primaryNavItems: PrimaryNavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/moments", label: "Moments", icon: "moments", flagKey: "moments" },
  { href: "/tweets", label: "Tweets", icon: "tweets", flagKey: "tweets" },
  { href: "/answers", label: "Answers", icon: "answers", flagKey: "forum" },
  { href: "/forum", label: "Forum", icon: "forum", flagKey: "bbforum" },
  { href: "/quests", label: "Quests", icon: "quests" },
  { href: "/games", label: "Games", icon: "games", flagKey: "games" },
  { href: "/blogs", label: "Blogs", icon: "blogs", flagKey: "blogs" },
  { href: "/polls", label: "Polls", icon: "polls", flagKey: "polls" },
  { href: "/quizzes", label: "Quizzes", icon: "quizzes", flagKey: "quizzes" },
  { href: "/business", label: "Business", icon: "business", flagKey: "businessAccounts" },
  { href: "/ads", label: "Ads", icon: "ads", flagKey: "adsSystem" },
  { href: "/rooms", label: "Rooms", icon: "rooms", flagKey: "rooms" },
  { href: "/guilds", label: "Guilds", icon: "guilds" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/friends", label: "Friends", icon: "friends" },
  { href: "/gifts", label: "Gifts", icon: "gifts", flagKey: "gifts" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/announcements", label: "Announcements", icon: "announcements" },
  { href: "/elder", label: "Elder", icon: "elder" },
  { href: "/referrals", label: "Referrals", icon: "referrals" },
  { href: "/classroom", label: "Classroom", icon: "classroom", flagKey: "classrooms" },
  { href: "/leaderboards", label: "Leaderboards", icon: "leaderboards", flagKey: "rankings" },
  { href: "/council", label: "Council", icon: "council", flagKey: "platformCouncil", requiresCouncilMembership: true },
];

const secondaryNavItems: { href: string; label: string; icon: IconName }[] = [
  { href: "/profile", label: "Profile", icon: "profile" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

// ---------------------------------------------------------------------------
// Sidebar nav link
// ---------------------------------------------------------------------------

function SidebarLink({
  href,
  label,
  icon,
  isActive,
  isOffForUsers,
  hasNewDot,
}: {
  href: string;
  label: string;
  icon: IconName;
  isActive: boolean;
  isOffForUsers?: boolean;
  hasNewDot?: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 " +
              "dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="relative w-5 text-center text-base leading-none" aria-hidden="true">
        <Icon name={icon} />
        {hasNewDot && (
          <span className="absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-neutral-900" />
        )}
      </span>
      {label}
      {isOffForUsers && (
        <span title="Disabled for regular users" className="ml-auto">
          <Icon emoji="⚠️" className="text-xs text-amber-500" size={14} />
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * Desktop sidebar component.
 * Fixed position on the left; hidden on screens smaller than lg.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useUserProfile();
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const hasNewNotifications = useHasNewNotifications();
  const hasNewMessages = useHasNewMessages();
  const hasNewAnnouncements = useHasNewAnnouncements();
  const newDotHrefs: Record<string, boolean | undefined> = {
    "/notifications": hasNewNotifications,
    "/messages": hasNewMessages,
    "/announcements": hasNewAnnouncements,
  };
  const visibleNavItems = primaryNavItems.filter((item) => {
    if (item.requiresCouncilMembership) {
      if (user?.is_admin) return true;
      const enabled = !item.flagKey || featureFlags[item.flagKey] !== false;
      return enabled && !!user?.is_council_member;
    }
    if (!item.flagKey) return true;
    const access = resolveFeatureAccess(
      featureFlags[item.flagKey] !== false,
      modVisibleKeys.includes(item.flagKey as string),
      { isAdmin: !!user?.is_admin, isModerator: !!user?.is_moderator }
    );
    return access.accessible;
  });

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/auth/login");
  }, [router]);

  const displayName = user?.display_name ?? user?.username ?? "Your Name";
  const username = user?.username ?? "username";

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-neutral-200 bg-white pt-14 dark:border-neutral-800 dark:bg-neutral-900 lg:flex"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        {/* Primary navigation */}
        <nav className="space-y-0.5">
          {user?.is_admin && (
            <SidebarLink
              href="/gate44"
              label="Admin"
              icon="admin"
              isActive={pathname?.startsWith("/gate44") ?? false}
            />
          )}
          {(user?.is_moderator || user?.is_admin) && (
            <SidebarLink
              href="/watch56"
              label="Moderation"
              icon="moderation"
              isActive={pathname?.startsWith("/watch56") ?? false}
            />
          )}
          {visibleNavItems.map((item) => (
            <SidebarLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={pathname?.startsWith(item.href) ?? false}
              isOffForUsers={!!item.flagKey && featureFlags[item.flagKey] === false}
              hasNewDot={newDotHrefs[item.href]}
            />
          ))}
        </nav>

        {/* Bottom section: profile + settings + logout */}
        <div>
          <div className="mb-1 space-y-0.5">
            {secondaryNavItems.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={pathname?.startsWith(item.href) ?? false}
              />
            ))}
          </div>

          {/* User card */}
          <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center gap-3">
              <Avatar name={displayName} emoji={user?.avatar_emoji ?? undefined} size="sm" rankTier="none" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  {displayName}
                </p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  @{username}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
