/**
 * lib/phone/normalize.ts
 *
 * Phone number normalisation shared by the Settings "Phone Number" field
 * (lib/phone/verification.ts) and the contacts cross-reference endpoint's
 * client-side callers, so a self-entered number and a device-contact number
 * for the same person land on the same stored string.
 *
 * Mirrors the E.164 normalisation already used on the Expo phonebook import
 * screen (apps/expo/components/ContactsImporter.tsx) — kept as a separate
 * copy rather than a shared import because the Expo app is being
 * discontinued and is referenced for patterns only, never modified.
 */

/**
 * Normalise a raw phone number string to E.164 format.
 *
 * Rules applied in order:
 *  1. Strip all non-digit chars except a leading '+'.
 *  2. If the number starts with '+' it is already in international format —
 *     return as-is (e.g. "+2348012345678").
 *  3. If the number starts with "00" treat it as the international dialling
 *     prefix and replace with '+' (e.g. "002348012345678" -> "+2348012345678").
 *  4. If the number starts with "0" and has 10-11 digits it is a Nigerian
 *     local number; strip the leading 0 and prepend +234.
 *  5. Otherwise, if at least 10 digits remain, assume it's already an
 *     international number missing its '+' and prepend one.
 *  6. Otherwise return null — unrecognised format.
 *
 * The +234 default is correct for Zobia's primary market (Nigeria). Other
 * markets can be added by extending this function.
 */
export function toE164(raw: string): string | null {
  const stripped = raw.replace(/[^\d+]/g, "");
  if (!stripped) return null;

  if (stripped.startsWith("+")) return stripped.length >= 11 ? stripped : null;
  if (stripped.startsWith("00")) return stripped.slice(2).length >= 10 ? "+" + stripped.slice(2) : null;

  if (stripped.startsWith("0") && stripped.length >= 10 && stripped.length <= 11) {
    return "+234" + stripped.slice(1);
  }

  if (stripped.length >= 10) return "+" + stripped;

  return null;
}

/** True if `raw` normalises to a plausible E.164 number (max 15 digits per the spec, plus the leading '+'). */
export function isValidPhoneNumber(raw: string): boolean {
  const normalized = toE164(raw);
  return normalized !== null && /^\+\d{10,15}$/.test(normalized);
}
