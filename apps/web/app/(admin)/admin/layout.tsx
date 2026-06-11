/**
 * app/(admin)/admin/layout.tsx
 *
 * Admin panel layout.
 *
 * Access control: Route middleware validates the JWT and checks `is_admin`
 * from the database (not just from the JWT claim) via a DB query on each
 * admin request.  This layout provides the visual admin shell.
 */

import type { Metadata } from "next";
import { AdminLayoutShell } from "@/components/admin/AdminLayoutShell";

export const metadata: Metadata = {
  title: {
    default: "Admin Panel",
    template: "%s | Zobia Admin",
  },
};

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return <AdminLayoutShell>{children}</AdminLayoutShell>;
}
