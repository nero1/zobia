import { redirect } from "next/navigation";

/** Reuse the account security controls, including opt-in admin 2FA. */
export default function AdminSecuritySettingsPage() {
  redirect("/settings#two-factor");
}
