"use client";

/**
 * components/layout/AppContentShell.tsx
 *
 * Decides how the authenticated app content area is laid out, based on the
 * current route.
 *
 * Most pages (feeds, profile, settings, …) render inside a centered, padded
 * `max-w-3xl` column. Real-time chat surfaces (room / DM / group conversation
 * pages) instead need a full-bleed, fixed-height shell so the message feed can
 * scroll internally and the composer stays pinned to the bottom.
 *
 * Previously the chat pages set their own `h-[100dvh]` while nested inside the
 * padded container AND below the 56px sticky top bar — the result overflowed
 * the viewport (content "extended outside the screen") and pushed the input
 * bar off-screen on mobile + PWA. Here we give chat routes a height of
 * `100dvh − header` and reserve space for the mobile bottom tab bar, and the
 * chat pages themselves use `h-full` to fill it.
 */

import { usePathname } from "next/navigation";
import { NudgeBanner } from "@/components/NudgeBanner";

// Route patterns for full-screen chat surfaces. Detail conversation views only —
// the list pages (/rooms, /messages, /messages/groups) and create/sub pages keep
// the standard padded layout.
const CHAT_ROUTE_PATTERNS: RegExp[] = [
  /^\/rooms\/(?!create$)[^/]+$/, // /rooms/:roomId
  /^\/messages\/(?!groups$)[^/]+$/, // /messages/:conversationId
  /^\/messages\/groups\/(?!create$)[^/]+$/, // /messages/groups/:groupId
];

interface AppContentShellProps {
  children: React.ReactNode;
  /** Whether the user has a recovery email — drives the NudgeBanner. */
  hasEmail: boolean;
}

export function AppContentShell({ children, hasEmail }: AppContentShellProps) {
  const pathname = usePathname() ?? "";
  const isChatRoute = CHAT_ROUTE_PATTERNS.some((re) => re.test(pathname));

  if (isChatRoute) {
    return (
      <div className="min-w-0 flex-1 lg:ml-64">
        {/* Fill the viewport below the sticky 56px (h-14) top bar. `pb-14`
            clears the fixed mobile bottom tab bar; removed on desktop where
            there is no bottom bar. overflow-hidden keeps the internal feed the
            only scroll container, which is what makes the composer stay put. */}
        <div className="h-[calc(100dvh-3.5rem)] overflow-hidden pb-14 lg:pb-0">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 lg:ml-64 lg:px-8 lg:pb-6">
      <div className="mx-auto max-w-3xl space-y-3">
        {/* Account recovery nudge (shown when user has no email) */}
        <NudgeBanner hasEmail={hasEmail} />
        {children}
      </div>
    </div>
  );
}
