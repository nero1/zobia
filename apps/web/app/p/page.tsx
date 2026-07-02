import { redirect } from "next/navigation";

/** /p/ → /business (Business Pages are managed from the Business hub) */
export default function PRootPage() {
  redirect("/business");
}
