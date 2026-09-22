"use client";

/**
 * app/(admin)/gate44/classrooms/page.tsx
 *
 * Staff queue for classroom community reports. Items with 3+ reports are
 * escalated here automatically; staff can also browse every pending or
 * resolved report across all classrooms. Moderators (not just admins) may
 * open this page (middleware FORUM_MOD_PREFIXES); the API re-checks the role
 * against the database (withModeratorOrAdminAuth).
 */

import { ReportsPanel } from "@/components/classroom/studio/ReportsPanel";

export default function AdminClassroomReportsPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Classroom Reports</h1>
        <p className="text-sm text-neutral-500">
          Classroom creators and their moderators handle their own report queues. Content reported by 3 or more members is escalated here.
        </p>
      </div>
      <ReportsPanel admin />
    </div>
  );
}
