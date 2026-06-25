/**
 * Determines the effective Pidgin autocomplete state for a user.
 *
 * Logic:
 *  - If admin has disabled the feature globally → false (always)
 *  - If the user has an explicit setting (true/false) → use that
 *  - Otherwise fall back to locale: enabled for Nigerian-related locales
 */
export function isPidginEnabled(
  adminEnabled: boolean,
  userSetting: boolean | null,
  locale: string,
): boolean {
  if (!adminEnabled) return false;
  if (userSetting !== null) return userSetting;
  return ['en-NG', 'ha', 'ng', 'yo', 'ig', 'pidgin'].some((l) => locale.startsWith(l));
}
