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
 */

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: {
    default: "Zobia Social",
    template: "%s | Zobia Social",
  },
  description:
    "Zobia Social – Connect, engage, and belong. Discover rooms, chat with friends, and build your community.",
  keywords: ["social", "community", "chat", "rooms", "messaging"],
  authors: [{ name: "Zobia Social" }],
  creator: "Zobia Social",
  manifest: "/manifest.webmanifest",
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

/**
 * Root layout component.
 * Wraps the entire application with global providers.
 */
export default function RootLayout({ children }: RootLayoutProps) {
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
      </body>
    </html>
  );
}
