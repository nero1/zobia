import { TalesView } from "@/components/tales/TalesView";
export default async function Page({
  params,
}: {
  params: Promise<{ tweetId: string }>;
}) {
  return <TalesView editor slug={(await params).tweetId} />;
}
