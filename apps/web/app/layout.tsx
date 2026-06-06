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
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { loadManifest } from "@/lib/manifest";
import { db } from "@/lib/db";

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
  maximumScale: 1,
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface RootLayoutProps {
  children: React.ReactNode;
}

/** Fetch active footer scripts from the database. Fails open (returns []). */
async function getFooterScripts(): Promise<Array<{ id: string; content: string }>> {
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
 */
export default async function RootLayout({ children }: RootLayoutProps) {
  const footerScripts = await getFooterScripts();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={inter.variable}
    >
      <body className="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ReactQueryProvider>
            <I18nProvider>
              {children}
            </I18nProvider>
          </ReactQueryProvider>
        </ThemeProvider>
        {footerScripts.map((script) => (
          <div
            key={script.id}
            dangerouslySetInnerHTML={{ __html: script.content }}
          />
        ))}
      </body>
    </html>
  );
}
