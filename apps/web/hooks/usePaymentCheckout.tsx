"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CryptoPaymentDialog, type CryptoQuote } from "@/components/wallet/CryptoPaymentDialog";
export interface CheckoutResult { paymentUrl?: string; paymentReference?: string; reference?: string; free?: boolean; crypto?: CryptoQuote | null }
export function usePaymentCheckout(onComplete?: () => void | Promise<void>) {
  const { t } = useTranslation();
  const [payment, setPayment] = useState<{ quote: CryptoQuote; reference: string; complete: () => void | Promise<void> }>();
  async function checkout(result: CheckoutResult, complete = onComplete) {
    if (result.paymentUrl) {
      const url = new URL(result.paymentUrl, window.location.origin);
      if (!["http:","https:"].includes(url.protocol)) throw new Error(t("checkout.invalidUrl", "Invalid checkout address"));
      window.location.assign(url.href); return;
    }
    if (result.crypto) {
      const reference = result.paymentReference ?? result.reference;
      if (!reference) throw new Error(t("checkout.missingReference", "Payment reference is missing"));
      setPayment({ quote: result.crypto, reference, complete: complete ?? (() => {}) }); return;
    }
    if (!result.free) throw new Error(t("checkout.notConfirmed", "Payment has not been confirmed"));
    await complete?.();
  }
  return { checkout, checkoutDialog: payment ? <CryptoPaymentDialog key={payment.reference} quote={payment.quote} reference={payment.reference} onClose={() => setPayment(undefined)} onComplete={payment.complete} /> : null };
}
