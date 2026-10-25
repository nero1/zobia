"use client";
import { useMemo } from "react";
import Link from "@/components/ui/Link";
import { useTranslation } from "react-i18next";
import { useCaptchaWidget } from "@/components/security/useCaptchaWidget";
import {
  AdminMagicWordSettings,
  type AdminMagicWordTransport,
} from "@zobia/shared/ui/AdminMagicWord";
export default function AdminSecuritySettingsPage() {
  const { t } = useTranslation();
  const { enabled, getToken, WidgetSlot, ScriptTags } =
    useCaptchaWidget("login");
  const api = useMemo<AdminMagicWordTransport>(
    () => ({
      request: async (method = "GET", body) => {
        const response = await fetch("/api/admin/auth/magic-word", {
          method,
          credentials: "include",
          cache: "no-store",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const result = await response.json();
        if (!response.ok)
          throw Object.assign(
            new Error(result.error?.message ?? t("error.generic")),
            { code: result.error?.code, status: response.status },
          );
        return result.data;
      },
    }),
    [t],
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <AdminMagicWordSettings
        api={api}
        onGoogleSignIn={async () => {
          const token = await getToken();
          if (enabled && !token) throw new Error(t("auth.error.oauthFailed"));
          const query = new URLSearchParams({
            web_redirect: "/gate44/settings/security",
          });
          if (token) query.set("captcha_token", token);
          window.location.assign("/api/auth/google?" + query);
        }}
        googleWidget={
          <>
            <WidgetSlot />
            <ScriptTags />
          </>
        }
      />
      <Link
        href="/settings#two-factor"
        className="inline-block text-sm font-semibold text-primary-600 underline dark:text-primary-400"
      >
        {t("settings.twoFa.title")}
      </Link>
    </div>
  );
}
