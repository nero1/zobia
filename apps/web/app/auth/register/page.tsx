"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import Link from "next/link";

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
  }
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/(app)/home";
  const error = searchParams.get("error");

  const [isLoading, setIsLoading] = useState<"google" | "telegram" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading("google");
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/google");
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

  const botUsername = process.env["NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"] ?? "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary-600 dark:text-primary-400">
            Zobia Social
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Create your free account
          </p>
        </div>

        {authError && (
          <div className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
            {authError}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
            {error === "oauth_failed" && "Authentication failed. Please try again."}
            {error === "account_suspended" && "Your account has been suspended."}
            {error === "session_expired" && "Your session expired. Please sign in again."}
            {!["oauth_failed", "account_suspended", "session_expired"].includes(error) &&
              "An unexpected error occurred. Please try again."}
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-10 shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
          <div className="space-y-4">
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
              Sign up with Google
            </button>

            {(botUsername || isLoading === "telegram") && (
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
                      Signing up with Telegram…
                    </div>
                  ) : (
                    <Script
                      src="https://telegram.org/js/telegram-widget.js?22"
                      data-telegram-login={botUsername}
                      data-size="large"
                      data-radius="12"
                      data-onauth="onTelegramAuth(user)"
                      data-request-access="write"
                      strategy="lazyOnload"
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-primary-600 hover:underline dark:text-primary-400">
            Sign in
          </Link>
        </p>

        <p className="mt-3 text-center text-xs text-neutral-400">
          By signing up, you agree to Zobia Social&apos;s{" "}
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
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterContent />
    </Suspense>
  );
}

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
