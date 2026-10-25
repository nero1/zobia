"use client";
import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  GoogleAdminVerification,
  type GoogleAdminTransport,
} from "@zobia/shared/ui/GoogleAdminVerification";
import { useCaptchaWidget } from "@/components/security/useCaptchaWidget";
function Login() {
  const params = useSearchParams();
  const requested = params?.get("redirect");
  const target =
    requested &&
    /^\/gate44(?:\/[a-zA-Z0-9/_-]*)?$/.test(requested) &&
    !requested.startsWith("/gate44/login")
      ? requested
      : "/gate44";
  const { enabled, getToken, WidgetSlot, ScriptTags } =
    useCaptchaWidget("login");
  const api = useMemo<GoogleAdminTransport>(
    () => ({
      request: async (method = "GET", body) => {
        const response = await fetch("/api/auth/admin-session", {
          method,
          credentials: "include",
          cache: "no-store",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json();
        if (!response.ok)
          throw Object.assign(
            new Error(
              data.error?.message ?? "Unable to verify administrator access",
            ),
            { status: response.status },
          );
        return data.data;
      },
    }),
    [],
  );
  const ready = useCallback(async () => {
    window.location.assign(target);
  }, [target]);
  const google = async () => {
    const token = await getToken();
    if (enabled && !token) throw new Error("Complete the verification widget");
    const query = new URLSearchParams({
      web_redirect: target,
    });
    if (token) query.set("captcha_token", token);
    window.location.assign("/api/auth/google?" + query);
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-8 dark:bg-neutral-950">
      <GoogleAdminVerification
        onCancel={() => window.location.assign("/home")}
        api={api}
        onAuthorized={ready}
        onGoogleSignIn={google}
        googleWidget={
          <>
            <WidgetSlot />
            <ScriptTags />
          </>
        }
        renderQr={(uri) => <QRCodeSVG value={uri} size={180} />}
      />
    </main>
  );
}
export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
