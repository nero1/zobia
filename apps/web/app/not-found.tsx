/**
 * app/not-found.tsx
 *
 * Custom 404 page – shown when Next.js cannot match a route.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found – Zobia Social",
  description: "The page you were looking for could not be found.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-xl font-bold text-primary-600 dark:text-primary-400"
          >
            Zobia Social
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/auth/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Log in
            </Link>
            <Link
              href="/auth/register"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 text-8xl font-extrabold text-neutral-200 dark:text-neutral-800 select-none">
          404
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-10 shadow-card dark:border-neutral-800 dark:bg-neutral-900 max-w-md w-full">
          <h1 className="mb-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Page Not Found
          </h1>
          <p className="mb-8 text-neutral-600 dark:text-neutral-400">
            The page you&apos;re looking for doesn&apos;t exist or has been moved. Let&apos;s
            get you back on track.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-elevated transition-colors hover:bg-primary-700"
            >
              Go back home
            </Link>
            <Link
              href="/auth/login"
              className="rounded-xl border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-700 shadow-card transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Log in
            </Link>
          </div>
        </div>

        {/* Quick links */}
        <div className="mt-10">
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Or try one of these pages:
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { href: "/home", label: "Home Feed" },
              { href: "/rooms", label: "Rooms" },
              { href: "/events", label: "Events" },
              { href: "/leaderboards", label: "Leaderboards" },
              { href: "/terms", label: "Terms of Service" },
              { href: "/privacy", label: "Privacy Policy" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 shadow-card transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-8 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <div className="mb-3 flex justify-center gap-6">
            <Link href="/terms" className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300">
              Privacy Policy
            </Link>
          </div>
          &copy; {new Date().getFullYear()} Zobia Social. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
