/**
 * apps/android/src/components/wallet/CryptoBalancesSection.tsx
 *
 * Android counterpart of apps/web/components/wallet/CryptoBalancesSection.tsx
 * — only rendered once an admin has enabled crypto-native payouts
 * (lib/payments/crypto/payouts.ts). Shows the user's per-currency crypto
 * balances and recent transactions natively (read-only, no payment/purchase
 * action — this is money the user has *earned*, not a purchase, so it does
 * not need Google Play Billing).
 *
 * Adding a wallet address and requesting a withdrawal hand off to the
 * authenticated web view (openAuthenticatedWebLink), the same pattern
 * creator/wallet.tsx and creator/bank-account.tsx already use for
 * irreversible-if-wrong financial detail entry (PIN/2FA-gated on web).
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';

interface CryptoBalance {
  currency: string;
  chain: 'bsc' | 'solana';
  balanceBaseUnits: string;
  decimals: number;
  thresholdBaseUnits: string;
}

interface CryptoTransaction {
  id: string;
  currency: string;
  amountBaseUnits: string;
  sourceType: string;
  createdAt: string;
  scanUrl: string | null;
}

interface BalancesResponse {
  enabled: boolean;
  balances: CryptoBalance[];
  transactions: CryptoTransaction[];
}

function formatUnits(baseUnits: string, decimals: number): string {
  const n = BigInt(baseUnits);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = (n % divisor).toString().padStart(decimals, '0').slice(0, 4);
  return `${whole}.${frac}`;
}

async function fetchBalances(): Promise<BalancesResponse> {
  const { data } = await apiClient.get<{ data: BalancesResponse }>('/economy/crypto/balances');
  return data.data;
}

export function CryptoBalancesSection() {
  const { t } = useTranslation();
  const { data, status } = useQuery({ queryKey: ['wallet', 'crypto', 'balances'], queryFn: fetchBalances });

  if (status !== 'success' || !data.enabled) return null;
  const { balances, transactions } = data;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 shadow-card">
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t('wallet.crypto.title', 'Crypto Balances')}
      </h2>

      {balances.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t('wallet.crypto.empty', 'No crypto earnings yet.')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {balances.map((b) => (
            <div key={b.currency} className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2">
              <div>
                <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  {formatUnits(b.balanceBaseUnits, b.decimals)} {b.currency}
                </p>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{b.chain === 'bsc' ? 'BNB Smart Chain' : 'Solana'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void openAuthenticatedWebLink('/wallet')}
        className="mt-3 w-full rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
      >
        {t('wallet.crypto.manageOnWeb', 'Add wallet / Withdraw (opens secure web page)')}
      </button>

      {transactions.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('wallet.crypto.transactions', 'Transactions')}
          </p>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {transactions.slice(0, 10).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <p className="font-medium capitalize text-neutral-800 dark:text-neutral-200">{tx.sourceType.replace(/_/g, ' ')}</p>
                  <p className="text-neutral-400 dark:text-neutral-500">{new Date(tx.createdAt).toLocaleDateString()}</p>
                </div>
                <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {tx.amountBaseUnits} {tx.currency}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
