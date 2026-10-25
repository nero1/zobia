import type { Metadata } from "next";
import { TalesView } from "@/components/tales/TalesView";
export const metadata: Metadata = {
  title: "Tales",
  alternates: { canonical: "/tales" },
};
export default function Page() {
  return <TalesView />;
}
