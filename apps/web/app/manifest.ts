/**
 * app/manifest.ts
 *
 * Next.js PWA Web App Manifest.
 * Served at /manifest.webmanifest automatically by Next.js.
 *
 * Colors follow the Zobia brand: blues, greens, golds – NO purple.
 */

import type { MetadataRoute } from "next";

/**
 * Returns the PWA web app manifest configuration.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zobia Social",
    short_name: "Zobia",
    description:
      "Connect, engage, and belong. Discover rooms, chat with friends, and build your community.",
    start_url: "/(app)/home",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    orientation: "portrait-primary",
    scope: "/",
    lang: "en",
    categories: ["social", "communication", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-72x72.png",
        sizes: "72x72",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-96x96.png",
        sizes: "96x96",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-128x128.png",
        sizes: "128x128",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-144x144.png",
        sizes: "144x144",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-152x152.png",
        sizes: "152x152",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-384x384.png",
        sizes: "384x384",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Home Feed",
        short_name: "Home",
        description: "Go to your home feed",
        url: "/(app)/home",
        icons: [{ src: "/icons/shortcut-home.png", sizes: "96x96" }],
      },
      {
        name: "Rooms",
        short_name: "Rooms",
        description: "Browse public rooms",
        url: "/(app)/rooms",
        icons: [{ src: "/icons/shortcut-rooms.png", sizes: "96x96" }],
      },
      {
        name: "Messages",
        short_name: "Messages",
        description: "View your messages",
        url: "/(app)/messages",
        icons: [{ src: "/icons/shortcut-messages.png", sizes: "96x96" }],
      },
    ],
    screenshots: [
      {
        src: "/screenshots/home.png",
        sizes: "1080x1920",
        type: "image/png",
        // @ts-expect-error – form_factor is valid but not yet in Next.js types
        form_factor: "narrow",
        label: "Home feed",
      },
    ],
  };
}
