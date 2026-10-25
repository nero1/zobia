import type { SessionRecord } from "./session";

/** Account policy is always read live; session claims cannot disable 2FA. */
export function hasAdminAssurance(
  session: Pick<SessionRecord, "adminSession" | "impersonatedBy">,
  twoFaEnabled: boolean,
): boolean {
  return (
    !session.impersonatedBy &&
    (twoFaEnabled === false || session.adminSession === true)
  );
}
