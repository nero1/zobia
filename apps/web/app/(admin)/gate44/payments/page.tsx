"use client";

/**
 * app/(admin)/gate44/payments/page.tsx
 *
 * Per-payment-context Paystack / crypto-currency / free toggles, crypto
 * price-feed settings (discounts, manual overrides, refresh interval), and
 * the sitewide "make all payments free" Danger Zone action.
 *
 * The global gate44/config page still holds the single
 * payment.primaryProvider knob and the master Paystack/crypto enabled
 * switches — this page is the granular per-context layer on top of that.
 */

import { useState, useEffect, useCallback } from "react";

const CURRENCIES = ["JAGA", "BNB", "SOL"] as const;
type Currency = (typeof CURRENCIES)[number];

interface ContextRow {
  contextKey: string;
  label: string;
  paystackEnabled: boolean;
  cryptoEnabledCurrencies: Currency[];
  isFree: boolean;
}

interface CryptoConfig {
  discounts: Record<Currency, number>;
  refreshMinutes: number;
  prices: { symbol: Currency; usdPrice: string | null; source: string; fetchedAt?: string }[];
  receivingAddressesConfigured: { bsc: boolean; solana: boolean };
}

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const show = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);
  return { toast, show };
}

export default function AdminPaymentsPage() {
  const { toast, show } = useToast();
  const [rows, setRows] = useState<ContextRow[]>([]);
  const [crypto, setCrypto] = useState<CryptoConfig | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [confirmFreeOpen, setConfirmFreeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ctxRes, cryptoRes] = await Promise.all([
        fetch("/api/admin/payments/contexts", { credentials: "include" }),
        fetch("/api/admin/payments/crypto", { credentials: "include" }),
      ]);
      const ctxBody = await ctxRes.json();
      const cryptoBody = await cryptoRes.json();
      if (ctxRes.ok) setRows(ctxBody.data);
      if (cryptoRes.ok) setCrypto(cryptoBody.data);
    } catch {
      show("Failed to load payment settings", "error");
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { load(); }, [load]);

  async function patchOne(contextKey: string, patch: Partial<ContextRow>) {
    const res = await fetch("/api/admin/payments/contexts", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextKey, ...patch }),
    });
    const body = await res.json();
    if (!res.ok) { show(body.error?.message ?? "Update failed", "error"); return; }
    setRows(body.data);
  }

  async function bulkPatch(patch: Partial<Pick<ContextRow, "paystackEnabled" | "cryptoEnabledCurrencies" | "isFree">>) {
    if (selected.size === 0) { show("Select at least one row first", "error"); return; }
    const res = await fetch("/api/admin/payments/contexts", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextKeys: Array.from(selected), patch }),
    });
    const body = await res.json();
    if (!res.ok) { show(body.error?.message ?? "Bulk update failed", "error"); return; }
    setRows(body.data);
    show(`Updated ${selected.size} context(s)`);
  }

  async function saveDiscount(symbol: Currency, value: number) {
    const res = await fetch("/api/admin/payments/crypto", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discounts: { [symbol]: value } }),
    });
    if (!res.ok) { show("Failed to save discount", "error"); return; }
    show(`${symbol} discount saved`);
    load();
  }

  async function makeAllFree() {
    const res = await fetch("/api/admin/payments/make-all-free", { method: "POST", credentials: "include" });
    const body = await res.json();
    if (!res.ok) { show(body.error?.message ?? "Failed", "error"); return; }
    setRows(body.data.map((s: ContextRow) => ({ ...s })));
    show("All payments are now free sitewide.");
    setConfirmFreeOpen(false);
  }

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Payments</h1>
      <p className="text-sm text-neutral-500">
        Per-context Paystack / crypto currency toggles and free bypass. The global default
        provider and master switches live on <a href="/gate44/config" className="underline">gate44/config</a>.
      </p>

      {/* Context table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500 dark:border-neutral-800">
              <th className="p-3"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.contextKey)) : new Set())} /></th>
              <th className="p-3">Context</th>
              <th className="p-3">Paystack (NG)</th>
              <th className="p-3">Crypto currencies</th>
              <th className="p-3">Free</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contextKey} className="border-b border-neutral-100 dark:border-neutral-800">
                <td className="p-3"><input type="checkbox" checked={selected.has(row.contextKey)} onChange={() => toggleSelected(row.contextKey)} /></td>
                <td className="p-3 font-medium text-neutral-800 dark:text-neutral-200">{row.label}</td>
                <td className="p-3">
                  <input type="checkbox" checked={row.paystackEnabled} onChange={(e) => patchOne(row.contextKey, { paystackEnabled: e.target.checked })} />
                </td>
                <td className="p-3">
                  <div className="flex gap-3">
                    {CURRENCIES.map((c) => (
                      <label key={c} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={row.cryptoEnabledCurrencies.includes(c)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...row.cryptoEnabledCurrencies, c]
                              : row.cryptoEnabledCurrencies.filter((x) => x !== c);
                            patchOne(row.contextKey, { cryptoEnabledCurrencies: next });
                          }}
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={row.isFree} onChange={(e) => patchOne(row.contextKey, { isFree: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => bulkPatch({ cryptoEnabledCurrencies: [] })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">Turn off crypto for selected</button>
        <button onClick={() => bulkPatch({ paystackEnabled: false })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">Turn off Paystack for selected</button>
        <button onClick={() => bulkPatch({ isFree: true })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">Mark selected free</button>
        <button onClick={() => bulkPatch({ isFree: false })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">Mark selected not free</button>
      </div>

      {/* Crypto price-feed settings */}
      {crypto && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Crypto price feed</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Refresh interval: {crypto.refreshMinutes} minutes (lazy — refreshed on next read once stale, not on a fixed
            schedule). Receiving addresses configured: BSC {crypto.receivingAddressesConfigured.bsc ? "✅" : "❌ set CRYPTO_RECEIVING_ADDRESS_BSC"},
            Solana {crypto.receivingAddressesConfigured.solana ? "✅" : "❌ set CRYPTO_RECEIVING_ADDRESS_SOLANA"}.
          </p>
          <div className="mt-3 space-y-2">
            {crypto.prices.map((p) => (
              <div key={p.symbol} className="flex items-center gap-3 text-sm">
                <span className="w-12 font-mono">{p.symbol}</span>
                <span>{p.usdPrice ? `$${p.usdPrice}` : "unavailable"}</span>
                <span className="text-xs text-neutral-500">({p.source})</span>
                <label className="ml-auto flex items-center gap-1 text-xs">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={90}
                    defaultValue={crypto.discounts[p.symbol]}
                    className="w-16 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-800"
                    onBlur={(e) => saveDiscount(p.symbol, Number(e.target.value))}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger Zone — this button also appears in gate44/config (or wherever
          the global admin Danger Zone lives) — any change to its behavior
          must be mirrored there. Both call the same
          POST /api/admin/payments/make-all-free endpoint. */}
      <div className="rounded-xl border border-red-300 dark:border-red-900">
        <div className="rounded-t-xl bg-red-100 px-4 py-2 dark:bg-red-950/50">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Danger Zone</h2>
        </div>
        <div className="space-y-3 rounded-b-xl bg-red-50/60 p-5 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Make all payments free</p>
          <p className="text-xs text-neutral-500">Sets every payment context above to Free, sitewide, immediately.</p>
          <button onClick={() => setConfirmFreeOpen(true)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
            Make all payments free
          </button>
        </div>
      </div>

      {confirmFreeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 dark:bg-neutral-900">
            <p className="mb-4 text-sm font-semibold text-red-700 dark:text-red-400">
              WARNING: This will make all products and services free sitewide.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmFreeOpen(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">Cancel</button>
              <button onClick={makeAllFree} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white">Yes, make everything free</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 rounded-lg px-4 py-2 text-sm text-white ${toast.type === "error" ? "bg-red-600" : "bg-green-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
