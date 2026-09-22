"use client";

/**
 * components/creator/CreatorPayoutPanel.tsx
 *
 * The creator withdrawal panel — available balance, threshold progress,
 * "Request (Coins / Bank / Crypto)" buttons with the PIN re-verification
 * step, and payout history. Extracted verbatim (behaviour-wise) from
 * app/(app)/creator/page.tsx so the Creator Dashboard and the Classroom
 * Creator Studio drive the SAME withdrawal flow:
 *   GET  /api/creator/payouts  (balance, config, history)
 *   POST /api/creator/payouts  { method }  → 403 PIN_REQUIRED → POST /api/auth/pin/verify → retry
 * Classroom enrolment revenue lands in the same available_earnings_kobo
 * balance, so there is exactly one ledger and one withdrawal pipeline.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

type PayoutMethod = "bank_transfer" | "coins" | "crypto";

interface PayoutRecord {
  id: string;
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  status: string;
  method: string;
  region: string;
  bankAccountLast4: string | null;
  retryCount: number;
  appealStatus: string | null;
  rejectionReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PayoutConfig {
  bankTransferEnabled: boolean;
  coinsEnabled: boolean;
  cryptoEnabled: boolean;
  isManualMode: boolean;
  region: "nigeria" | "global";
}

export interface PayoutsData {
  isCreator?: boolean;
  availableEarningsKobo: number;
  minPayoutKobo: number;
  payoutConfig: PayoutConfig | null;
  bankAccount: { configured: boolean };
  walletAddress: { configured: boolean };
  pendingPayout: { id: string; method: string } | null;
  payouts: PayoutRecord[];
}

function formatNgn(kobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function ThresholdProgressBar({ availableKobo, minKobo }: { availableKobo: number; minKobo: number }) {
  const { t } = useTranslation();
  const met = availableKobo >= minKobo;
  const pct = minKobo > 0 ? Math.min(100, Math.round((availableKobo / minKobo) * 100)) : 100;
  const remainingKobo = Math.max(0, minKobo - availableKobo);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${met ? "text-teal-700 dark:text-teal-300" : "text-amber-700 dark:text-amber-400"}`}>
          {met
            ? t("creator.thresholdMet", "✅ Withdrawal threshold reached")
            : t("creator.payout.thresholdRemaining", "{{amount}} more to reach the minimum payout", { amount: formatNgn(remainingKobo) })}
        </span>
        <span className="tabular-nums text-neutral-400">
          {formatNgn(availableKobo)} / {formatNgn(minKobo)}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("creator.payout.thresholdAria", "Progress toward minimum payout threshold")}
      >
        <div className={`h-full rounded-full transition-all duration-500 ${met ? "bg-teal-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CreatorPayoutPanel({
  title,
  onToast,
  notCreatorHint,
}: {
  title?: string;
  onToast?: (msg: string, kind: "success" | "error") => void;
  /** Shown instead of the panel when the caller isn't a creator yet. */
  notCreatorHint?: string;
}) {
  const { t } = useTranslation();
  const [payouts, setPayouts] = useState<PayoutsData | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<PayoutMethod | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/creator/payouts", { credentials: "include" });
    if (res.ok) setPayouts((await res.json()) as PayoutsData);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestPayout(method: PayoutMethod) {
    setError(null);
    setRequesting(true);
    try {
      const res = await fetch("/api/creator/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.code === "PIN_REQUIRED") {
          setPendingMethod(method);
          setShowPin(true);
          return;
        }
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        setError(translateApiError(t, errCode, errMsg ?? body.message ?? t("creator.payout.requestFailed", "Failed to request payout")));
        return;
      }
      const body = await res.json().catch(() => ({}));
      onToast?.(body.message ?? t("creator.payout.requested", "Payout requested — pending admin approval"), "success");
      await load();
    } finally {
      setRequesting(false);
    }
  }

  async function handlePinVerify() {
    if (pin.trim().length < 4 || !pendingMethod) return;
    setRequesting(true);
    try {
      const res = await fetch("/api/auth/pin/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      if (!res.ok) throw new Error("Invalid PIN");
      setShowPin(false);
      setPin("");
      const method = pendingMethod;
      setPendingMethod(null);
      await requestPayout(method);
    } catch {
      setError(t("creator.payout.pinFailed", "PIN verification failed. Please try again."));
    } finally {
      setRequesting(false);
    }
  }

  if (!payouts) {
    return <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />;
  }
  if (payouts.isCreator === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        {notCreatorHint ?? t("creator.payout.notCreator", "Payouts are available once your account has creator status.")}
      </div>
    );
  }

  const cfg = payouts.payoutConfig;
  const belowThreshold = payouts.availableEarningsKobo < payouts.minPayoutKobo;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title ?? t("creator.payouts", "Payouts")}</h2>
      </div>
      <div className="p-5">
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-teal-700 dark:text-teal-400">{t("creator.payout.available", "Available Balance")}</p>
              <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{formatNgn(payouts.availableEarningsKobo)}</p>
            </div>
            {!payouts.pendingPayout && cfg && (
              <div className="flex flex-wrap gap-2">
                {cfg.coinsEnabled && (
                  <button
                    onClick={() => void requestPayout("coins")}
                    disabled={requesting || payouts.availableEarningsKobo <= 0}
                    className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    {requesting ? t("creator.payout.requesting", "Requesting…") : t("creator.payout.requestCoins", "Request (Coins)")}
                  </button>
                )}
                {cfg.bankTransferEnabled && (
                  <button
                    onClick={() => void requestPayout("bank_transfer")}
                    disabled={requesting || !payouts.bankAccount.configured || belowThreshold}
                    className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-950/30"
                    title={
                      belowThreshold
                        ? t("creator.payout.belowThreshold", "You need at least {{amount}} to withdraw", { amount: formatNgn(payouts.minPayoutKobo) })
                        : !payouts.bankAccount.configured
                          ? t("creator.payout.addBank", "Add a bank account first")
                          : undefined
                    }
                  >
                    {requesting ? t("creator.payout.requesting", "Requesting…") : t("creator.payout.requestBank", "Request (Bank)")}
                  </button>
                )}
                {cfg.cryptoEnabled && (
                  <button
                    onClick={() => void requestPayout("crypto")}
                    disabled={requesting || !payouts.walletAddress.configured || belowThreshold}
                    className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-950/30"
                    title={
                      belowThreshold
                        ? t("creator.payout.belowThreshold", "You need at least {{amount}} to withdraw", { amount: formatNgn(payouts.minPayoutKobo) })
                        : !payouts.walletAddress.configured
                          ? t("creator.payout.addWallet", "Add a wallet address first")
                          : undefined
                    }
                  >
                    {requesting ? t("creator.payout.requesting", "Requesting…") : t("creator.payout.requestCrypto", "Request (Crypto)")}
                  </button>
                )}
              </div>
            )}
          </div>
          {(cfg?.bankTransferEnabled || cfg?.cryptoEnabled) && (
            <ThresholdProgressBar availableKobo={payouts.availableEarningsKobo} minKobo={payouts.minPayoutKobo} />
          )}
        </div>

        {payouts.pendingPayout && (
          <p className="mb-3 text-xs text-neutral-500">
            {t("creator.payout.inProgress", "A payout ({{method}}) is already in progress.", { method: payouts.pendingPayout.method })}
          </p>
        )}
        {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {payouts.payouts.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                  <th className="px-4 py-2.5 text-left font-semibold">{t("creator.payout.amount", "Amount")}</th>
                  <th className="px-4 py-2.5 text-left font-semibold">{t("creator.payout.method", "Method")}</th>
                  <th className="px-4 py-2.5 text-left font-semibold">{t("creator.payout.status", "Status")}</th>
                  <th className="px-4 py-2.5 text-left font-semibold">{t("creator.payout.requestedAt", "Requested")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {payouts.payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatNgn(p.netKobo)}</td>
                    <td className="px-4 py-3 capitalize text-neutral-500">{p.method.replace("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[p.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {p.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPin && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowPin(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
            <h3 className="mb-3 text-base font-bold text-neutral-900 dark:text-neutral-50">{t("creator.payout.enterPin", "Enter your PIN")}</h3>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-center text-xl tracking-widest focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowPin(false)}
                className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
              >
                {t("creator.payout.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void handlePinVerify()}
                disabled={requesting || pin.length < 4}
                className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {t("creator.payout.confirm", "Confirm")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
