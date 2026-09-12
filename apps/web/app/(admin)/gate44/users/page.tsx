"use client";

/**
 * app/(admin)/gate44/users/page.tsx
 *
 * Admin user management page.
 *
 * Thin wrapper around the shared components/admin/UserManagementTable —
 * extracted so the same search/list/detail/impersonate/suspend/ban UI can
 * also be embedded in the Users tab of /gate44/data-management. This page's
 * own behavior is unchanged: no selection checkboxes, no delete action
 * (`embedded` defaults to false).
 */

import UserManagementTable from "@/components/admin/UserManagementTable";

export default function AdminUsersPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">User Management</h1>
      <UserManagementTable />
    </div>
  );
}
