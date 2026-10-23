import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccountsPanel } from "@zobia/shared/ui/Accounts";
import type { TalesTransport } from "@zobia/shared/ui/Tales";
import { apiClient } from "@/lib/api/client";
function Page() {
  const api = useMemo<TalesTransport>(() => ({ navigate: path => window.location.assign(path), request: async <T,>(path: string, method = "GET", body?: unknown) => (await apiClient.request<T>({ url: path, method, data: body })).data }), []);
  return <AccountsPanel api={api} />;
}
export const Route = createFileRoute("/admin/accounts")({ component: Page });
