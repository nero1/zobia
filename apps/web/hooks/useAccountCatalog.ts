"use client";
import { useQuery } from "@tanstack/react-query";
import type { AccountProduct } from "@zobia/shared/ui/Accounts";
export function useAccountCatalog() {
  return useQuery<AccountProduct[]>({ queryKey: ["public-account-catalog"], staleTime: 15_000, queryFn: async () => {
    const response = await fetch("/api/accounts/catalog", { credentials: "include" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Unable to load account products");
    return result.data;
  } });
}
