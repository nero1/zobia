"use client";

/**
 * app/(app)/gift/[userId]/page.tsx
 *
 * Gift-to-user deep link — /gift/:userId
 *
 * Linked from user profile share cards, deep links (zobia://gift/:userId),
 * and the Expo app. Resolves the recipient's username and hands off to the
 * fully-featured Gifts Hub send flow (/gifts?recipientId=&username=) instead
 * of re-implementing gift selection, wallet balance, and PIN verification
 * here — that flow already exists and is exercised from the main /gifts page
 * and from profile "Gift" buttons.
 *
 * Previously this page called two API routes that were never implemented
 * (`/api/users/:userId/public`, `/api/economy/gift-items`), so it always
 * rendered "User not found." regardless of the target user's existence.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function GiftUserPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    fetch(`/api/users/${userId}`, { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "User not found." : "Could not load profile.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { user?: { username?: string | null } };
        const username = data.user?.username ?? "";
        const query = username
          ? `recipientId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`
          : `recipientId=${encodeURIComponent(userId)}`;
        router.replace(`/gifts?${query}`);
      })
      .catch(() => { if (!cancelled) setError("Network error. Please try again."); });

    return () => { cancelled = true; };
  }, [userId, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-neutral-500">{error}</p>
        <Link href="/home" className="text-sm text-blue-600 hover:underline">← Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  );
}
