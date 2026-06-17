/**
 * app/(app)/layout.tsx
 *
 * Authenticated application layout (server component).
 *
 * Wraps all app pages (home, rooms, messages, profile) with:
 *   - Top navigation bar
 *   - Desktop sidebar
 *   - Offline banner
 *   - Announcement banner & modal (resolved server-side per user)
 *
 * Authentication is enforced at the middleware layer (middleware.ts).
 * This layout assumes the user is already authenticated.
 */

export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppContentShell } from "@/components/layout/AppContentShell";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { OfflineSyncProvider } from "@/components/offline/OfflineSyncProvider";
import { AnnouncementBanner, type BannerData } from "@/components/announcements/AnnouncementBanner";
import { AnnouncementModal, type AnnouncementData } from "@/components/announcements/AnnouncementModal";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { env } from "@/lib/env";
import {
  getActiveBannerForUser,
  getActiveModalForUser,
  type ResolvedBanner,
  type ResolvedModal,
} from "@/lib/announcements/engine";
import { db } from "@/lib/db";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Resolve the active announcements for the current user.
 * Returns nulls gracefully if the JWT is missing, invalid, or DB calls fail.
 */
async function resolveAnnouncements(cookieHeader: string | null): Promise<{
  banner: BannerData | null;
  modal: AnnouncementData | null;
  hasEmail: boolean;
}> {
  if (!env.DATABASE_PROVIDER) {
    return { banner: null, modal: null, hasEmail: true };
  }
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("zobia_at")?.value;
    if (!accessToken) return { banner: null, modal: null, hasEmail: true };

    const payload = await verifyAccessToken(accessToken);
    const userId = payload.sub;
    const hasEmail = !!payload.email;
    const announcementUser = {
      id: userId,
      plan_id: null as string | null,
      role: null as string | null,
    };

    const [resolvedBanner, resolvedModal] = await Promise.all([
      getActiveBannerForUser(userId, announcementUser, db).catch(() => null),
      getActiveModalForUser(userId, announcementUser, db).catch(() => null),
    ]);

    const banner: BannerData | null = resolvedBanner
      ? {
          id: resolvedBanner.id,
          content: resolvedBanner.content,
          severity: "info" as const,
        }
      : null;

    const modal: AnnouncementData | null = resolvedModal
      ? {
          id: resolvedModal.id,
          title: resolvedModal.title,
          content: resolvedModal.content,
          startAt: resolvedModal.starts_at,
          endAt: resolvedModal.ends_at,
        }
      : null;

    return { banner, modal, hasEmail };
  } catch {
    return { banner: null, modal: null, hasEmail: true };
  }
}

/**
 * Authenticated app shell layout.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const { banner, modal, hasEmail } = await resolveAnnouncements(null);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Offline indicator and queue sync */}
      <OfflineBanner />
      <OfflineSyncProvider />
      {/* Announcement banner (admin-managed, fixed top) */}
      <AnnouncementBanner banner={banner} />
      {/* Login-event announcement modal */}
      <AnnouncementModal announcement={modal} />

      {/* Top navigation */}
      <Navbar />

      <div className="flex">
        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main content — full-bleed for chat routes, padded column otherwise */}
        <AppContentShell hasEmail={hasEmail}>{children}</AppContentShell>
      </div>
    </div>
  );
}
