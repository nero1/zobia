/**
 * app/contact/page.tsx
 *
 * Site-wide Contact Us page — public, server-rendered shell around the
 * client SiteContactForm. Mirrors the routing convention of the other
 * public static pages at the site root (app/terms, app/privacy).
 */

import type { Metadata } from "next";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { db } from "@/lib/db";
import { SiteContactForm } from "@/components/contact/SiteContactForm";

export const metadata: Metadata = {
  title: "Contact Us – Zobia Social",
  description: "Get in touch with the Zobia Social team.",
};

export default async function ContactUsPage() {
  const viewer = await getOptionalServerUser();
  let contactViewer: { username: string } | null = null;
  if (viewer) {
    const { rows } = await db.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1 LIMIT 1`,
      [viewer.userId]
    );
    if (rows[0]) contactViewer = { username: rows[0].username };
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">Contact Us</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Questions, feedback, or need help? Send us a message and we&apos;ll get back to you.
        </p>
      </div>
      <SiteContactForm viewer={contactViewer} />
    </div>
  );
}
