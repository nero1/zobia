"use client";

/**
 * app/auth/telegram-mobile/page.tsx
 *
 * Minimal Telegram Login Widget page for the Android Capacitor app.
 *
 * Flow:
 *  1. Android opens this page in a Capacitor Custom Tab, passing
 *     ?redirect=zobia://auth/callback
 *  2. This page renders the Telegram Login Widget configured with
 *     data-auth-url pointing to /api/auth/telegram/callback with the
 *     mobile_redirect embedded as a query param.
 *  3. After the user authenticates via Telegram, the browser is redirected
 *     to /api/auth/telegram/callback?mobile_redirect=...&id=...&hash=...
 *  4. The callback validates the Telegram signature, creates an exchange code,
 *     and redirects to zobia://auth/callback?code=EXCHANGE_CODE.
 *  5. The Custom Tab closes and Capacitor fires appUrlOpen, which the
 *     __root.tsx handler exchanges for tokens.
 */

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

// Schemes allowed as mobile redirect targets (mirrors Google callback allowlist).
const ALLOWED_SCHEMES = ["zobia:", "exp+zobia:", "exp+zobia-social:"];

function isAllowedRedirect(redirect: string): boolean {
  try {
    return ALLOWED_SCHEMES.includes(new URL(redirect).protocol);
  } catch {
    return false;
  }
}

function TelegramMobileContent() {
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect") ?? "";
  const redirect = isAllowedRedirect(rawRedirect) ? rawRedirect : "";

  const containerRef = useRef<HTMLDivElement>(null);
  const botUsername = process.env["NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"] ?? "";
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "";

  useEffect(() => {
    if (!botUsername || !containerRef.current) return;
    const container = containerRef.current;

    // Build the auth-url: the Telegram widget will redirect the browser to this
    // URL (appending id, hash, auth_date etc. as query params) after the user
    // authorises.  The callback route reads mobile_redirect and issues an
    // exchange code deep-link instead of setting web cookies.
    const authUrl = redirect
      ? `${appUrl}/api/auth/telegram/callback?mobile_redirect=${encodeURIComponent(redirect)}`
      : `${appUrl}/api/auth/telegram/callback`;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);

    return () => {
      if (container.contains(script)) container.removeChild(script);
    };
  }, [botUsername, appUrl, redirect]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-bold text-primary-600">Zobia Social</h1>
        <p className="mb-8 text-sm text-neutral-500">Sign in with your Telegram account</p>

        {botUsername ? (
          <div className="flex justify-center">
            <div ref={containerRef} />
          </div>
        ) : (
          <p className="text-sm text-neutral-400">Telegram login is not configured.</p>
        )}
      </div>
    </div>
  );
}

export default function TelegramMobilePage() {
  return (
    <Suspense>
      <TelegramMobileContent />
    </Suspense>
  );
}
