"use client";

/**
 * components/providers/ThemeProviderWithNonce.tsx
 *
 * next-themes' ThemeProvider, with the CSP nonce applied to its inline
 * FOUC-prevention script on the SERVER ONLY.
 *
 * Why this wrapper exists (React hydration error #418):
 *
 * next-themes renders `<script nonce={nonce} dangerouslySetInnerHTML=... />`
 * with the same nonce value on the server and the client. But the HTML spec
 * requires browsers to *blank the `nonce` content attribute* once the document
 * is parsed, keeping the real value only on the element's `.nonce` IDL
 * property — an anti-exfiltration measure, so a CSS attribute selector like
 * `script[nonce^="a"]` can't leak the value. Verified in a real browser
 * against this app: `getAttribute("nonce")` returns "" while `.nonce` still
 * returns the live value.
 *
 * React hydrates by diffing against the DOM *attribute*, so it compares its
 * rendered nonce against "" and reports a mismatch on every single page load:
 *
 *     <script
 *   +   nonce="3MApTAi2+IZCPIdthNwm2g=="   (server)
 *   -   nonce=""                            (client)
 *
 * Rendering "" on the client makes React agree with what the DOM actually
 * holds. The `typeof window` branch is normally a hydration hazard; here it is
 * the fix, because the browser — not our code — is what changed the markup.
 *
 * The script still executes correctly: it runs once during the initial HTML
 * parse, using the real nonce present in the server-sent markup, and CSP is
 * evaluated at that point. React never re-executes an already-parsed inline
 * script when it updates the element afterwards, and the theme class it sets
 * on <html> is applied before first paint regardless.
 */

import { ThemeProvider } from "next-themes";
import type { ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof ThemeProvider>;

export function ThemeProviderWithNonce({ nonce, children, ...props }: ThemeProviderProps) {
  const serverOnlyNonce = typeof window === "undefined" ? nonce : "";

  return (
    <ThemeProvider {...props} nonce={serverOnlyNonce}>
      {children}
    </ThemeProvider>
  );
}
