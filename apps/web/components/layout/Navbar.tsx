/**
 * components/layout/Navbar.tsx
 *
 * Top navigation bar for the authenticated app.
 * Displays the Zobia logo, mobile bottom nav shortcut links, and user avatar.
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

const navItems = [
  { href: "/(app)/home", label: "Home", shortLabel: "Home" },
  { href: "/(app)/rooms", label: "Rooms", shortLabel: "Rooms" },
  { href: "/(app)/messages", label: "Messages", shortLabel: "Msgs" },
  { href: "/(app)/profile", label: "Profile", shortLabel: "Profile" },
] as const;

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
      <div className="grid grid-cols-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 py-3 text-xs font-medium transition-colors",
                isActive
                  ? "text-primary-600 dark:text-primary-400"
                  : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <NavIcon label={item.label} isActive={isActive} />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Simple icon map (using text symbols – replace with icon library later)
// ---------------------------------------------------------------------------

function NavIcon({ label, isActive }: { label: string; isActive: boolean }) {
  const icons: Record<string, { active: string; inactive: string }> = {
    Home:     { active: "⬛", inactive: "⬜" },
    Rooms:    { active: "🏠", inactive: "🏡" },
    Messages: { active: "💬", inactive: "💭" },
    Profile:  { active: "👤", inactive: "👤" },
  };
  const icon = icons[label];
  return (
    <span className="text-lg leading-none" aria-hidden="true">
      {isActive ? icon?.active : icon?.inactive}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Top nav bar
// ---------------------------------------------------------------------------

/**
 * Top navigation bar component.
 * Visible on all screen sizes; desktop also shows the sidebar.
 */
export function Navbar() {
  const pathname = usePathname();

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Logo */}
          <Link
            href="/(app)/home"
            className="text-lg font-bold text-primary-600 dark:text-primary-400"
          >
            Zobia
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
            {navItems.map((item) => {
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
            {/* Notification bell placeholder */}
            <button
              type="button"
              aria-label="Notifications"
              className="relative rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">🔔</span>
            </button>

            {/* User avatar */}
            <Link href="/(app)/profile" aria-label="Your profile">
              <Avatar name="User" size="sm" rankTier="none" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <MobileTabBar />
    </>
  );
}
