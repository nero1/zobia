"use client";

/**
 * app/(app)/settings/business/callback/page.tsx
 *
 * Paystack redirect target after a business account signup or tier-upgrade
 * checkout. Mirrors app/(app)/settings/subscription/callback/page.tsx — the
 * actual account creation / tier activation happens via the Paystack webhook
 * (lib/payments/paystackWebhookHandler.ts, itemType "business_signup" /
 * "business_upgrade"), so this page just shows a brief "Processing…" message
 * and redirects to the business settings page once the webhook has had a
 * moment to land.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BusinessCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/settings/business?refreshed=1");
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-600 dark:border-neutral-700 dark:border-t-blue-400" />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            Processing your business account&hellip;
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Hang tight — we&apos;re confirming your payment. You&apos;ll be
            redirected in a moment.
          </p>
        </div>
      </div>
    </div>
  );
}
