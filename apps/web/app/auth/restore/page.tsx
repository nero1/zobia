"use client";

/**
 * app/auth/restore/page.tsx
 *
 * Account restore confirmation page.
 *
 * The restore email links here with the signed JWT in the URL *fragment*
 * (#token=…) so it never appears in server request logs, Referer headers,
 * or CDN access logs. This page reads the fragment client-side and POSTes
 * the token to the API — the token is never sent as a URL query string.
 *
 * Flow:
 *   1. User clicks link in email → lands here with #token=<jwt>
 *   2. Page reads window.location.hash, extracts the token
 *   3. User clicks "Restore my account"
 *   4. Page POSTes the token to PATCH /api/auth/account/restore
 *   5. On success, stores the returned session and redirects to /home
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api/client";

export default function RestorePage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Extract token from the URL fragment client-side (fragments are never sent
  // to the server, so this token stays private to the browser).
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/[#&]token=([^&]+)/);
    if (match) {
      setToken(decodeURIComponent(match[1]));
      // Clear the fragment so it's not visible in the address bar after load.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleRestore() {
    if (!token) return;
    setStatus("loading");
    try {
      const { data } = await apiClient.patch("/auth/account/restore", { token });
      if (data?.data?.accessToken) {
        // Tokens are stored by the apiClient interceptors / auth context on response.
        setStatus("success");
        setTimeout(() => router.replace("/home"), 1500);
      } else {
        throw new Error(data?.error ?? t("errors.restore_failed"));
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : t("errors.restore_failed")
      );
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-2xl font-bold">{t("auth.restore.requestTitle")}</h1>
          <p className="text-muted-foreground">{t("auth.restore.invalidLink")}</p>
          <a href="/auth/login" className="text-primary underline text-sm">
            {t("auth.restore.backToLogin")}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <h1 className="text-2xl font-bold text-center">{t("auth.restore.requestTitle")}</h1>

        {status === "idle" && (
          <>
            <p className="text-muted-foreground text-center">{t("auth.restore.confirmBody")}</p>
            <button
              onClick={handleRestore}
              className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-semibold hover:opacity-90 transition"
            >
              {t("auth.restore.confirmBtn")}
            </button>
          </>
        )}

        {status === "loading" && (
          <p className="text-center text-muted-foreground">{t("auth.restore.restoreBody")}</p>
        )}

        {status === "success" && (
          <p className="text-center text-green-600 font-medium">{t("auth.restore.success")}</p>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <p className="text-center text-destructive">{errorMsg}</p>
            <button
              onClick={() => setStatus("idle")}
              className="w-full border border-border rounded-lg py-3 text-sm hover:bg-muted transition"
            >
              {t("auth.restore.tryAgain")}
            </button>
          </div>
        )}

        <div className="text-center">
          <a href="/auth/login" className="text-primary underline text-sm">
            {t("auth.restore.backToLogin")}
          </a>
        </div>
      </div>
    </main>
  );
}
