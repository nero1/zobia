import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { store } from "capacitor-plugin-cdv-purchase";
import type { AccountProduct } from "@zobia/shared/ui/Accounts";
import { apiClient } from "@/lib/api/client";
import { getPlayProductPrice, initGooglePlayBilling, refreshAccountStoreProducts } from "./googlePlay";
export function useAccountCatalog() {
  const [, updatePrices] = useState(0);
  const query = useQuery<AccountProduct[]>({ queryKey: ["public-account-catalog"], staleTime: 15_000, queryFn: async () => (await apiClient.get<AccountProduct[]>("/accounts/catalog")).data });
  useEffect(() => {
    let live = true;
    const refresh = () => { if (live) updatePrices(value => value + 1); };
    store.when().productUpdated(refresh);
    void initGooglePlayBilling().then(refresh).catch(() => {});
    return () => { live = false; store.off(refresh); };
  }, []);
  useEffect(() => {
    const ids = (query.data ?? []).flatMap(p => [p.playMonthlyProductId, p.playAnnualProductId]).filter((id): id is string => !!id);
    if (ids.length) void refreshAccountStoreProducts(ids).catch(() => {});
  }, [query.data]);
  return { ...query, price: getPlayProductPrice };
}
