/**
 * apps/android/src/routes/creator/wallet.tsx
 *
 * Creator USDT/Tron payout wallet — mirrors apps/web/app/(app)/creator/
 * wallet/page.tsx (global creators, crypto payouts processed manually).
 *
 * Same judgment call as creator/bank-account.tsx: irreversible-if-wrong
 * crypto address entry with PIN/2FA/password gating on edit/delete is kept
 * read-mostly here, handing off add/update/remove to the web flow.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';

interface WalletData {
  hasWallet: boolean;
  addressMasked?: string;
  network?: string;
  currency?: string;
}

async function fetchWallet(): Promise<WalletData> {
  const { data } = await apiClient.get<WalletData>('/creator/wallet-address');
  return data;
}

function CreatorWalletPage() {
  const { t } = useTranslation();
  const { data: wallet, status } = useQuery({ queryKey: ['creator', 'wallet-address'], queryFn: fetchWallet });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('creator.wallet.title', 'USDT Wallet Address')}</h1>
      <p className="text-sm text-neutral-500">
        {t('creator.wallet.desc', 'Add your Tron (TRC20) wallet address to receive USDT crypto payouts, processed manually by our team.')}
      </p>

      <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
        <p className="text-sm text-red-800">
          <strong>{t('creator.wallet.warningTitle', 'Important')}</strong> — {t('creator.wallet.warningBody', 'this must be a Tron (TRC20) address. Funds sent to an incorrect address cannot be recovered.')}
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        {status === 'pending' ? (
          <div className="h-10 animate-pulse rounded-lg bg-neutral-100" />
        ) : wallet?.hasWallet ? (
          <>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">{t('creator.wallet.currentWallet', 'Current Wallet')}</p>
            <p className="font-mono text-sm text-neutral-900">{wallet.addressMasked}</p>
            <p className="text-xs text-neutral-500">{wallet.network?.toUpperCase()} — {wallet.currency}</p>
          </>
        ) : (
          <p className="text-sm text-neutral-500">{t('creator.wallet.noWallet', 'No wallet address on file yet.')}</p>
        )}
        <button
          onClick={() => void openAuthenticatedWebLink('/creator/wallet')}
          className="mt-3 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {wallet?.hasWallet ? t('creator.bankAccount.manageBtn', 'Manage on web') : t('creator.bankAccount.addBtn', 'Add on web')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/creator/wallet')({
  component: CreatorWalletPage,
});
