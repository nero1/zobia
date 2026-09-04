"use client";

/**
 * app/(admin)/gate44/settings/security/page.tsx
 *
 * Admin panel — Security settings.
 *
 * Lets the current admin set/replace their "Secret Magic Word" — the only
 * way to self-unlock their /gate44 login after 3 failed attempts (see
 * lib/auth/adminLockout.ts and app/api/admin/auth/{login,totp,unlock}/route.ts).
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";

export default function AdminSecuritySettingsPage() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [magicWord, setMagicWord] = useState("");
  const [confirmMagicWord, setConfirmMagicWord] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auth/magic-word", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: { isSet: boolean } };
      setIsSet(!!data.data?.isSet);
    } catch {
      // leave as null — form still usable
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (magicWord !== confirmMagicWord) {
      setError("Magic words do not match.");
      return;
    }
    if (magicWord.length < 6) {
      setError("Secret Magic Word must be at least 6 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/auth/magic-word", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, magicWord }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to save. Please try again.");
        return;
      }
      setIsSet(true);
      setPassword("");
      setMagicWord("");
      setConfirmMagicWord("");
      setSuccess("Secret Magic Word saved.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Security</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Your login is locked after 3 failed attempts as a brute-force defense. The
        Secret Magic Word below is the <strong>only</strong> way to unlock it yourself.
      </p>

      {isSet === false && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          ⚠️ You haven&apos;t set a Secret Magic Word yet. If your login ever gets
          locked, you won&apos;t be able to unlock it yourself until you set one now.
        </div>
      )}
      {isSet === true && (
        <div className="mb-5 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200">
          ✓ A Secret Magic Word is set for your account. Saving below replaces it.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
            {success}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Current password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            Secret Magic Word (a word or phrase)
          </label>
          <input
            type="text"
            value={magicWord}
            onChange={(e) => setMagicWord(e.target.value)}
            required
            minLength={6}
            maxLength={200}
            autoComplete="off"
            placeholder="e.g. purple elephants dance at midnight"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Confirm Secret Magic Word</label>
          <input
            type="text"
            value={confirmMagicWord}
            onChange={(e) => setConfirmMagicWord(e.target.value)}
            required
            autoComplete="off"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Secret Magic Word"}
        </button>
      </form>
    </div>
  );
}
