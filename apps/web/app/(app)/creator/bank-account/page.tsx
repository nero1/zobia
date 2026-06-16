"use client";

/**
 * Creator bank account setup page (Nigerian creators).
 *
 * Two-step flow:
 *   1. Enter account number + select bank → API resolves account name via Paystack
 *   2. Confirm account details → API creates Paystack transfer recipient
 *
 * Security gate: editing or deleting an existing account requires PIN/password.
 * PIN encouragement modal shown after first successful add if no auth is set.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_NIGERIAN_BANKS } from "@/lib/payments/supported-banks";
import { translateApiError } from "@/lib/i18n/apiErrors";

type Step = "idle" | "confirm" | "success";

interface BankAccountData {
  hasAccount: boolean;
  bankName?: string;
  accountName?: string;
  accountNumberLast4?: string;
}

interface ResolveResult {
  accountName: string;
  bankName: string;
  accountNumberLast4: string;
}

export default function BankAccountPage() {
  const [account, setAccount] = useState<BankAccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [accountNumber, setAccountNumber] = useState("");
  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [selectedBankName, setSelectedBankName] = useState("");
  const [pinOrCode, setPinOrCode] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);

  useEffect(() => {
    fetch("/api/creator/bank-account")
      .then((r) => r.json())
      .then(setAccount)
      .catch(() => setAccount({ hasAccount: false }))
      .finally(() => setLoading(false));
  }, []);

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^\d{10}$/.test(accountNumber)) {
      setError("Account number must be exactly 10 digits.");
      return;
    }
    if (!selectedBankCode) {
      setError("Please select a bank.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/creator/bank-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber,
          bankCode: selectedBankCode,
          bankName: selectedBankName,
          confirmed: false,
          ...(account?.hasAccount ? { pinOrCode } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to verify account.");
        return;
      }
      setResolveResult({
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberLast4: data.accountNumberLast4,
      });
      setStep("confirm");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!resolveResult) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/creator/bank-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber,
          bankCode: selectedBankCode,
          bankName: selectedBankName,
          confirmed: true,
          accountName: resolveResult.accountName,
          pinOrCode: pinOrCode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to save account.");
        return;
      }
      setAccount({
        hasAccount: true,
        bankName: selectedBankName,
        accountName: resolveResult.accountName,
        accountNumberLast4: resolveResult.accountNumberLast4,
      });
      setStep("success");
      if (data.showPinModal) setShowPinModal(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/creator/bank-account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinOrCode: pinOrCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to remove account.");
        return;
      }
      setAccount({ hasAccount: false });
      setDeleteMode(false);
      setShowAuthModal(false);
      setPinOrCode("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep("idle");
    setAccountNumber("");
    setSelectedBankCode("");
    setSelectedBankName("");
    setPinOrCode("");
    setResolveResult(null);
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-neutral-500 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50 mb-1">
        Bank Account
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Add your Nigerian bank account to receive payout transfers via Paystack.
      </p>

      {/* Current account status */}
      {account?.hasAccount && step === "idle" && (
        <div className="mb-6 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Current Account</p>
              <p className="font-semibold text-neutral-900 dark:text-neutral-50">{account.accountName}</p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {account.bankName} ····{account.accountNumberLast4}
              </p>
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 rounded px-2 py-1">
              Verified
            </span>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { reset(); setStep("idle"); }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Update account
            </button>
            <span className="text-neutral-300 dark:text-neutral-600">|</span>
            <button
              onClick={() => { setDeleteMode(true); setShowAuthModal(true); }}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Pending payout warning */}
      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
        <strong>Note:</strong> When you request a payout, your bank account details are locked at that moment. Updating your account afterwards will not affect any in-progress payouts.
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Form */}
      {step === "idle" && (
        <form onSubmit={handleResolve} className="space-y-4">
          {account?.hasAccount && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                PIN / Authenticator Code / Password
              </label>
              <input
                type="password"
                value={pinOrCode}
                onChange={(e) => setPinOrCode(e.target.value)}
                placeholder="Required to update account"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Bank
            </label>
            <select
              value={selectedBankCode}
              onChange={(e) => {
                const bank = SUPPORTED_NIGERIAN_BANKS.find((b) => b.code === e.target.value);
                setSelectedBankCode(e.target.value);
                setSelectedBankName(bank?.name ?? "");
              }}
              required
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select bank…</option>
              {SUPPORTED_NIGERIAN_BANKS.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Account Number
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit account number"
              required
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Verifying…" : "Verify Account"}
          </button>
        </form>
      )}

      {/* Step 2: Confirm */}
      {step === "confirm" && resolveResult && (
        <div className="space-y-4">
          <div className="rounded-lg border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 p-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">Are these details correct?</p>
            <p className="font-bold text-neutral-900 dark:text-neutral-50 text-lg">{resolveResult.accountName}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {resolveResult.bankName} ····{resolveResult.accountNumberLast4}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Yes, Save"}
            </button>
            <button
              onClick={reset}
              disabled={submitting}
              className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              No, Edit
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {step === "success" && (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 mb-1">Account Saved</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
            Your bank account has been verified and saved. Payouts will be sent to this account.
          </p>
          <button
            onClick={reset}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Done
          </button>
        </div>
      )}

      {/* PIN Encouragement Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="text-2xl mb-3">🔐</div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 mb-2">
              Protect Your Account
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-5">
              We recommend setting a PIN to protect sensitive actions like changing your bank account or requesting payouts.
            </p>
            <div className="flex gap-3">
              <a
                href="/settings/security"
                className="flex-1 text-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                onClick={() => setShowPinModal(false)}
              >
                Set PIN
              </a>
              <button
                onClick={() => setShowPinModal(false)}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300"
              >
                I&apos;ll do this later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth modal for delete */}
      {showAuthModal && deleteMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 mb-2">
              Remove Bank Account
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              Enter your PIN, authenticator code, or password to confirm removal.
            </p>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
            )}
            <input
              type="password"
              value={pinOrCode}
              onChange={(e) => setPinOrCode(e.target.value)}
              placeholder="PIN / code / password"
              className="w-full mb-4 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? "Removing…" : "Remove"}
              </button>
              <button
                onClick={() => { setShowAuthModal(false); setDeleteMode(false); setError(null); setPinOrCode(""); }}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
