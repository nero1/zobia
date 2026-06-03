/**
 * app/(app)/layout.tsx
 *
 * Authenticated application layout.
 *
 * Wraps all app pages (home, rooms, messages, profile) with:
 *   - Top navigation bar
 *   - Desktop sidebar
 *   - Offline banner
 *
 * Authentication is enforced at the middleware layer (middleware.ts).
 * This layout assumes the user is already authenticated.
 */

import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { AnnouncementModal } from "@/components/announcements/AnnouncementModal";
import { NudgeBanner } from "@/components/NudgeBanner";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Authenticated app shell layout.
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Offline indicator */}
      <OfflineBanner />
      {/* Announcement banner (admin-managed, fixed top) */}
      <AnnouncementBanner banner={null} />
      {/* Login-event announcement modal */}
      <AnnouncementModal modal={null} />

      {/* Top navigation */}
      <Navbar />

      <div className="flex">
        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:ml-64 lg:px-8">
          <div className="mx-auto max-w-3xl space-y-3">
            {/* Account recovery nudge (shown when no email set) */}
            <NudgeBanner hasEmail={false} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
