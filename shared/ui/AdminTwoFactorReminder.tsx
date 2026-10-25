"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** A browser/device preference only; dismissal never changes account security. */
export function AdminTwoFactorReminder({
  userId,
  enabled,
  onEnable,
}: {
  userId: string;
  enabled: boolean;
  onEnable: () => void;
}) {
  const { t } = useTranslation();
  const key = `zobia:admin-2fa-reminder:v1:${userId}`;
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (enabled) localStorage.removeItem(key);
      setVisibleKey(
        !enabled && localStorage.getItem(key) !== "dismissed" ? key : null,
      );
    } catch {
      setVisibleKey(enabled ? null : key);
    }
  }, [key, enabled]);
  if (enabled || visibleKey !== key) return null;
  return (
    <aside
      aria-label={t("settings.twoFa.title")}
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        {t("admin.twoFaReminder")}
      </p>
      <button
        type="button"
        onClick={onEnable}
        className="rounded-lg bg-primary-600 px-3 py-2 font-semibold text-white hover:bg-primary-700"
      >
        {t("settings.twoFa.enable")}
      </button>
      <button
        type="button"
        className="rounded-lg px-3 py-2 font-semibold underline"
        onClick={() => {
          try {
            localStorage.setItem(key, "dismissed");
          } catch {
            /* Current-page dismissal still works. */
          }
          setVisibleKey(null);
        }}
      >
        {t("action.close")}
      </button>
    </aside>
  );
}
