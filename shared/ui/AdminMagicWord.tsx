"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

export function AdminMagicWordReminder({ onSetup }: { onSetup: () => void }) {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("admin.magicWord.title")}
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        {t("admin.magicWord.reminder")}
      </p>
      <button
        type="button"
        onClick={onSetup}
        className="rounded-lg bg-primary-600 px-3 py-2 font-semibold text-white hover:bg-primary-700"
      >
        {t("admin.magicWord.set")}
      </button>
    </aside>
  );
}
interface Status {
  userId: string;
  isSet: boolean;
  googleReauthRequired?: boolean;
}
export interface AdminMagicWordTransport {
  request: (method?: string, body?: unknown) => Promise<Status>;
}
export function AdminMagicWordSettings({
  api,
  onGoogleSignIn,
  googleWidget,
  refreshKey,
}: {
  api: AdminMagicWordTransport;
  onGoogleSignIn: () => Promise<void>;
  googleWidget?: ReactNode;
  refreshKey?: string | null;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null),
    [word, setWord] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const loadVersion = useRef(0);
  const failure = useCallback(
    (error: unknown) => {
      const e = error as { code?: string; message?: string; status?: number };
      if (e.code === "GOOGLE_REAUTH_REQUIRED")
        setStatus((s) => (s ? { ...s, googleReauthRequired: true } : s));
      setError(e.message ?? t("error.generic"));
    },
    [t],
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      const started = ++loadVersion.current;
      try {
        const next = await api.request();
        if (active && started === loadVersion.current) setStatus(next);
      } catch (e) {
        if (active && started === loadVersion.current) failure(e);
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      generation.current++;
      window.removeEventListener("focus", load);
    };
  }, [api, refreshKey, retry, failure]);
  const button =
    "rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
  return (
    <section
      aria-label={t("admin.magicWord.title")}
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
        {t("admin.magicWord.title")}
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {t("admin.magicWord.help")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="text-sm text-primary-600 dark:text-primary-400"
        >
          {t("admin.magicWord.saved")}
        </p>
      )}
      {!status && !error && <p role="status">{t("action.loading")}</p>}
      {status && (
        <>
          <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            {t(
              status.isSet
                ? "admin.magicWord.configured"
                : "admin.magicWord.missing",
            )}
          </p>
          {status.googleReauthRequired ? (
            <>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                {t("admin.magicWord.googleRequired")}
              </p>
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
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                setSaved(false);
                if (word !== confirm) {
                  setError(t("admin.magicWord.mismatch"));
                  return;
                }
                const started = generation.current;
                setBusy(true);
                void api
                  .request("POST", { magicWord: word, userId: status.userId })
                  .then(() => {
                    if (started !== generation.current) return;
                    loadVersion.current++;
                    setStatus({
                      ...status,
                      isSet: true,
                      googleReauthRequired: false,
                    });
                    setWord("");
                    setConfirm("");
                    setSaved(true);
                    window.dispatchEvent(
                      new Event("zobia:admin-security-updated"),
                    );
                  })
                  .catch((e) => {
                    if (started === generation.current) failure(e);
                  })
                  .finally(() => {
                    if (started === generation.current) setBusy(false);
                  });
              }}
            >
              <label
                className="block text-sm font-semibold"
                htmlFor="admin-magic-word"
              >
                {t("admin.magicWord.title")}
              </label>
              <input
                id="admin-magic-word"
                type="password"
                autoComplete="off"
                minLength={6}
                maxLength={200}
                required
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="block w-full rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
              />
              <label
                className="block text-sm font-semibold"
                htmlFor="admin-magic-word-confirm"
              >
                {t("admin.magicWord.confirm")}
              </label>
              <input
                id="admin-magic-word-confirm"
                type="password"
                autoComplete="off"
                minLength={6}
                maxLength={200}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="block w-full rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
              />
              <button
                className={button}
                disabled={busy || word.length < 6 || confirm.length < 6}
              >
                {t("action.save")}
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <button
          type="button"
          className="text-sm font-semibold text-primary-600 underline dark:text-primary-400"
          onClick={() => setRetry((n) => n + 1)}
        >
          {t("action.retry")}
        </button>
      )}
    </section>
  );
}
