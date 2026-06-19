"use client";

/**
 * app/(app)/settings/subscription/callback/page.tsx
 *
 * Paystack redirect target after a subscription checkout.
 * The actual subscription credit is handled by the Paystack webhook on the
 * backend, so this page simply shows a brief "Processing…" message and then
 * redirects the user to the subscription settings page so they can see the
 * updated plan.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SubscriptionCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/settings/subscription?refreshed=1");
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* Spinner */}
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-600 dark:border-neutral-700 dark:border-t-blue-400" />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            Processing your subscription&hellip;
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Hang tight — we&apos;re confirming your plan upgrade. You&apos;ll be
            redirected in a moment.
          </p>
        </div>
      </div>
    </div>
  );
}
