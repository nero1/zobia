"use client";

/**
 * components/wallet/CryptoBalancesSection.tsx
 *
 * Crypto tab of the Zobia Wallet — only rendered when an admin has enabled
 * crypto-native payouts (lib/payments/crypto/payouts.ts). Shows per-currency
 * balances, a withdraw action gated by the admin threshold, saved wallet
 * addresses per chain, and recent crypto transactions linking out to the
 * chain's block explorer.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

interface CryptoBalance {
  currency: string;
  chain: "bsc" | "solana";
  balanceBaseUnits: string;
  decimals: number;
  thresholdBaseUnits: string;
}

interface CryptoTransaction {
  id: string;
  currency: string;
  amountBaseUnits: string;
  sourceType: string;
  referenceId: string;
  createdAt: string;
  scanUrl: string | null;
}

interface BalancesResponse {
  enabled: boolean;
  balances: CryptoBalance[];
  transactions: CryptoTransaction[];
}

interface SavedWallet {
  chain: string;
  addressMasked: string;
}

function formatUnits(baseUnits: string, decimals: number): string {
  const n = BigInt(baseUnits);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = (n % divisor).toString().padStart(decimals, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

export function CryptoBalancesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [addChain, setAddChain] = useState<"bsc" | "solana" | null>(null);
  const [addAddress, setAddAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ["wallet", "crypto", "balances"],
    queryFn: () => fetchJson<BalancesResponse>("/api/economy/crypto/balances"),
    staleTime: 30_000,
  });

  const walletsQuery = useQuery({
    queryKey: ["wallet", "crypto", "wallets"],
    queryFn: () => fetchJson<SavedWallet[]>("/api/economy/crypto/wallets"),
    enabled: !!balancesQuery.data?.enabled,
    staleTime: 60_000,
  });

  const saveWallet = useMutation({
    mutationFn: () => fetchJson("/api/economy/crypto/wallets", { method: "POST", body: JSON.stringify({ chain: addChain, address: addAddress.trim() }) }),
    onSuccess: () => {
      setAddChain(null);
      setAddAddress("");
      void qc.invalidateQueries({ queryKey: ["wallet", "crypto", "wallets"] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const withdraw = useMutation({
    mutationFn: (currency: string) => fetchJson("/api/economy/crypto/withdraw", { method: "POST", body: JSON.stringify({ currency }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wallet", "crypto", "balances"] }),
    onError: (e) => setError((e as Error).message),
  });

  if (balancesQuery.isPending || !balancesQuery.data?.enabled) return null;
  const { balances, transactions } = balancesQuery.data;
  const wallets = walletsQuery.data ?? [];
  const hasWallet = (chain: string) => wallets.some((w) => w.chain === chain);

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("wallet.crypto.title", "Crypto Balances")}
      </h2>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {balances.length === 0 ? (
        <p className="text-xs text-neutral-500">{t("wallet.crypto.empty", "No crypto earnings yet.")}</p>
      ) : (
        <div className="space-y-2">
          {balances.map((b) => {
            const belowThreshold = BigInt(b.balanceBaseUnits) < BigInt(b.thresholdBaseUnits);
            return (
              <div key={b.currency} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                <div>
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
                    {formatUnits(b.balanceBaseUnits, b.decimals)} {b.currency}
                  </p>
                  <p className="text-[11px] text-neutral-500">{b.chain === "bsc" ? "BNB Smart Chain" : "Solana"}</p>
                </div>
                {hasWallet(b.chain) ? (
                  <button
                    type="button"
                    onClick={() => withdraw.mutate(b.currency)}
                    disabled={belowThreshold || withdraw.isPending}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    title={belowThreshold ? t("wallet.crypto.belowThreshold", "Below minimum withdrawal amount") : undefined}
                  >
                    {t("wallet.crypto.withdraw", "Withdraw")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddChain(b.chain)}
                    className="rounded-lg border border-violet-600 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950"
                  >
                    {t("wallet.crypto.addWallet", "Add wallet")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addChain && (
        <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
          <p className="mb-2 text-xs font-semibold text-violet-800 dark:text-violet-300">
            {t("wallet.crypto.addWalletFor", "Add your {{chain}} wallet address", { chain: addChain === "bsc" ? "BNB Smart Chain" : "Solana" })}
          </p>
          <input
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            value={addAddress}
            onChange={(e) => setAddAddress(e.target.value)}
            placeholder={addChain === "bsc" ? "0x…" : "Solana address"}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setAddChain(null)}
              className="flex-1 rounded-lg border border-neutral-300 py-1.5 text-xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {t("classroom.common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => saveWallet.mutate()}
              disabled={saveWallet.isPending || addAddress.trim().length < 10}
              className="flex-1 rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {t("wallet.crypto.save", "Save")}
            </button>
          </div>
        </div>
      )}

      {transactions.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("wallet.crypto.transactions", "Transactions")}
          </p>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <p className="font-medium capitalize text-neutral-800 dark:text-neutral-200">{tx.sourceType.replace(/_/g, " ")}</p>
                  <p className="text-neutral-400">{new Date(tx.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-neutral-800 dark:text-neutral-200">{tx.amountBaseUnits} {tx.currency}</p>
                  {tx.scanUrl && (
                    <a href={tx.scanUrl} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
                      {t("wallet.crypto.viewOnChain", "View on chain ↗")}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
