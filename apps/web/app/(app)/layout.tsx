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
import { PresenceHeartbeatProvider } from "@/components/presence/PresenceHeartbeatProvider";
import { AnnouncementBanner, type BannerData } from "@/components/announcements/AnnouncementBanner";
import { AnnouncementModal, type AnnouncementData } from "@/components/announcements/AnnouncementModal";
import { ActiveEventStrip } from "@/components/events/ActiveEventStrip";
import { PWAInstallPrompt } from "@/components/shared/PWAInstallPrompt";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { env } from "@/lib/env";
import { loadManifest } from "@/lib/manifest";
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
 * Resolve the active announcements for the current user, plus whether they
 * are staff (admin/moderator) — the only visitors exempt from maintenance
 * mode. Returns nulls/false gracefully if the JWT is missing, invalid, or
 * DB calls fail.
 */
async function resolveAnnouncements(): Promise<{
  banner: BannerData | null;
  modal: AnnouncementData | null;
  hasEmail: boolean;
  isStaff: boolean;
}> {
  if (!env.DATABASE_PROVIDER) {
    return { banner: null, modal: null, hasEmail: true, isStaff: false };
  }
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("zobia_at")?.value;
    if (!accessToken) return { banner: null, modal: null, hasEmail: true, isStaff: false };

    const payload = await verifyAccessToken(accessToken);
    const userId = payload.sub;
    const hasEmail = !!payload.email;
    const isStaff = !!payload.is_admin || !!payload.is_moderator;
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

    return { banner, modal, hasEmail, isStaff };
  } catch {
    return { banner: null, modal: null, hasEmail: true, isStaff: false };
  }
}

/**
 * Authenticated app shell layout.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const [{ banner, modal, hasEmail, isStaff }, manifest] = await Promise.all([
    resolveAnnouncements(),
    loadManifest(),
  ]);

  // Maintenance mode (x_manifest maintenance_mode_enabled, set at
  // /gate44/config): everyone except admins/moderators sees the notice
  // instead of the app. Staff still get the full shell plus a reminder bar
  // (AdminLayoutShell) so they don't forget it's on.
  if (manifest.maintenance.enabled && !isStaff) {
    return <MaintenancePage message={manifest.maintenance.message} />;
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Offline indicator and queue sync */}
      <OfflineBanner />
      <OfflineSyncProvider />
      {/* Presence heartbeat — keeps last_active_at / online status warm app-wide */}
      <PresenceHeartbeatProvider />
      {/* Session-expired notice is mounted globally in the root layout (app/layout.tsx)
          so it also covers standalone routes like /g/<slug>/play. */}
      {/* Announcement banner (admin-managed, fixed top) */}
      <AnnouncementBanner banner={banner} />
      {/* Login-event announcement modal */}
      <AnnouncementModal announcement={modal} />
      {/* PWA / Android app install prompt */}
      <PWAInstallPrompt />

      {/* Top navigation */}
      <Navbar />

      {/* Platform event promo strip / new-event popup — near the top of every app page */}
      <ActiveEventStrip />

      <div className="flex">
        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main content — full-bleed for chat routes, padded column otherwise */}
        <AppContentShell hasEmail={hasEmail}>{children}</AppContentShell>
      </div>
    </div>
  );
}
