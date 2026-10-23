import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth/store";
import { apiClient } from "@/lib/api/client";
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
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const request = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      let target = path;
      if (!token && method === "GET" && path.startsWith("/tales")) {
        const match = path.match(/^\/tales\/([^/?]+)\/chapters\/(\d+)$/);
        target = match
          ? `/tales/public/${match[1]}?chapter=${match[2]}`
          : path.replace(/^\/tales(?=\?|$|\/)/, "/tales/public");
      }
      try {
        const result = await apiClient.request<T>({
          url: target,
          method,
          data: body,
        });
        return result.data;
      } catch (error) {
        const e = error as {
          response?: { data?: { error?: { message?: string } } };
          message?: string;
        };
        throw new Error(
          e.response?.data?.error?.message ||
            e.message ||
            "Unable to complete the request.",
        );
      }
    },
    [token],
  );
  const api = useMemo<TalesTransport>(
    () => ({
      request,
      upload: async (file) => {
        const data = new FormData();
        data.set("file", file);
        return (
          await apiClient.post<{ url: string }>("/tales/uploads/image", data, {
            headers: { "Content-Type": "multipart/form-data" },
          })
        ).data.url;
      },
      userId: user?.id,
      navigate: (path) => {
        if (path.startsWith("/auth/login?")) {
          const redirect = new URLSearchParams(path.split("?")[1]).get(
            "redirect",
          );
          if (redirect && /^\/t(?:\/[a-zA-Z0-9-]+)*$/.test(redirect))
            try {
              localStorage.setItem("zobia:auth:talesReturn", redirect);
            } catch {}
          void navigate({ to: "/auth/login" });
          return;
        }
        void navigate({ to: path as never });
      },
    }),
    [request, navigate, user?.id],
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
