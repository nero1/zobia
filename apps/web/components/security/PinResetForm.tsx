"use client";

/**
 * components/security/PinResetForm.tsx
 *
 * "Forgot my PIN" form. Posts to POST /api/auth/pin/reset, which lets the user
 * choose a new PIN after proving identity with an authenticator code or their
 * account password — or, when neither applies, a sign-in from the last 10
 * minutes. Shared by the Settings PIN gate and the Security PIN section.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface PinResetFormProps {
  onDone: () => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800";

export function PinResetForm({ onDone, onCancel }: PinResetFormProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!/^\d{4}$/.test(pin)) { setError(t("settings.pin.invalid", "PIN must be exactly 4 digits")); return; }
    if (pin !== confirmPin) { setError(t("settings.pin.mismatch", "PINs do not match")); return; }
    setBusy(true);
    setError(null);
    try {
      const trimmed = proof.trim();
      const res = await fetch("/api/auth/pin/reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          confirmPin,
          ...(/^\d{6}$/.test(trimmed) ? { totpCode: trimmed } : trimmed ? { password: trimmed } : {}),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } | string };
        const code = typeof d.error === "string" ? null : d.error?.code ?? null;
        const message = typeof d.error === "string" ? d.error : d.error?.message ?? "Failed";
        setError(translateApiError(t, code, message));
        return;
      }
      onDone();
    } catch {
      setError(t("error.network", "Network error. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t("settings.pin.reset.description", "Choose a new PIN. Confirm it's you with your authenticator code or account password. If you have neither, sign in again and come straight back here.")}
      </p>
      <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder={t("settings.pin.newPlaceholder", "New 4-digit PIN")} className={inputClass} />
      <input type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))} placeholder={t("settings.pin.confirmPlaceholder", "Confirm PIN")} className={inputClass} />
      <input type="password" autoComplete="off" value={proof} onChange={(e) => setProof(e.target.value)} placeholder={t("settings.pin.reset.proofPlaceholder", "Authenticator code or password (if you have one)")} className={inputClass} />
      {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          {busy ? t("action.saving", "Saving…") : t("settings.pin.reset.submit", "Reset PIN")}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50 dark:border-neutral-700">
          {t("action.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
