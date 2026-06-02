/**
 * app/(app)/home/page.tsx
 *
 * Home feed page (placeholder).
 * Will display the user's personalised activity feed.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * Home page placeholder.
 */
export default function HomePage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Home
      </h1>
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">
          Your feed will appear here. Follow people or join rooms to get started.
        </p>
      </div>
    </div>
  );
}
