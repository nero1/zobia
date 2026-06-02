/**
 * app/(app)/profile/page.tsx
 *
 * Authenticated user profile page (placeholder).
 * Will display the current user's profile with stats and posts.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
};

/**
 * Profile page placeholder.
 */
export default function ProfilePage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Profile
      </h1>

      {/* Profile header */}
      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-4">
          {/* Avatar placeholder */}
          <div className="h-20 w-20 rounded-full bg-primary-100 ring-2 ring-primary-500 dark:bg-primary-900" />
          <div className="flex-1">
            <div className="h-6 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="mt-2 h-4 w-24 rounded bg-neutral-100 dark:bg-neutral-800" />
            <div className="mt-4 flex gap-6 text-sm text-neutral-500">
              <span><strong className="text-neutral-900 dark:text-neutral-50">0</strong> Followers</span>
              <span><strong className="text-neutral-900 dark:text-neutral-50">0</strong> Following</span>
              <span><strong className="text-neutral-900 dark:text-neutral-50">0</strong> Posts</span>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit profile
          </button>
        </div>
      </div>

      {/* Posts placeholder */}
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">
          Your posts will appear here.
        </p>
      </div>
    </div>
  );
}
