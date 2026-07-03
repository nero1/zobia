/**
 * apps/android/src/routes/creator/bank-account.tsx
 *
 * Payout bank account — mirrors apps/web/app/(app)/creator/bank-account/
 * page.tsx (Nigerian bank account, resolved and verified via Paystack).
 *
 * JUDGMENT CALL (see report): this flow is two-phase (resolve account name
 * via Paystack, then confirm), PIN/2FA/password gated for edit/delete, and
 * carries an "incorrect details = lost transfers" risk. Recreating the bank
 * picker + 10-digit resolve/confirm step + inline PIN re-auth natively is a
 * lot of sensitive-data surface for a first pass. This screen is read-mostly:
 * it shows the current bank account via GET, and hands off to the web flow
 * (Custom Tab) for add/update/remove — the same wrapper pattern used for KYC
 * elsewhere in this batch.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';

interface BankAccountData {
  hasAccount: boolean;
  bankName?: string;
  accountName?: string;
  accountNumberLast4?: string;
}

async function fetchBankAccount(): Promise<BankAccountData> {
  const { data } = await apiClient.get<BankAccountData>('/creator/bank-account');
  return data;
}

function CreatorBankAccountPage() {
  const { t } = useTranslation();
  const { data: bank, status } = useQuery({ queryKey: ['creator', 'bank-account'], queryFn: fetchBankAccount });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('creator.bankAccount.title', 'Bank Account')}</h1>
      <p className="text-sm text-neutral-500">
        {t('creator.bankAccount.desc', 'Add your Nigerian bank account to receive payout transfers via Paystack. Adding, updating, or removing it opens the secure web flow.')}
      </p>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        {status === 'pending' ? (
          <div className="h-10 animate-pulse rounded-lg bg-neutral-100" />
        ) : bank?.hasAccount ? (
          <>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">{t('creator.bankAccount.currentAccount', 'Current Account')}</p>
            <p className="font-semibold text-neutral-900">{bank.accountName}</p>
            <p className="text-sm text-neutral-600">{bank.bankName} ····{bank.accountNumberLast4}</p>
            <span className="mt-1 inline-block rounded px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700">{t('creator.bankAccount.verified', 'Verified')}</span>
          </>
        ) : (
          <p className="text-sm text-neutral-500">{t('creator.bankAccount.noAccount', 'No bank account on file yet.')}</p>
        )}
        <button
          onClick={() => void openAuthenticatedWebLink('/creator/bank-account')}
          className="mt-3 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {bank?.hasAccount ? t('creator.bankAccount.manageBtn', 'Manage on web') : t('creator.bankAccount.addBtn', 'Add on web')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/creator/bank-account')({
  component: CreatorBankAccountPage,
});
