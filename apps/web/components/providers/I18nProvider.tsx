/**
 * components/providers/I18nProvider.tsx
 *
 * Client-side i18n provider.
 * Initialises i18next and wraps the tree with I18nextProvider.
 */

"use client";

import { useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";
import i18n, { initI18n } from "@/lib/i18n";

// Kick off i18n initialization at module load so i18n.options (including
// react.useSuspense: false) is set before any component renders. Without this,
// useTranslation() would suspend during SSR/SSG since useEffect never runs
// server-side, and an uninitialized i18next instance defaults useSuspense to true.
if (!i18n.isInitialized) {
  initI18n().catch(() => {});
}

interface I18nProviderProps {
  children: React.ReactNode;
}

/**
 * Initialises i18next on the client and provides the i18n instance
 * to all child components via React context.
 */
export function I18nProvider({ children }: I18nProviderProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setReady(true));
  }, []);

  // Render children immediately (translations fall back to keys until ready)
  return (
    <I18nextProvider i18n={i18n} defaultNS="translation">
      {children}
    </I18nextProvider>
  );
}
