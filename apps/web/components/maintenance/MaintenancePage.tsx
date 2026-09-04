/**
 * components/maintenance/MaintenancePage.tsx
 *
 * Full-screen notice shown to non-staff visitors while maintenance mode is
 * on (x_manifest `maintenance_mode_enabled`, set at /gate44/config). Server
 * component — no client JS needed for a static notice.
 */

export function MaintenancePage({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 px-4 text-center dark:bg-neutral-950">
      <span className="text-5xl">🛠️</span>
      <h1 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">
        Zobia
      </h1>
      <p className="mt-3 max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
        {message}
      </p>
    </div>
  );
}
