import { TalesView } from "@/components/tales/TalesView";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ tweetId: string; ordinal: string }>;
}) {
  const p = await params;
  const n = Number(p.ordinal);
  if (!Number.isInteger(n) || n < 1 || n > 10000) notFound();
  return <TalesView slug={p.tweetId} ordinal={n} />;
}
