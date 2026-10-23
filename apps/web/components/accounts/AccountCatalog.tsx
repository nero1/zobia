"use client";
import { useMemo } from "react";
import { AccountsPanel, AccountProductPicker } from "@zobia/shared/ui/Accounts";
import type { TalesTransport } from "@zobia/shared/ui/Tales";
import { usePaymentCheckout, type CheckoutResult } from "@/hooks/usePaymentCheckout";
import { useAccountCatalog } from "@/hooks/useAccountCatalog";
import type { AccountProduct } from "@zobia/shared/ui/Accounts";
const emptyProducts: AccountProduct[] = [];

export function useAccountTransport() {
  return useMemo<TalesTransport>(() => ({
    navigate: path => window.location.assign(path),
    request: async <T,>(path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`/api${path}`, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to complete request");
      return (Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result) as T;
    },
  }), []);
}
export function AccountAdmin() { return <AccountsPanel api={useAccountTransport()} />; }
export function PersonalAccountProducts({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const api = useAccountTransport();
  const catalog = useAccountCatalog();
  const { checkout, checkoutDialog } = usePaymentCheckout(onChanged);
  return <>{checkoutDialog}<AccountProductPicker api={api} catalog={catalog.data ?? emptyProducts} kind="personal" buy={async (product, interval) => {
    if (product.basePlan === "free") await api.request("/accounts/select", "POST", { slug: product.slug });
    else {
      const result = await api.request<CheckoutResult>("/economy/subscriptions", "POST", { plan: product.slug, billingCycle: interval });
      await checkout(result); return;
    }
    await onChanged?.();
  }} /></>;
}

export function BusinessAccountProducts({ exists, businessName, businessType, onChanged }: { exists: boolean; businessName: string; businessType: string; onChanged: () => void | Promise<void> }) {
  const api = useAccountTransport();
  const catalog = useAccountCatalog();
  const { checkout, checkoutDialog } = usePaymentCheckout(onChanged);
  return <>{checkoutDialog}<AccountProductPicker api={api} catalog={catalog.data ?? emptyProducts} kind="business" buy={async product => {
    if (!exists && !businessName.trim()) throw new Error("Enter a business name before selecting an account type");
    const result = await api.request<CheckoutResult & { downgradeEffectiveAt?: string; downgradeCancelled?: boolean }>(exists ? "/business/tier" : "/business", exists ? "PATCH" : "POST", { tier: product.basePlan, accountTypeSlug: product.slug, ...(!exists ? { business_name: businessName.trim(), business_type: businessType } : {}) });
    if (result.downgradeEffectiveAt || result.downgradeCancelled) await onChanged();
    else await checkout(result);
  }} /></>;
}
