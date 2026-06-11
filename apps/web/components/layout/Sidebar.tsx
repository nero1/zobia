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
import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";

interface SidebarUser {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  plan?: string | null;
  is_admin?: boolean;
}

function useSidebarUser() {
  const [user, setUser] = useState<SidebarUser | null>(null);
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json) setUser(json.user ?? json); })
      .catch(() => {});
  }, []);
  return user;
}

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const primaryNavItems = [
  { href: "/home", label: "Home" },
  { href: "/quests", label: "Quests" },
  { href: "/rooms", label: "Rooms" },
  { href: "/messages", label: "Messages" },
  { href: "/friends", label: "Friends" },
  { href: "/notifications", label: "Notifications" },
  { href: "/events", label: "Events" },
  { href: "/wallet", label: "Wallet" },
  { href: "/inbox", label: "Inbox" },
  { href: "/elder", label: "Elder" },
  { href: "/referrals", label: "Referrals" },
  { href: "/classroom", label: "Classroom" },
  { href: "/leaderboards", label: "Leaderboards" },
] as const;

const secondaryNavItems = [
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
] as const;

// ---------------------------------------------------------------------------
// Sidebar nav link
// ---------------------------------------------------------------------------

function SidebarLink({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
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
      <span className="w-5 text-center text-base leading-none" aria-hidden="true">
        {navIcon(label)}
      </span>
      {label}
    </Link>
  );
}

function navIcon(label: string): string {
  const map: Record<string, string> = {
    Admin: "🛡️",
    Home: "🏠",
    Quests: "🎯",
    Rooms: "🚪",
    Messages: "💬",
    Friends: "👥",
    Notifications: "🔔",
    Events: "📅",
    Wallet: "🪙",
    Inbox: "📬",
    Elder: "🎓",
    Referrals: "🔗",
    Classroom: "🏫",
    Leaderboards: "🏆",
    Rankings: "🏆",
    Search: "🔍",
    Profile: "👤",
    Settings: "⚙️",
  };
  return map[label] ?? "•";
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
  const user = useSidebarUser();

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
              href="/admin"
              label="Admin"
              isActive={pathname.startsWith("/admin")}
            />
          )}
          {primaryNavItems.map((item) => (
            <SidebarLink
              key={item.href}
              href={item.href}
              label={item.label}
              isActive={pathname.startsWith(item.href)}
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
                isActive={pathname.startsWith(item.href)}
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
