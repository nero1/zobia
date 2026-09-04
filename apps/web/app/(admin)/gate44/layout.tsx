/**
 * app/(admin)/gate44/layout.tsx
 *
 * Staff management panel layout (moved off the guessable /admin path to
 * /gate44 — see middleware.ts ADMIN_PREFIXES).
 *
 * Access control: Route middleware validates the JWT and checks `is_admin`
 * from the database (not just from the JWT claim) via a DB query on each
 * admin request.  This layout provides the visual admin shell.
 *
 * Title/robots are deliberately generic — nothing here should tell an
 * unauthenticated visitor or a search engine that this is the admin area.
 */

import type { Metadata } from "next";
import { AdminLayoutShell } from "@/components/admin/AdminLayoutShell";

export const metadata: Metadata = {
  title: {
    default: "Zobia",
    template: "%s | Zobia",
  },
  robots: { index: false, follow: false },
};

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return <AdminLayoutShell>{children}</AdminLayoutShell>;
}
