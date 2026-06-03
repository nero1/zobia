"use client";

/**
 * app/(admin)/admin/setup-2fa/page.tsx
 *
 * Admin Two-Factor Authentication Setup Page.
 *
 * PRD §20: "mandatory 2FA (authenticator app). No Google OAuth for admin login."
 *
 * This page is shown to admins who haven't configured 2FA yet.
 * It generates a TOTP secret, displays a QR code URI for the admin to
 * scan with Google Authenticator or Authy, then verifies a test code
 * before saving the secret.
 */

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type SetupStep = "generate" | "verify" | "done";

export default function Setup2FAPage() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>("generate");
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch a new TOTP secret from the server
  useEffect(() => {
    const fetchSecret = async () => {
      try {
        const res = await fetch("/api/admin/auth/totp/setup", {
          method: "GET",
        });
        const data = (await res.json()) as {
          secret?: string;
          otpauthUri?: string;
          error?: string;
        };
        if (!res.ok || !data.secret) {
          setError(data.error ?? "Failed to generate 2FA secret");
          return;
        }
        setSecret(data.secret);
        setOtpauthUri(data.otpauthUri ?? null);
      } catch {
        setError("Network error. Please refresh.");
      }
    };
    void fetchSecret();
  }, []);

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/auth/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, verificationCode }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      setStep("done");
      setTimeout(() => {
        router.push("/admin/login");
      }, 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <span className="text-2xl">🔐</span>
          <h1 className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Set Up Two-Factor Authentication
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            2FA is mandatory for all admin accounts. This only needs to be done once.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-8 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {step === "generate" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Step 1: Install an authenticator app
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Download <strong>Google Authenticator</strong> or <strong>Authy</strong> on your phone.
                </p>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Step 2: Scan or enter your secret key
                </p>
                {secret ? (
                  <div className="space-y-3">
                    {/* Manual secret entry */}
                    <div className="rounded-md bg-white px-3 py-2 dark:bg-neutral-900">
                      <p className="mb-1 text-xs text-neutral-500">
                        Manual entry key (if you can&apos;t scan):
                      </p>
                      <code className="break-all text-sm font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {secret}
                      </code>
                    </div>

                    {/* OTPAuth URI */}
                    {otpauthUri && (
                      <div>
                        <p className="mb-1 text-xs text-neutral-500">
                          Or open this URL in your authenticator app:
                        </p>
                        <code className="block break-all rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">
                          {otpauthUri}
                        </code>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                )}
              </div>

              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                disabled={!secret}
                onClick={() => setStep("verify")}
              >
                I&apos;ve added the key → Verify
              </Button>
            </div>
          )}

          {step === "verify" && (
            <form onSubmit={handleVerify} className="space-y-5">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Enter the 6-digit code from your authenticator app to confirm setup.
              </p>
              <Input
                id="verification-code"
                label="6-digit verification code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, ""))
                }
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
                Verify &amp; Activate 2FA
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("generate");
                  setVerificationCode("");
                  setError(null);
                }}
                className="w-full text-center text-sm text-neutral-500 hover:text-neutral-700"
              >
                ← Back
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <span className="text-4xl">✅</span>
              <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                2FA activated successfully!
              </p>
              <p className="text-sm text-neutral-500">
                Redirecting to login in 3 seconds...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
