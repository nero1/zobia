"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CryptoPaymentDialog, type CryptoQuote } from "./CryptoPaymentDialog";
interface PendingPayment { reference: string; createdAt: string; quote: CryptoQuote }
export function PendingCryptoPayments() {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [selected, setSelected] = useState<PendingPayment>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/economy/crypto/pending", { credentials: "include", cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Unable to load pending payments");
    setPayments(result.data);
  }, []);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "Unable to load pending payments")); }, [load]);
  if (!payments.length && !error) return null;
  return <section className="rounded-xl border p-4 space-y-3"><h2 className="font-semibold">{t("checkout.pending", "Pending crypto payments")}</h2>{error && <p role="alert">{error}</p>}{payments.map(payment => <div className="flex flex-wrap items-center justify-between gap-2" key={payment.reference}><span>{payment.quote.expectedDisplayAmount} {payment.quote.currency} · {new Date(payment.createdAt).toLocaleDateString()}</span><button type="button" className="rounded-full border px-3 py-2 text-sm" onClick={() => setSelected(payment)}>{t("checkout.resumePayment", "Resume payment")}</button></div>)}{selected && <CryptoPaymentDialog key={selected.reference} {...selected} onClose={() => setSelected(undefined)} onComplete={load} />}</section>;
}
