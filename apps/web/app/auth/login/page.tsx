"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";

// ---------------------------------------------------------------------------
// Telegram Login Widget types
// ---------------------------------------------------------------------------

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
    turnstile?: {
      render: (container: string | HTMLElement, opts: object) => string;
      getResponse: (widgetId: string) => string | undefined;
    };
  }
}

interface CaptchaManifest {
  captchaProvider: "recaptcha" | "turnstile" | "none";
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
  auth?: { telegramEnabled: boolean };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const [isLoading, setIsLoading] = useState<"google" | "telegram" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [captchaManifest, setCaptchaManifest] = useState<CaptchaManifest | null>(null);

  const botUsername = process.env["NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"] ?? "";
  const telegramContainerRef = useRef<HTMLDivElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Load manifest for CAPTCHA config
  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m: CaptchaManifest) => setCaptchaManifest(m))
      .catch(() => setCaptchaManifest({ captchaProvider: "none" }));
  }, []);

  // Init Turnstile when manifest + script are ready
  const initTurnstile = useCallback(() => {
    if (
      captchaManifest?.captchaProvider !== "turnstile" ||
      !captchaManifest.turnstileSiteKey ||
      !turnstileContainerRef.current ||
      turnstileWidgetId.current
    ) return;
    turnstileWidgetId.current = window.turnstile?.render(
      turnstileContainerRef.current,
      { sitekey: captchaManifest.turnstileSiteKey }
    ) ?? null;
  }, [captchaManifest]);

  // Collect CAPTCHA token before redirecting to Google OAuth
  const getCaptchaToken = useCallback(async (): Promise<string | null> => {
    if (!captchaManifest || captchaManifest.captchaProvider === "none") return null;
    if (captchaManifest.captchaProvider === "recaptcha" && captchaManifest.recaptchaSiteKey) {
      return new Promise((resolve) => {
        window.grecaptcha?.ready(async () => {
          try {
            const token = await window.grecaptcha!.execute(
              captchaManifest.recaptchaSiteKey!,
              { action: "login" }
            );
            resolve(token);
          } catch {
            resolve(null);
          }
        });
      });
    }
    if (captchaManifest.captchaProvider === "turnstile" && turnstileWidgetId.current) {
      return window.turnstile?.getResponse(turnstileWidgetId.current) ?? null;
    }
    return null;
  }, [captchaManifest]);

  // Handle Google OAuth redirect
  const handleGoogleLogin = async () => {
    setIsLoading("google");
    setAuthError(null);
    try {
      const captchaToken = await getCaptchaToken();
      const url = captchaToken
        ? `/api/auth/google?captcha_token=${encodeURIComponent(captchaToken)}`
        : "/api/auth/google";
      const res = await fetch(url);
      const data = await res.json() as { url?: string; error?: { message?: string } };
      if (!res.ok || !data.url) {
        setAuthError(data?.error?.message ?? "Authentication failed. Please try again.");
        setIsLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setAuthError("Authentication failed. Please try again.");
      setIsLoading(null);
    }
  };

  // Telegram login callback (called by widget script)
  useEffect(() => {
    window.onTelegramAuth = async (user: TelegramUser) => {
      setIsLoading("telegram");
      try {
        const params = new URLSearchParams({
          id: String(user.id),
          first_name: user.first_name,
          ...(user.last_name && { last_name: user.last_name }),
          ...(user.username && { username: user.username }),
          ...(user.photo_url && { photo_url: user.photo_url }),
          auth_date: String(user.auth_date),
          hash: user.hash,
        });
        window.location.href = `/auth/callback/telegram?${params.toString()}`;
      } catch {
        setIsLoading(null);
      }
    };
    return () => { delete window.onTelegramAuth; };
  }, []);

  // Inject Telegram widget script directly into the DOM so data-* attributes
  // are present on the <script> element exactly as Telegram's widget expects.
  useEffect(() => {
    if (!botUsername || !telegramContainerRef.current) return;
    const container = telegramContainerRef.current;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);
    return () => {
      if (container.contains(script)) container.removeChild(script);
    };
  }, [botUsername]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary-600 dark:text-primary-400">
            Zobia Social
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Sign in to your account
          </p>
        </div>

        {/* Auth error banner */}
        {authError && (
          <div className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
            {authError}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
            {error === "oauth_failed" && "Authentication failed. Please try again."}
            {error === "account_suspended" && "Your account has been suspended."}
            {error === "session_expired" && "Your session expired. Please sign in again."}
            {!["oauth_failed", "account_suspended", "session_expired"].includes(error) &&
              "An unexpected error occurred. Please try again."}
          </div>
        )}

        {/* Auth card */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-10 shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
          <div className="space-y-4">
            {/* Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-700 shadow-card transition-all hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-750"
            >
              {isLoading === "google" ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>

            {/* Turnstile widget (visible only when configured) */}
            {captchaManifest?.captchaProvider === "turnstile" && captchaManifest.turnstileSiteKey && (
              <div ref={turnstileContainerRef} className="flex justify-center" />
            )}

            {/* Telegram (only shown when bot username is configured and manifest enables it) */}
            {((botUsername && captchaManifest !== null && captchaManifest.auth?.telegramEnabled !== false) || isLoading === "telegram") && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-2 text-neutral-400 dark:bg-neutral-900">
                      or
                    </span>
                  </div>
                </div>

                <div className="flex justify-center">
                  {isLoading === "telegram" ? (
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
                      Signing in with Telegram…
                    </div>
                  ) : (
                    <div ref={telegramContainerRef} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-neutral-400">
          By signing in, you agree to Zobia Social&apos;s{" "}
          <a href="/terms" className="text-primary-600 hover:underline dark:text-primary-400">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-primary-600 hover:underline dark:text-primary-400">
            Privacy Policy
          </a>
          .
        </p>
      </div>

      {/* reCAPTCHA v3 script (invisible) */}
      {captchaManifest?.captchaProvider === "recaptcha" && captchaManifest.recaptchaSiteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${captchaManifest.recaptchaSiteKey}`}
          strategy="afterInteractive"
        />
      )}

      {/* Turnstile script */}
      {captchaManifest?.captchaProvider === "turnstile" && captchaManifest.turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={initTurnstile}
        />
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Google icon (inline SVG to avoid extra dependency)
// ---------------------------------------------------------------------------

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
