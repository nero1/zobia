"use client";

/**
 * Creator USDT/Tron wallet address page (global creators).
 *
 * Lets creators add, update, or remove their Tron wallet address for
 * receiving USDT crypto payouts (processed manually by admin).
 *
 * Prominent warning about the irreversibility of incorrect addresses.
 */

import { useState, useEffect } from "react";

interface WalletData {
  hasWallet: boolean;
  addressMasked?: string;
  network?: string;
  currency?: string;
}

export default function WalletAddressPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [pinOrCode, setPinOrCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    fetch("/api/creator/wallet-address")
      .then((r) => r.json())
      .then(setWallet)
      .catch(() => setWallet({ hasWallet: false }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      setError("Please confirm you have read and understood the warning.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/creator/wallet-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          pinOrCode: pinOrCode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to save wallet address.");
        return;
      }
      setWallet({
        hasWallet: true,
        addressMasked: data.addressMasked,
        network: "tron",
        currency: "USDT",
      });
      setEditing(false);
      setAddress("");
      setPinOrCode("");
      setConfirmed(false);
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
      const res = await fetch("/api/creator/wallet-address", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinOrCode: pinOrCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to remove wallet.");
        return;
      }
      setWallet({ hasWallet: false });
      setShowDeleteModal(false);
      setPinOrCode("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
        USDT Wallet Address
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Add your Tron (TRC20) wallet address to receive USDT crypto payouts.
        Payouts are processed manually by our team.
      </p>

      {/* Critical warning */}
      <div className="mb-6 rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4">
        <div className="flex items-start gap-2">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <div className="text-sm text-red-800 dark:text-red-300">
            <p className="font-bold mb-1">Important — Read Before Proceeding</p>
            <p>
              This <strong>must be a Tron (TRC20) network</strong> wallet address that can receive USDT.
              If you enter an incorrect address, or an address from a different network,
              <strong> funds sent to it will be permanently lost and cannot be recovered or resent</strong>.
              You bear full responsibility for the accuracy of this address.
            </p>
          </div>
        </div>
      </div>

      {/* Current wallet */}
      {wallet?.hasWallet && !editing && (
        <div className="mb-6 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Current Wallet</p>
              <p className="font-mono text-sm text-neutral-900 dark:text-neutral-50">
                {wallet.addressMasked}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                {wallet.network?.toUpperCase()} — {wallet.currency}
              </p>
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 rounded px-2 py-1">
              Saved
            </span>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Update address
            </button>
            <span className="text-neutral-300 dark:text-neutral-600">|</span>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Form */}
      {(!wallet?.hasWallet || editing) && (
        <form onSubmit={handleSave} className="space-y-4">
          {wallet?.hasWallet && editing && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                PIN / Password
              </label>
              <input
                type="password"
                value={pinOrCode}
                onChange={(e) => setPinOrCode(e.target.value)}
                placeholder="Required to update wallet"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Tron (TRC20) USDT Wallet Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder="T…"
              maxLength={34}
              required
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Must start with 'T' and be exactly 34 characters.
            </p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span className="text-sm text-neutral-700 dark:text-neutral-300">
              I confirm that this is a valid Tron (TRC20) USDT wallet address and I understand
              that any funds sent to an incorrect address cannot be recovered.
            </span>
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save Wallet Address"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => { setEditing(false); setError(null); setAddress(""); setPinOrCode(""); setConfirmed(false); }}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="text-2xl mb-3">🔐</div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 mb-2">
              Protect Your Account
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-5">
              Set a PIN to protect sensitive actions like updating your payout wallet address.
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
                I'll do this later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 mb-2">
              Remove Wallet Address
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              Enter your PIN or password to confirm.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <input
              type="password"
              value={pinOrCode}
              onChange={(e) => setPinOrCode(e.target.value)}
              placeholder="PIN / password"
              className="w-full mb-4 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm"
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
                onClick={() => { setShowDeleteModal(false); setError(null); setPinOrCode(""); }}
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
