/**
 * app/(app)/messages/page.tsx
 *
 * Direct messages inbox page (placeholder).
 * Will display the user's conversation list.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Messages",
};

/**
 * Messages page placeholder.
 */
export default function MessagesPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          Messages
        </h1>
        <button
          type="button"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          New message
        </button>
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">
          Your conversations will appear here.
        </p>
      </div>
    </div>
  );
}
