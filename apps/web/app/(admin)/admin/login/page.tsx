/**
 * app/(admin)/admin/login/page.tsx
 *
 * Admin login page.
 *
 * Authentication: email + password + MANDATORY TOTP 2FA (PRD §20).
 * "Authentication: email + password + mandatory 2FA (authenticator app). No Google OAuth."
 *
 * Flow:
 *  1. Credentials step — email + password
 *  2. ALWAYS proceeds to TOTP step (2FA is mandatory, never optional)
 *  3. If admin has not set up 2FA yet → redirected to /admin/setup-2fa
 *
 * NO Google OAuth – admin auth is credentials-only for security.
 * is_admin is verified against the DB on every admin API call.
 */

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Step = "credentials" | "totp";

/**
 * Admin login page component.
 * 2FA is mandatory — the TOTP step is always shown after valid credentials.
 */
export default function AdminLoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
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
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Invalid credentials. Please try again.");
        return;
      }

      if (data.needsSetup) {
        // Admin hasn't set up 2FA — redirect to setup page
        router.push("/admin/setup-2fa");
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

      const data = (await res.json()) as { success?: boolean; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      if (data.success) {
        router.push("/admin");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2">
            <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              Zobia
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              ADMIN
            </span>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {step === "credentials"
              ? "Sign in to the admin panel"
              : "Two-factor authentication required"}
          </p>
        </div>

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
                id="admin-email"
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="admin@example.com"
              />
              <Input
                id="admin-password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
                Continue
              </Button>
            </form>
          )}

          {/* Step 2: TOTP (mandatory) */}
          {step === "totp" && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              {/* 2FA mandatory notice */}
              <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                🔐 <strong>2FA is required</strong> for all admin access. Open Google
                Authenticator or Authy and enter the 6-digit code for{" "}
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
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
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
                ← Back to credentials
              </button>
            </form>
          )}
        </div>

        {/* Security notice */}
        <p className="mt-4 text-center text-xs text-neutral-400">
          Admin access only. All login attempts are logged.
        </p>
      </div>
    </div>
  );
}
