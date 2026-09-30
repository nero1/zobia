/**
 * app/loading.tsx
 *
 * Root streaming fallback. Every route sits under async server layouts that
 * await the manifest / DB (see app/layout.tsx and app/(app)/layout.tsx), so
 * without a fallback the browser has nothing meaningful to paint while those
 * resolve on a slow connection, leaving a blank page. This gives Next a
 * Suspense boundary to flush immediately and a branded spinner to show.
 */

export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-primary-600 dark:border-neutral-800 dark:border-t-primary-400"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
