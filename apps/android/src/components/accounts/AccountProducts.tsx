import { useMemo } from "react";
import { AccountProductPicker } from "@zobia/shared/ui/Accounts";
import type { TalesTransport } from "@zobia/shared/ui/Tales";
import { apiClient } from "@/lib/api/client";
import { initGooglePlayBilling, purchaseBusinessTier, purchaseSubscription } from "@/lib/payments/googlePlay";
import { useAccountCatalog } from "@/lib/payments/useAccountCatalog";
import type { AccountProduct } from "@zobia/shared/ui/Accounts";
const emptyProducts: AccountProduct[] = [];
export function AccountProducts({ kind = "personal", businessName, businessType, onChanged }: { kind?: "personal" | "business"; businessName?: string; businessType?: string; onChanged?: () => void | Promise<void> }) {
  const catalog = useAccountCatalog();
  const api = useMemo<TalesTransport>(() => ({ navigate: path => window.location.assign(path), request: async <T,>(path: string, method = "GET", body?: unknown) => (await apiClient.request<T>({ url: path, method, data: body })).data }), []);
  return <AccountProductPicker api={api} catalog={catalog.data ?? emptyProducts} storePrice={catalog.price} kind={kind} store buy={async (product, interval) => {
    if (product.basePlan === "free") await api.request("/accounts/select", "POST", { slug: product.slug });
    else {
      await initGooglePlayBilling();
      const id = interval === "monthly" ? product.playMonthlyProductId : product.playAnnualProductId;
      if (!id) throw new Error("This account type is not available in Google Play yet");
      const result = kind === "business" ? await purchaseBusinessTier(id, businessName, businessType) : await purchaseSubscription(id);
      if (!result.success) throw new Error(result.error ?? "Purchase was not completed");
    }
    await onChanged?.();
  }} />;
}
