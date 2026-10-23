export const SUPPORTED_LOCALES = ["en", "ar", "fr", "ha", "sw", "am", "zu", "pt", "pidgin", "hi"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  ar: "العربية",
  fr: "Français",
  ha: "Hausa",
  sw: "Kiswahili",
  am: "አማርኛ",
  zu: "IsiZulu",
  pt: "Português",
  pidgin: "Naija (Pidgin)",
  hi: "हिन्दी",
};
export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Presentation flags are language hints, not restrictions to a country. */
export const LOCALE_FLAGS: Record<SupportedLocale, string> = {
  en: "🇬🇧", ar: "🇸🇦", fr: "🇫🇷", ha: "🇳🇬", sw: "🇰🇪", am: "🇪🇹", zu: "🇿🇦", pt: "🇵🇹", pidgin: "🇳🇬", hi: "🇮🇳",
};
