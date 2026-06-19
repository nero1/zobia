import { redirect } from "next/navigation";

/** /g/ → /games/ */
export default function GRootPage() {
  redirect("/games");
}
