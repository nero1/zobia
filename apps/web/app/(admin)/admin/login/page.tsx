/**
 * app/(admin)/admin/login/page.tsx
 *
 * Admin login page.
 *
 * Authentication: email + password + optional TOTP 2FA.
 * NO Google OAuth – admin auth is credentials-only for security.
 * The server-side handler (POST /api/admin/auth/login) verifies credentials
 * against the database and checks the is_admin flag directly from the DB.
 */

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Step = "credentials" | "totp";

/**
 * Admin login page component.
 */
export default function AdminLoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

      const data = await res.json() as {
        success?: boolean;
        requireTotp?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Invalid credentials. Please try again.");
        return;
      }

      if (data.requireTotp) {
        setStep("totp");
      } else if (data.success) {
        router.push("/(admin)/admin");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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

      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      if (data.success) {
        router.push("/(admin)/admin");
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
            <span className="rounded bg-gold-100 px-1.5 py-0.5 text-xs font-bold text-gold-700 dark:bg-gold-900 dark:text-gold-300">
              ADMIN
            </span>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {step === "credentials"
              ? "Sign in to the admin panel"
              : "Enter your two-factor code"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-8 shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
          {/* Error */}
          {error && (
            <div className="mb-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
              {error}
            </div>
          )}

          {/* Credentials step */}
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
                Sign in
              </Button>
            </form>
          )}

          {/* TOTP step */}
          {step === "totp" && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Open your authenticator app and enter the 6-digit code for{" "}
                <strong className="font-medium text-neutral-900 dark:text-neutral-50">
                  {email}
                </strong>
                .
              </p>
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
                Verify
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
                Back to login
              </button>
            </form>
          )}
        </div>

        {/* Security notice */}
        <p className="mt-4 text-center text-xs text-neutral-400">
          Admin access only. Unauthorised attempts are logged.
        </p>
      </div>
    </div>
  );
}
