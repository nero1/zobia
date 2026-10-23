"use client";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/hooks";
import {
  TalesDiscovery,
  TalesStory,
  TalesChapter,
  TalesEditor,
  type TalesTransport,
} from "@zobia/shared/ui/Tales";
export function TalesView({
  slug,
  ordinal,
  editor = false,
}: {
  slug?: string;
  ordinal?: number;
  editor?: boolean;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const request = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      let target = path;
      if (!user && method === "GET" && path.startsWith("/tales")) {
        const match = path.match(/^\/tales\/([^/?]+)\/chapters\/(\d+)$/);
        target = match
          ? `/tales/public/${match[1]}?chapter=${match[2]}`
          : path.replace(/^\/tales(?=\?|$|\/)/, "/tales/public");
      }
      const response = await fetch(`/api${target}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Unable to complete the request.",
        );
      return Object.prototype.hasOwnProperty.call(result, "data")
        ? result.data
        : result;
    },
    [user?.id],
  );
  const api = useMemo<TalesTransport>(
    () => ({
      request,
      upload: async (file) => {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/tales/uploads/image", {
          method: "POST",
          credentials: "include",
          body,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error?.message || "Upload failed.");
        return data.data.url;
      },
      navigate: (path) => router.push(path),
      userId: user?.id,
    }),
    [request, router, user?.id],
  );
  return editor ? (
    <TalesEditor
      key={`${user?.id ?? "guest"}:${slug ?? "root"}:${ordinal ?? ""}`}
      api={api}
      slug={slug}
    />
  ) : slug ? (
    ordinal ? (
      <TalesChapter
        key={`${user?.id ?? "guest"}:${slug ?? "root"}:${ordinal ?? ""}`}
        api={api}
        slug={slug}
        ordinal={ordinal}
      />
    ) : (
      <TalesStory
        key={`${user?.id ?? "guest"}:${slug ?? "root"}:${ordinal ?? ""}`}
        api={api}
        slug={slug}
      />
    )
  ) : (
    <TalesDiscovery
      key={`${user?.id ?? "guest"}:${slug ?? "root"}:${ordinal ?? ""}`}
      api={api}
    />
  );
}
