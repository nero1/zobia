/**
 * app/not-found.tsx
 *
 * Custom 404 page — shown when Next.js cannot match a route.
 * When the user is authenticated the app Navbar is rendered so they keep
 * their logged-in context. When unauthenticated, a minimal header with
 * login / register CTAs is shown instead.
 */

import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { Navbar } from "@/components/layout/Navbar";
import { NotFoundBody } from "@/components/system/NotFoundBody";

export const metadata: Metadata = {
  title: "Page Not Found – Zobia Social",
  description: "The page you were looking for could not be found.",
};

async function isAuthenticated(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("zobia_at")?.value;
    if (!token) return false;
    await verifyAccessToken(token);
    return true;
  } catch {
    return false;
  }
}

export default async function NotFound() {
  const loggedIn = await isAuthenticated();

  return (
    <main className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Header — authenticated users get the full Navbar; guests get login links */}
      {loggedIn ? (
        <Navbar />
      ) : (
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
      )}

      {/* Body */}
      <NotFoundBody loggedIn={loggedIn} />
      <div className="flex flex-1 flex-col items-center px-6 pb-24 text-center -mt-16">
        {/* Quick links */}
        <div className="mt-10">
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Or try one of these pages:
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {(loggedIn
              ? [
                  { href: "/home", label: "Home Feed" },
                  { href: "/rooms", label: "Rooms" },
                  { href: "/messages", label: "Messages" },
                  { href: "/events", label: "Events" },
                  { href: "/leaderboards", label: "Leaderboards" },
                  { href: "/guilds", label: "Guilds" },
                ]
              : [
                  { href: "/home", label: "Home Feed" },
                  { href: "/rooms", label: "Rooms" },
                  { href: "/events", label: "Events" },
                  { href: "/leaderboards", label: "Leaderboards" },
                  { href: "/terms", label: "Terms of Service" },
                  { href: "/privacy", label: "Privacy Policy" },
                ]
            ).map((link) => (
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
            <Link
              href="/terms"
              className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Privacy Policy
            </Link>
          </div>
          &copy; {new Date().getFullYear()} Zobia Social. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
