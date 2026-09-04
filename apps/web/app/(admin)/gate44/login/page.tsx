/**
 * app/(admin)/gate44/login/page.tsx
 *
 * Staff login page — deliberately generic. Nothing here (title, copy, badges)
 * identifies this as the admin panel to a logged-out visitor; it just looks
 * like any other sign-in screen. See middleware.ts ADMIN_PREFIXES for why
 * the route itself lives at the unguessable /gate44 path instead of /admin.
 *
 * Authentication: email + password + MANDATORY TOTP 2FA (PRD §20).
 * NO Google OAuth – admin auth is credentials-only for security.
 * is_admin is verified against the DB on every admin API call.
 *
 * Flow:
 *  1. Credentials step — email + password
 *  2. ALWAYS proceeds to TOTP step (2FA is mandatory, never optional)
 *  3. If admin has not set up 2FA yet → redirected to /gate44/setup-2fa
 *  4. After 3 failed attempts (either step) the account locks — the "Enter
 *     Secret Magic Word" step is the only way back in (lib/auth/adminLockout.ts).
 */

"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Step = "credentials" | "totp" | "locked";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const redirectParam = searchParams.get("redirect");

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [magicWord, setMagicWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1: verify credentials — always proceed to TOTP step
  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        needsSetup?: boolean; // true if admin hasn't configured 2FA yet
        error?: { code?: string; message?: string } | string;
      };

      if (!res.ok) {
        if (res.status === 423) {
          setStep("locked");
          return;
        }
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        setError(msg ?? "Invalid credentials. Please try again.");
        return;
      }

      if (data.needsSetup) {
        // Admin hasn't set up 2FA — redirect to setup page
        router.push("/gate44/setup-2fa");
        return;
      }

      // Always proceed to TOTP regardless — 2FA is mandatory
      setStep("totp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: verify TOTP code
  const handleTotpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code: totpCode }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string } | string;
      };

      if (!res.ok) {
        if (res.status === 423) {
          setStep("locked");
          return;
        }
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        setError(msg ?? "Invalid code. Please try again.");
        return;
      }

      if (data.success) {
        const target = redirectParam && redirectParam.startsWith("/gate44") ? redirectParam : "/gate44";
        router.push(target);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Locked step: unlock with the Secret Magic Word
  const handleUnlockSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, magicWord }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string } | string;
      };

      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        setError(msg ?? "Incorrect Secret Magic Word.");
        return;
      }

      setMagicWord("");
      setPassword("");
      setStep("credentials");
      setError(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        {/* Header — deliberately generic, no admin labeling */}
        <div className="mb-8 text-center">
          <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Zobia</span>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {step === "credentials" && "Sign in"}
            {step === "totp" && "Two-factor authentication required"}
            {step === "locked" && "Account locked"}
          </p>
        </div>

        {/* Session expired banner */}
        {reason === "session_expired" && step === "credentials" && (
          <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Your session has expired. Please sign in again.
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-8 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {/* Error */}
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {/* Step 1: Credentials */}
          {step === "credentials" && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <Input
                id="login-email"
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
              <Input
                id="login-password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
                Continue
              </Button>
            </form>
          )}

          {/* Step 2: TOTP (mandatory) */}
          {step === "totp" && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                🔐 Open your authenticator app and enter the 6-digit code for{" "}
                <strong>{email}</strong>.
              </div>
              <Input
                id="totp-code"
                label="Authenticator code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
                required
                placeholder="000000"
              />
              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
                Verify &amp; Sign in
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setTotpCode("");
                  setError(null);
                }}
                className="mt-2 w-full text-center text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                ← Back
              </button>
            </form>
          )}

          {/* Locked: Secret Magic Word unlock */}
          {step === "locked" && (
            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                Too many failed attempts. Enter your Secret Magic Word to unlock this account.
              </div>
              <Input
                id="magic-word"
                label="Secret Magic Word"
                type="text"
                value={magicWord}
                onChange={(e) => setMagicWord(e.target.value)}
                autoComplete="off"
                required
                placeholder="Your word or phrase"
              />
              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
                Unlock
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setMagicWord("");
                  setError(null);
                }}
                className="mt-2 w-full text-center text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                ← Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
