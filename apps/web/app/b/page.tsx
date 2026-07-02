import { redirect } from "next/navigation";

/** /b/ → /blogs/ */
export default function BRootPage() {
  redirect("/blogs");
}
