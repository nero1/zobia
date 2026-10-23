import type { TalesTransport } from "@zobia/shared/ui/Tales";
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AutomationPanel } from "@zobia/shared/ui/Automation";
import { apiClient } from "@/lib/api/client";
function Page() {
  const navigate = useNavigate();
  const api = useMemo<TalesTransport>(
    () => ({
      navigate: (path) => {
        const target = path.startsWith("/b/")
          ? path.replace("/b/", "/blogs/")
          : path.replace(/^\/wiki\/([^/]+)\/([^/]+)$/, "/wiki/$1/pages/$2");
        void navigate({ to: target as never });
      },
      request: async <T,>(path: string, method = "GET", body?: unknown) =>
        (await apiClient.request<T>({ url: path, method, data: body })).data,
    }),
    [navigate],
  );
  return <AutomationPanel api={api} />;
}
export const Route = createFileRoute("/admin/auto-content")({
  component: Page,
});
