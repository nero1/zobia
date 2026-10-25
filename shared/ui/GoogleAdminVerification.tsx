"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
type State =
  | "loading"
  | "google_required"
  | "setup_required"
  | "verify_required"
  | "authorized"
  | "denied";
interface Result {
  state: State;
  secret?: string;
  otpauthUri?: string;
}
export interface GoogleAdminTransport {
  request: (method?: string, body?: unknown) => Promise<Result>;
}
/** Shared Google + authenticator flow. Identity/role/assurance are all enforced
 * by the server; this component never decides who may become an administrator. */
export function GoogleAdminVerification({
  api,
  onAuthorized,
  onGoogleSignIn,
  renderQr,
  googleWidget,
  onCancel,
}: {
  api: GoogleAdminTransport;
  onAuthorized: () => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  renderQr: (uri: string) => ReactNode;
  googleWidget?: ReactNode;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Result>({ state: "loading" }),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const generation = useRef(0);
  const failure = useCallback(
    (err: unknown) => {
      const e = err as { status?: number; message?: string };
      if (e.status === 401) setData({ state: "google_required" });
      else setError(e.message ?? t("auth.error.oauthFailed"));
    },
    [t],
  );
  useEffect(() => {
    let active = true;
    setError("");
    void api
      .request()
      .then(async (result) => {
        if (!active) return;
        setData(result);
        if (result.state === "authorized") await onAuthorized();
      })
      .catch((err) => {
        if (active) failure(err);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [api, onAuthorized, reload, failure]);
  async function action(method: string, body?: unknown) {
    const started = generation.current;
    setError("");
    setBusy(true);
    try {
      const result = await api.request(method, body);
      if (started !== generation.current) return;
      setData(result);
      if (result.state === "authorized") await onAuthorized();
    } catch (err) {
      if (started === generation.current) failure(err);
    } finally {
      if (started === generation.current) setBusy(false);
    }
  }
  const button =
    "rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
  return (
    <section
      aria-label={t("admin.googleTitle")}
      className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-card dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50"
    >
      <h1 className="text-xl font-bold">{t("admin.googleTitle")}</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {t("admin.googleIntro")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {data.state === "loading" && !error && (
        <p role="status">{t("action.loading")}</p>
      )}
      {(data.state === "google_required" ||
        (data.state === "authorized" && error)) && (
        <>
          {googleWidget}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onGoogleSignIn()
                .catch(failure)
                .finally(() => setBusy(false));
            }}
          >
            {t("auth.continueWithGoogle")}
          </button>
        </>
      )}
      {data.state === "setup_required" && !data.secret && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void action("POST", { action: "setup" })}
        >
          {t("settings.twoFa.enable")}
        </button>
      )}
      {data.secret && (
        <div className="space-y-3">
          <p className="text-sm">{t("admin.googleSetup")}</p>
          <div className="inline-block rounded-xl bg-white p-3">
            {data.otpauthUri && renderQr(data.otpauthUri)}
          </div>
          <p className="text-xs">{t("settings.twoFa.manualKeyHint")}</p>
          <code className="block break-all rounded-lg bg-neutral-100 p-3 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50">
            {data.secret}
          </code>
        </div>
      )}
      {(data.state === "verify_required" || data.secret) && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action("POST", {
              action: data.secret ? "enroll" : "verify",
              code,
            });
          }}
        >
          <label
            className="block text-sm font-semibold"
            htmlFor="google-admin-code"
          >
            {t("settings.twoFa.codePlaceholder")}
          </label>
          <input
            id="google-admin-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="block w-full rounded-xl border border-neutral-300 bg-white p-3 text-neutral-900 focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          />
          <button className={button} disabled={busy || code.length !== 6}>
            {t("settings.twoFa.confirm")}
          </button>
        </form>
      )}
      {error && (
        <button
          type="button"
          disabled={busy}
          className="text-sm font-semibold text-primary-600 underline dark:text-primary-400"
          onClick={() => setReload((n) => n + 1)}
        >
          {t("action.retry")}
        </button>
      )}
      {onCancel && (
        <button
          type="button"
          className="text-sm font-semibold text-primary-600 underline dark:text-primary-400"
          onClick={onCancel}
        >
          {t("nav.userArea")}
        </button>
      )}
    </section>
  );
}
