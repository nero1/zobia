'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Link from '@/components/ui/Link';
export function MobileBridgeConfirmation({intentId,username,impersonating}:{intentId?:string;username?:string;impersonating?:boolean}) {
  const {t} = useTranslation();
  return <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
    <Card role="region" className="w-full max-w-sm p-8" aria-labelledby="bridge-title">
      <h1 id="bridge-title" className="mb-4 text-xl font-bold text-neutral-900 dark:text-white">{t(intentId ? 'mobileBridge.title' : 'mobileBridge.expiredTitle')}</h1>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">{t(intentId ? 'mobileBridge.body' : 'mobileBridge.expiredBody')}</p>
      {intentId && <>
        <p className="mb-4 break-words font-semibold text-neutral-900 dark:text-white">@{username}</p>
        {impersonating && <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">{t('mobileBridge.impersonation')}</p>}
        <form action="/api/auth/mobile-bridge/consume" method="post">
          <input type="hidden" name="intent" value={intentId} />
          <Button type="submit" fullWidth className="mb-4">{t('common.continue')}</Button>
        </form>
      </>}
      <Link href={intentId ? "/" : "/auth/login"} className="text-sm font-medium text-neutral-700 underline dark:text-neutral-200">{t(intentId ? 'action.cancel' : 'authError.tryAgainBtn')}</Link>
    </Card>
  </main>;
}
