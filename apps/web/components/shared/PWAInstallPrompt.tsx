"use client";

/**
 * components/shared/PWAInstallPrompt.tsx
 *
 * Shows a platform-appropriate install prompt:
 *   - iOS / non-Android: offer PWA home-screen install
 *   - Android: offer Android app download (URL from admin config)
 *
 * Dismissal logic (localStorage-backed):
 *   - "Already installed / downloaded" → suppress for 90 days
 *   - "Not now" → suppress for 7 days
 *   - Prompt only on web (not inside standalone PWA)
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

const STORAGE_KEY = "zobia_pwa_prompt";
const DISMISS_DAYS = 7;
const DONE_DAYS = 90;

interface PromptState {
  suppressUntil: number;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function getPromptState(): PromptState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PromptState) : null;
  } catch {
    return null;
  }
}

function setPromptState(state: PromptState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function PWAInstallPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [androidAppUrl, setAndroidAppUrl] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const showAndroid = isAndroid();

  useEffect(() => {
    // Don't show if already in standalone PWA mode
    if (isStandalone()) return;

    const state = getPromptState();
    if (state && Date.now() < state.suppressUntil) return;

    if (showAndroid) {
      // Fetch admin-configured Android app URL from manifest
      fetch("/api/manifest")
        .then((r) => r.json())
        .then((m: { android_app_url?: string }) => {
          if (m.android_app_url) {
            setAndroidAppUrl(m.android_app_url);
            setVisible(true);
          }
        })
        .catch(() => {});
      return;
    }

    // iOS or other non-Android: show PWA install prompt
    // Listen for the beforeinstallprompt event (Chrome/Edge on desktop/Android)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS doesn't fire beforeinstallprompt — show a manual guide instead
    if (isIOS()) {
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [showAndroid]);

  function dismiss() {
    setVisible(false);
    setPromptState({ suppressUntil: Date.now() + DISMISS_DAYS * 86_400_000 });
  }

  function alreadyDone() {
    setVisible(false);
    setPromptState({ suppressUntil: Date.now() + DONE_DAYS * 86_400_000 });
  }

  async function handleInstall() {
    if (deferredPrompt) {
      // Trigger the native browser install dialog
      (deferredPrompt as BeforeInstallPromptEvent).prompt();
      const { outcome } = await (deferredPrompt as BeforeInstallPromptEvent).userChoice;
      if (outcome === "accepted") {
        alreadyDone();
        return;
      }
    }
    dismiss();
  }

  if (!visible) return null;

  if (showAndroid && androidAppUrl) {
    return (
      <div
        role="dialog"
        aria-label={t("pwa.androidTitle")}
        className="fixed bottom-16 inset-x-4 z-50 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm"
      >
        <p className="text-sm font-bold text-neutral-900 dark:text-white">{t("pwa.androidTitle")}</p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("pwa.androidBody")}</p>
        <div className="mt-3 flex gap-2">
          <a
            href={androidAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={alreadyDone}
            className="flex-1 rounded-xl bg-amber-400 px-3 py-2 text-center text-xs font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
          >
            {t("pwa.androidDownloadBtn")}
          </a>
          <button
            type="button"
            onClick={alreadyDone}
            className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors"
          >
            {t("pwa.androidAlreadyDid")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl px-3 py-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            {t("pwa.androidDismiss")}
          </button>
        </div>
      </div>
    );
  }

  // iOS / desktop PWA prompt
  return (
    <div
      role="dialog"
      aria-label={t("pwa.installTitle")}
      className="fixed bottom-16 inset-x-4 z-50 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm"
    >
      <p className="text-sm font-bold text-neutral-900 dark:text-white">{t("pwa.installTitle")}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("pwa.installBody")}</p>
      {isIOS() && (
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Tap <strong>Share</strong> then <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {!isIOS() && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="flex-1 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
          >
            {t("pwa.installBtn")}
          </button>
        )}
        <button
          type="button"
          onClick={alreadyDone}
          className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors"
        >
          {t("pwa.installAlreadyDid")}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl px-3 py-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        >
          {t("pwa.installDismiss")}
        </button>
      </div>
    </div>
  );
}

// Type augmentation for the non-standard BeforeInstallPromptEvent
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
