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

      {/* Top navigation */}
      <Navbar />

      <div className="flex">
        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:ml-64 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
