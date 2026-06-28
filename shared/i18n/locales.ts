export const SUPPORTED_LOCALES = ["en", "ar", "fr", "ha", "sw", "am", "zu", "pt", "pidgin"] as const;
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
};
export const DEFAULT_LOCALE: SupportedLocale = "en";
