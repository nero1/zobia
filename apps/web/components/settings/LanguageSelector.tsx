"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from "@zobia/shared/i18n";

export function LanguageSelector() {
  const { i18n, t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return <label className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
    <span>{t("settings.language", "Language")}</span>
    <select aria-label={t("settings.language", "Language")} disabled={saving} value={i18n.resolvedLanguage || "en"} className="rounded-lg border border-border bg-background px-3 py-2" onChange={async (event) => {
      const locale = event.target.value;
      setSaving(true); setError(null);
      try {
        const response = await fetch("/api/users/me", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) });
        if (!response.ok) throw new Error(t("common.error", "Unable to save language."));
        await i18n.changeLanguage(locale);
      } catch (err) { setError(err instanceof Error ? err.message : t("common.error", "Unable to save language.")); }
      finally { setSaving(false); }
    }}>
      {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_FLAGS[locale]} {LOCALE_LABELS[locale]}</option>)}
    </select>
    {error && <span role="alert" className="text-red-500">{error}</span>}
  </label>;
}
