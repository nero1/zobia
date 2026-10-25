import AppLayout from "@/app/(app)/layout";
import { TalesView } from "@/components/tales/TalesView";
export default async function Page({
  params,
}: {
  params: Promise<{ tweetId: string }>;
}) {
  return <AppLayout><TalesView editor slug={(await params).tweetId} /></AppLayout>;
}
