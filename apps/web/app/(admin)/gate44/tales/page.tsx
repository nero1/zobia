"use client";
import { useMemo } from "react";
import { TalesModeration, type TalesTransport } from "@zobia/shared/ui/Tales";
export default function Page() {
  const api = useMemo<TalesTransport>(
    () => ({
      navigate: (path) => window.location.assign(path),
      request: async <T,>(path: string, method = "GET", body?: unknown) => {
        const response = await fetch(`/api${path}`, {
          method,
          credentials: "include",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message || "Unable to complete request.",
          );
        return result.data as T;
      },
    }),
    [],
  );
  return <TalesModeration api={api} />;
}
