"use client";

/**
 * app/auth/2fa/page.tsx
 *
 * Two-factor authentication verification page shown during login
 * when the user has TOTP enabled. Receives a pre-auth token via
 * query param, verifies the 6-digit TOTP code, then completes the session.
 */

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

function TwoFAForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [preAuthToken, setPreAuthToken] = useState("");
  const exchange = useRef<Promise<{token:string}> | null>(null);
  const exchangeCode = searchParams?.get("code");
  useEffect(() => {
    if (!exchangeCode) return;
    let cancelled = false;
    const pending = exchange.current ??= fetch("/api/auth/2fa/pre-auth-token", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({code:exchangeCode}) }).then(async r => { if (!r.ok) throw new Error("Login challenge expired"); return r.json(); });
    void pending.then(r => { if (!cancelled) { setPreAuthToken(r.token); window.history.replaceState(null,"",window.location.pathname); } }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [exchangeCode]);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, preAuthToken }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        onboardingCompleted?: boolean;
        redirect?: string;
        error?: string;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      const destination = data.redirect && /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(data.redirect)
        ? data.redirect : "/home";
      router.replace(data.onboardingCompleted ? destination : "/onboarding");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!preAuthToken && !exchangeCode) {
    return (
      <p className="text-center text-sm text-red-600 dark:text-red-400">
        Invalid or missing token. Please try logging in again.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="code"
          className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          6-digit authenticator code
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-center text-2xl font-mono font-semibold tracking-widest text-neutral-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || code.length !== 6}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Verifying…" : "Verify"}
      </button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Open your authenticator app (Google Authenticator, Authy, etc.) to get
        the 6-digit code.
      </p>
    </form>
  );
}

export default function TwoFAPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Icon emoji="🔐" className="inline-block text-3xl" size={32} />
          <h1 className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Two-factor authentication
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Enter the code from your authenticator app to continue.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-8 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <Suspense>
            <TwoFAForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
