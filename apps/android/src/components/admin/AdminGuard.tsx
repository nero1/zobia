import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { Browser } from "@capacitor/browser";
import { QRCodeSVG } from "qrcode.react";
import { AdminTwoFactorReminder } from "@zobia/shared/ui/AdminTwoFactorReminder";
import {
  GoogleAdminVerification,
  type GoogleAdminTransport,
} from "@zobia/shared/ui/GoogleAdminVerification";
import { useAuth } from "@/lib/auth/store";
import { apiClient } from "@/lib/api/client";
import { env } from "@/lib/env";
import { OAUTH_CALLBACK_LINK } from "@/lib/deeplinks/routes";
import { beginOAuthAttempt, endOAuthAttempt } from "@/lib/auth/preAuth";
type AdminPolicy = { userId: string; twoFaEnabled: boolean };
const AdminPolicyContext = createContext<AdminPolicy | null>(null);

export function AdminTwoFactorReminderBanner() {
  const policy = useContext(AdminPolicyContext);
  const navigate = useNavigate();
  return policy ? (
    <AdminTwoFactorReminder
      userId={policy.userId}
      enabled={policy.twoFaEnabled}
      onEnable={() => void navigate({ to: "/settings/security" })}
    />
  ) : null;
}
function sessionId(token: string | null) {
  try {
    return String(
      JSON.parse(
        atob((token ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).sid,
    );
  } catch {
    return "none";
  }
}
function GoogleAdminGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [verified, setVerified] = useState(false);
  const [policy, setPolicy] = useState<AdminPolicy | null>(null);
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const api = useMemo<GoogleAdminTransport>(
    () => ({
      request: async (method = "GET", body) => {
        try {
          const expectedUser = authRef.current.user,
            expectedSid = sessionId(authRef.current.token);
          const result = (
            await apiClient.request({
              url: "/auth/admin-session",
              method,
              data: body,
            })
          ).data;
          if (result.accessToken && result.refreshToken) {
            if (
              !expectedUser ||
              authRef.current.user?.id !== expectedUser.id ||
              sessionId(authRef.current.token) !== expectedSid
            )
              throw new Error("Sign-in changed during verification");
            await authRef.current.setAuth(
              result.accessToken,
              { ...expectedUser, is_admin: true },
              result.refreshToken,
            );
          }
          if (result.userId && typeof result.twoFaEnabled === "boolean") {
            setPolicy({
              userId: result.userId,
              twoFaEnabled: result.twoFaEnabled,
            });
          }
          return result;
        } catch (error) {
          const e = error as {
            response?: {
              status: number;
              data?: { error?: { message?: string } };
            };
          };
          throw Object.assign(
            new Error(
              e.response?.data?.error?.message ??
                "Unable to verify administrator access",
            ),
            { status: e.response?.status },
          );
        }
      },
    }),
    [],
  );
  const ready = useCallback(async () => {
    setVerified(true);
  }, []);
  const google = async () => {
    beginOAuthAttempt();
    try {
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/api/auth/google?redirect=${encodeURIComponent(OAUTH_CALLBACK_LINK)}`,
        presentationStyle: "popover",
      });
    } catch (error) {
      endOAuthAttempt();
      throw error;
    }
  };
  return verified ? (
    <AdminPolicyContext.Provider value={policy}>
      {children}
    </AdminPolicyContext.Provider>
  ) : (
    <div className="flex min-h-full items-center justify-center p-4">
      <GoogleAdminVerification
        onCancel={() => void navigate({ to: "/home" })}
        api={api}
        onAuthorized={ready}
        onGoogleSignIn={google}
        renderQr={(uri) => <QRCodeSVG value={uri} size={180} />}
      />
    </div>
  );
}
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, isLoaded, token } = useAuth(),
    navigate = useNavigate();
  useEffect(() => {
    if (isLoaded && !user?.is_admin)
      void navigate({ to: "/home", replace: true });
  }, [isLoaded, user?.is_admin, navigate]);
  if (!isLoaded || !user?.is_admin)
    return (
      <div role="status" className="flex h-full items-center justify-center">
        Loading…
      </div>
    );
  return (
    <GoogleAdminGate key={`${user.id}:${sessionId(token)}`}>
      {children}
    </GoogleAdminGate>
  );
}
