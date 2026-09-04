/**
 * app/auth/login/page.tsx
 *
 * Server wrapper around the login form (components/auth/LoginPageClient.tsx).
 *
 * Maintenance mode (x_manifest maintenance_mode_enabled, set at
 * /gate44/config): while it's on, this page shows the maintenance notice
 * instead of the login form for everyone — UNLESS the request carries the
 * hidden `?staff=1` bypass, which is never linked from anywhere in the app
 * and not in the sitemap/robots.txt, so it only reaches people who already
 * know it exists. Reaching the form doesn't grant real access on its own:
 * a non-staff account that logs in this way still hits the same maintenance
 * notice post-login (see app/(app)/layout.tsx), so the bypass only actually
 * helps admins/moderators.
 */

import { LoginPageClient } from "@/components/auth/LoginPageClient";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";
import { loadManifest } from "@/lib/manifest";

interface LoginPageProps {
  searchParams: Promise<{ staff?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const isStaffBypass = params.staff === "1";

  if (!isStaffBypass) {
    const manifest = await loadManifest();
    if (manifest.maintenance.enabled) {
      return <MaintenancePage message={manifest.maintenance.message} />;
    }
  }

  return <LoginPageClient />;
}
