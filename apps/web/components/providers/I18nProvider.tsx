/**
 * components/providers/I18nProvider.tsx
 *
 * Client-side i18n provider.
 * Wraps the tree with I18nextProvider.
 *
 * i18next is initialised synchronously at module load (see lib/i18n) with the
 * English bundle available immediately, so children can be rendered
 * unconditionally. Rendering children unconditionally is important: a previous
 * version gated them behind a `ready` flag derived from `i18n.isInitialized`,
 * which evaluated to `true` on a warm SSR process but `false` on a fresh
 * client. That divergence caused a hydration mismatch under <main> that React
 * recovered from by duplicating the entire page ("duplicate screen on scroll").
 */

"use client";

import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";

interface I18nProviderProps {
  children: React.ReactNode;
}

/**
 * Provides the shared i18next instance to all child components via React
 * context. The instance is already initialised by the time this renders.
 */
export function I18nProvider({ children }: I18nProviderProps) {
  return (
    <I18nextProvider i18n={i18n} defaultNS="translation">
      {children}
    </I18nextProvider>
  );
}
