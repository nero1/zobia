/**
 * app/layout.tsx
 *
 * Root layout for the Zobia Social web app.
 *
 * Provides:
 *   - ThemeProvider (next-themes) for dark/light mode
 *   - ReactQueryProvider with devtools
 *   - i18n initialisation
 *   - Global metadata and viewport settings
 *   - PWA per-platform toggle (PRD §3, §20, §22): conditionally includes
 *     <link rel="manifest"> based on x_manifest pwa.webEnabled flag at
 *     runtime. Uses generateMetadata() so the flag is evaluated per-request.
 */

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { FloatingNotificationProvider } from "@/components/providers/FloatingNotificationProvider";
import { ReferralCapture } from "@/components/referral/ReferralCapture";
import { SkipToMain } from "@/components/shared/SkipToMain";
import { SessionExpiredModal } from "@/components/auth/SessionExpiredModal";
import { loadManifest } from "@/lib/manifest";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getDir } from "@/lib/i18n/rtl";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/locales";

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// ---------------------------------------------------------------------------
// Dynamic Metadata (PRD §3 §20 §22 — PWA per-platform toggle)
// ---------------------------------------------------------------------------

/**
 * generateMetadata replaces the static `metadata` export so we can read the
 * admin-controlled pwa.webEnabled flag from x_manifest at request time and
 * conditionally include (or omit) the PWA manifest link.
 *
 * When pwa.webEnabled = FALSE the <link rel="manifest"> tag is omitted,
 * which prevents browsers from offering "Add to Home Screen" for the web app.
 */
export async function generateMetadata(): Promise<Metadata> {
  let pwaWebEnabled = true;
  try {
    const manifest = await loadManifest();
    pwaWebEnabled = manifest.pwa.webEnabled;
  } catch {
    // Manifest unavailable — default to PWA enabled
  }

  return {
    title: {
      default: "Zobia Social",
      template: "%s | Zobia Social",
    },
    description:
      "Zobia Social – Connect, engage, and belong. Discover rooms, chat with friends, and build your community.",
    keywords: ["social", "community", "chat", "rooms", "messaging"],
    authors: [{ name: "Zobia Social" }],
    creator: "Zobia Social",
    // Conditionally include manifest link based on admin toggle
    ...(pwaWebEnabled ? { manifest: "/manifest.webmanifest" } : {}),
    icons: {
      icon: "/icons/icon-192x192.png",
      apple: "/icons/apple-touch-icon.png",
    },
    openGraph: {
      type: "website",
      siteName: "Zobia Social",
      title: "Zobia Social",
      description: "Connect, engage, and belong.",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Zobia Social",
      description: "Connect, engage, and belong.",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  // maximumScale intentionally omitted — setting it to 1 prevents pinch-zoom
  // on iOS which violates WCAG 1.4.4 (Resize Text, Level AA).
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface RootLayoutProps {
  children: React.ReactNode;
}

/** Fetch active footer scripts from the database. Fails open (returns []). */
async function getFooterScripts(): Promise<Array<{ id: string; content: string }>> {
  if (!env.DATABASE_PROVIDER) return [];
  try {
    const { rows } = await db.query<{ id: string; content: string }>(
      `SELECT id, content FROM footer_scripts
       WHERE is_active = TRUE
       ORDER BY position ASC, created_at ASC`
    );
    return rows;
  } catch {
    return [];
  }
}

/**
 * Root layout component. Async Server Component — safe to await at the top
 * level. PWA manifest presence is controlled per-request by generateMetadata.
 * Footer scripts from the admin panel are injected at the bottom of <body>.
 *
 * The `lang` and `dir` attributes are derived from the user's locale cookie
 * so that Arabic (ar) receives `dir="rtl"` and all other locales get `dir="ltr"`.
 * The cookie name `zobia_lang` matches the i18next browser language detector
 * configuration in lib/i18n/index.ts (lookupCookie: "zobia_lang").
 */
export default async function RootLayout({ children }: RootLayoutProps) {
  const footerScripts = await getFooterScripts();

  const requestHeaders = await headers();
  // Read the per-request CSP nonce injected by middleware so we can propagate it
  // to ThemeProvider (which injects an inline script + style to prevent FOUC).
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  // Resolve locale from the i18n cookie set by the browser language detector.
  const cookieStore = await cookies();
  const rawLocale = cookieStore.get("zobia_lang")?.value ?? DEFAULT_LOCALE;
  // Validate the locale value to guard against cookie tampering.
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
    ? rawLocale
    : DEFAULT_LOCALE;
  const dir = getDir(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={inter.variable}
    >
      <body className="min-h-screen overflow-x-hidden bg-neutral-50 text-neutral-900 font-sans antialiased dark:bg-neutral-950 dark:text-neutral-50">
        {/* Accessibility: Skip to main content link (only visible on focus) */}
        <SkipToMain />

        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <ReactQueryProvider>
            <I18nProvider>
              <FloatingNotificationProvider>
                {/* Captures ?r=<code> from any page for referral attribution */}
                <ReferralCapture />
                {/* App-wide "you've been signed out" notice — mounted at the root
                    (not just the (app) layout) so it also covers standalone routes
                    like /g/<slug>/play and /g/<slug>/embed, where a mid-session
                    401 (e.g. failing to start/score a game) previously went
                    unnoticed. Self-guards against showing on /auth/* routes. */}
                <SessionExpiredModal />
                <main id="main-content">
                  {children}
                </main>
              </FloatingNotificationProvider>
            </I18nProvider>
          </ReactQueryProvider>
        </ThemeProvider>
        {/* TASK-01: Admin footer scripts are served via a sandboxed external script src
            (/api/static/footer-script/[id]) rather than being injected inline with the
            page nonce. This prevents a compromised admin account from executing arbitrary
            JS in every visitor's session via the nonce — the script content is approved
            at save-time and served with its own Content-Security-Policy header. */}
        {footerScripts.filter(s => s.content.trim()).map((script) => (
          <script
            key={script.id}
            src={`/api/static/footer-script/${script.id}`}
            async
          />
        ))}
      </body>
    </html>
  );
}
