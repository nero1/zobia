"use client";

/**
 * app/(admin)/gate44/answers/layout.tsx
 *
 * Shared tab bar for the Answers admin area. Previously each tab
 * (Dashboard/Queue/Posts/Settings) was a standalone page with no way back
 * to the other tabs except the browser back button — this persistent layout
 * fixes that by rendering the tab bar around every nested page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/gate44/answers", label: "Overview", exact: true },
  { href: "/gate44/answers/queue", label: "Moderation Queue" },
  { href: "/gate44/answers/posts", label: "Manage Posts" },
  { href: "/gate44/answers/settings", label: "Settings" },
];

export default function AnswersAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
