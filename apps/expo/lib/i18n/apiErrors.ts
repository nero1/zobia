/**
 * lib/i18n/apiErrors.ts
 *
 * Lookup helper for translating API error `code` strings (e.g. "USERNAME_TAKEN")
 * into localised messages, with a graceful fallback to the API's own English
 * `message` field when no translation exists yet for the active locale.
 *
 * Mirrors apps/web/lib/i18n/apiErrors.ts — same key convention
 * (`errors.<code lowercased>`), since the Expo app talks to the same backend
 * and shares the same `errors.*` namespace shape in its locale files.
 *
 * Call from screens/components with the `t` function from `useTranslation()`:
 *
 *   const { t } = useTranslation();
 *   const message = translateApiError(t, err.response?.data?.error?.code, err.message);
 *   Alert.alert('Error', message);
 */

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * @param t               - i18next `t` function (from `useTranslation()`)
 * @param code            - API error `code` (e.g. "USERNAME_TAKEN"), if present
 * @param fallbackMessage - The API's own English `message`, used when the
 *                          code has no translation entry for the active locale
 * @param params          - Interpolation values for dynamic messages
 *                          (e.g. `{ minimumAge: 18 }` for `errors.age_requirement_not_met`)
 */
export function translateApiError(
  t: TranslateFn,
  code: string | null | undefined,
  fallbackMessage: string,
  params?: Record<string, unknown>
): string {
  if (!code) return fallbackMessage;
  const key = `errors.${code.toLowerCase()}`;
  return t(key, { defaultValue: fallbackMessage, ...params });
}
