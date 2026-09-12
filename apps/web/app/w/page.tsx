import { redirect } from "next/navigation";

/** /w/ → /wiki/ (authenticated wiki discovery page) */
export default function WRootPage() {
  redirect("/wiki");
}
