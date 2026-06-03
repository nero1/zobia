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
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const primaryNavItems = [
  { href: "/home", label: "Home" },
  { href: "/rooms", label: "Rooms" },
  { href: "/messages", label: "Messages" },
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
    Home: "🏠",
    Rooms: "🚪",
    Messages: "💬",
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

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-neutral-200 bg-white pt-14 dark:border-neutral-800 dark:bg-neutral-900 lg:flex"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        {/* Primary navigation */}
        <nav className="space-y-0.5">
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
              <Avatar name="User" size="sm" rankTier="none" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  Your Name
                </p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  @username
                </p>
              </div>
            </div>
            <form action="/api/auth/logout" method="POST" className="mt-2">
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-danger-600 transition-colors hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
