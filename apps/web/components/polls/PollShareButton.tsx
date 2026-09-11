"use client";

/**
 * components/polls/PollShareButton.tsx
 *
 * Share button for a public poll — Web Share API with a copy-link fallback,
 * mirroring components/blogs/PostActions.tsx's handleShare() exactly. The
 * reward-pot claim (if any) is a bonus on top of the normal share action,
 * so the /share POST is best-effort and never blocks or error-toasts.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export function PollShareButton({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const url = `${window.location.origin}/poll/${slug}`;
      if (navigator.share) {
        await navigator.share({ url }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        setNotice(t("polls.share.linkCopied", "Link copied!"));
      }
      const res = await fetch(`/api/polls/${slug}/share`, { method: "POST", credentials: "include" });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.rewardClaimed) {
        setNotice(t("polls.share.rewardClaimed", "You earned {{amount}} credits from the reward pot!", { amount: json.data.rewardClaimed }));
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
      >
        <span>🔗</span>
        <span>{t("polls.share.button", "Share")}</span>
      </button>
      {notice && <span className="text-xs text-amber-400">{notice}</span>}
    </div>
  );
}
