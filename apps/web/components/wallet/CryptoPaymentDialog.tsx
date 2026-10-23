"use client";
import {AccessibleDialog} from "@zobia/shared/ui/Dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface CryptoQuote {
  currency: string; chain: "bsc" | "solana"; receivingAddress: string;
  expectedDisplayAmount: string; expectedBaseUnits: string; tokenContract: string | null;
}
export function CryptoPaymentDialog({ quote, reference, onClose, onComplete }: { quote: CryptoQuote; reference: string; onClose: () => void; onComplete: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [sender, setSender] = useState("");
  const [hash, setHash] = useState("");
  const [signature, setSignature] = useState("");
  const [proofMessage, setProofMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void fetch(`/api/economy/crypto/proof?ref=${encodeURIComponent(reference)}`, { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject(new Error("Unable to load wallet proof"))).then(r => setProofMessage(r.data.message)).catch(e => setError(e.message)); }, [reference]);
  async function signOwnership() {
    setError("");
    try {
      const provider = window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }; solana?: { connect: () => Promise<{ publicKey: { toString(): string } }>; signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }> } };
      if (quote.chain === "bsc" && provider.ethereum) {
        const accounts = await provider.ethereum.request({ method: "eth_requestAccounts" }) as string[];
        setSender(accounts[0]);
        const bytes = new TextEncoder().encode(proofMessage);
        const hex = "0x" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        setSignature(await provider.ethereum.request({ method: "personal_sign", params: [hex, accounts[0]] }) as string);
      } else if (quote.chain === "solana" && provider.solana) {
        const wallet = await provider.solana.connect(); setSender(wallet.publicKey.toString());
        const signed = await provider.solana.signMessage(new TextEncoder().encode(proofMessage), "utf8");
        setSignature(btoa(String.fromCharCode(...signed.signature)));
      } else throw new Error(t("checkout.signManually", "Sign the displayed message in your wallet and paste the signature below."));
    } catch (e) { setError(e instanceof Error ? e.message : t("checkout.signFailed", "Wallet signing failed")); }
  }
  async function status() {
    const response = await fetch(`/api/economy/crypto/status?ref=${encodeURIComponent(reference)}`, { credentials: "include", cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? t("checkout.confirmFailed", "Unable to verify this payment"));
    if (result.data.status === "completed") { await onComplete(); onClose(); }
    else if (result.data.status === "failed") { setPending(false); throw new Error(t("checkout.confirmFailed", "Unable to verify this payment")); }
  }
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (!stopped) void status().catch(e => setError(e instanceof Error ? e.message : "Unable to verify payment"));
      if (++attempts >= 12) { window.clearInterval(timer); setPending(false); }
    }, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
    // Payment confirmation owns this callback for the lifetime of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, reference]);
  async function confirm() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/economy/crypto/confirm", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: reference, txHash: hash.trim(), senderAddress: sender.trim(), ownershipSignature: signature.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t("checkout.confirmFailed", "Unable to verify this payment"));
      if (result.data.status === "completed") { await onComplete(); onClose(); }
      else if (result.data.status === "failed") throw new Error(t("checkout.confirmFailed", "Unable to verify this payment"));
      else setPending(true);
    } catch (e) { setError(e instanceof Error ? e.message : t("checkout.confirmFailed", "Unable to verify this payment")); }
    finally { setBusy(false); }
  }
  return <AccessibleDialog aria-labelledby="crypto-payment-title" onClose={onClose} className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4"><section className="my-auto w-full max-w-lg rounded-2xl bg-card p-5 text-card-foreground space-y-4">
    <h2 id="crypto-payment-title" className="text-xl font-bold">{t("payment.crypto.title", "Pay with Crypto")}</h2>
    <p>{t("checkout.sendExact", "Send exactly {{amount}} {{currency}} using the {{network}} network, then enter the transaction details below.", { amount: quote.expectedDisplayAmount, currency: quote.currency, network: quote.chain === "bsc" ? "BNB Smart Chain" : "Solana" })}</p>
    <div className="rounded-xl border p-3 break-all"><p className="font-semibold">{t("checkout.recipient", "Payment address")}</p><code>{quote.receivingAddress}</code><button type="button" className="block text-sm underline mt-2" onClick={() => void navigator.clipboard.writeText(quote.receivingAddress).catch(() => setError(t("checkout.copyManually", "Select and copy the address manually")))}>{t("common.copy", "Copy")}</button></div>
    {quote.tokenContract && <p className="text-xs break-all">{t("checkout.tokenContract", "Token contract")}: {quote.tokenContract}</p>}
    <p className="text-sm">{t("checkout.waitForConfirmation", "Your account changes only after the transaction is verified. Keep this screen open while you complete the payment in your wallet.")}</p>
    <p className="text-sm">{t("checkout.resume", "You can reopen a pending payment from your Wallet if you close this screen.")}</p>
    <label className="block text-sm">{t("checkout.sender", "Sending wallet address")}<input className="mt-1 w-full rounded-lg border bg-transparent p-2" value={sender} onChange={e => setSender(e.target.value)} autoComplete="off" spellCheck={false} /></label>
    <label className="block text-sm">{t("checkout.hash", "Transaction hash or signature")}<input className="mt-1 w-full rounded-lg border bg-transparent p-2" value={hash} onChange={e => setHash(e.target.value)} autoComplete="off" spellCheck={false} /></label>
    <div className="rounded-xl border border-border bg-muted p-3 space-y-2"><p>{t("checkout.proveOwnership", "Prove that you own the sending wallet")}</p><pre className="whitespace-pre-wrap break-words text-xs">{proofMessage}</pre><button type="button" disabled={!proofMessage || busy} onClick={() => void signOwnership()} className="rounded-full bg-primary text-primary-foreground px-4 py-2">{t("checkout.signOwnership", "Sign with wallet")}</button><label className="block text-sm">{t("checkout.ownershipSignature", "Wallet ownership signature")}<textarea value={signature} onChange={e => setSignature(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background p-2" /></label></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {pending && <p role="status">{t("payment.crypto.waitingForConfirmation", "Waiting for confirmation...")}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || pending || !hash.trim() || !sender.trim() || !signature.trim()} onClick={() => void confirm()} className="rounded-full bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{t("checkout.verify", "Verify payment")}</button><button type="button" onClick={onClose} className="rounded-full border px-4 py-2">{t("common.close", "Close")}</button></div>
    <p className="text-xs text-neutral-500 break-all">{t("checkout.reference", "Payment reference")}: {reference}</p>
  </section></AccessibleDialog>;
}
