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

import { cookies, headers } from "next/headers";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppContentShell } from "@/components/layout/AppContentShell";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { OfflineSyncProvider } from "@/components/offline/OfflineSyncProvider";
import { PresenceHeartbeatProvider } from "@/components/presence/PresenceHeartbeatProvider";
import { LoginStreakProvider } from "@/components/streaks/LoginStreakProvider";
import { AnnouncementBanner, type BannerData } from "@/components/announcements/AnnouncementBanner";
import { AnnouncementModal, type AnnouncementData } from "@/components/announcements/AnnouncementModal";
import { ActiveEventStrip } from "@/components/events/ActiveEventStrip";
import { PWAInstallPrompt } from "@/components/shared/PWAInstallPrompt";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";
import { NotFoundBody } from "@/components/system/NotFoundBody";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { env } from "@/lib/env";
import { loadManifest } from "@/lib/manifest";
import { resolveFeatureGate, isFeatureAccessible } from "@/lib/manifest/featureAccess";
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
async function resolveAnnouncements(checkCouncilMembership: boolean): Promise<{
  banner: BannerData | null;
  modal: AnnouncementData | null;
  hasEmail: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  isCouncilMember: boolean;
}> {
  if (!env.DATABASE_PROVIDER) {
    return { banner: null, modal: null, hasEmail: true, isStaff: false, isAdmin: false, isModerator: false, isCouncilMember: false };
  }
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("zobia_at")?.value;
    if (!accessToken) return { banner: null, modal: null, hasEmail: true, isStaff: false, isAdmin: false, isModerator: false, isCouncilMember: false };

    const payload = await verifyAccessToken(accessToken);
    const userId = payload.sub;
    const hasEmail = !!payload.email;
    const isAdmin = !!payload.is_admin;
    const isModerator = !!payload.is_moderator;
    const isStaff = isAdmin || isModerator;
    const announcementUser = {
      id: userId,
      plan_id: null as string | null,
      role: null as string | null,
    };

    const [resolvedBanner, resolvedModal, councilRows] = await Promise.all([
      getActiveBannerForUser(userId, announcementUser, db).catch(() => null),
      getActiveModalForUser(userId, announcementUser, db).catch(() => null),
      // Only queried when the current route is actually gated by council
      // membership (see FEATURE_ROUTES below) — keeps this off every other page.
      checkCouncilMembership
        ? db.query<{ is_member: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM platform_council_members WHERE user_id = $1 AND left_at IS NULL) AS is_member`,
            [userId]
          ).catch(() => ({ rows: [{ is_member: false }] }))
        : Promise.resolve({ rows: [{ is_member: false }] }),
    ]);
    const isCouncilMember = !!councilRows.rows[0]?.is_member;

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

    return { banner, modal, hasEmail, isStaff, isAdmin, isModerator, isCouncilMember };
  } catch {
    return { banner: null, modal: null, hasEmail: true, isStaff: false, isAdmin: false, isModerator: false, isCouncilMember: false };
  }
}

/**
 * Authenticated app shell layout.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  // Feature-flag page gate: a disabled feature's URL visited directly (nav
  // links already hide themselves) renders a plain 404 — no mention that a
  // feature is disabled, no admin-only exception disclosed. Admins always
  // pass; moderators pass only when the flag is on the admin-managed
  // mod-visibility allow-list (/gate44/feature-flags).
  const pathname = (await headers()).get("x-pathname") ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const gateKey = resolveFeatureGate(segments);

  const [{ banner, modal, hasEmail, isStaff, isAdmin, isModerator, isCouncilMember }, manifest] = await Promise.all([
    resolveAnnouncements(gateKey === "platformCouncil"),
    loadManifest(),
  ]);

  // Maintenance mode (x_manifest maintenance_mode_enabled, set at
  // /gate44/config): everyone except admins/moderators sees the notice
  // instead of the app. Staff still get the full shell plus a reminder bar
  // (AdminLayoutShell) so they don't forget it's on.
  if (manifest.maintenance.enabled && !isStaff) {
    return <MaintenancePage message={manifest.maintenance.message} />;
  }

  if (gateKey) {
    const enabled = manifest.features[gateKey] as boolean | undefined;
    const modVisible = manifest.featureModVisibility.includes(gateKey);
    // Platform Council is stricter than the generic flag gate: only an
    // active council seat or an admin may view it, even while the flag is
    // on — moderators get no mod-visibility exception here (see PRD §15).
    const accessible =
      gateKey === "platformCouncil"
        ? isAdmin || (enabled !== false && isCouncilMember)
        : enabled !== false || isFeatureAccessible(false, modVisible, { isAdmin, isModerator });
    if (!accessible) {
      return (
        <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
          <Navbar />
          <NotFoundBody />
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Offline indicator and queue sync */}
      <OfflineBanner />
      <OfflineSyncProvider />
      {/* Presence heartbeat — keeps last_active_at / online status warm app-wide */}
      <PresenceHeartbeatProvider />
      {/* Records today's login (streak, XP, quest progress) once per day */}
      <LoginStreakProvider />
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
