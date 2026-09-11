"use client";

/**
 * components/quizzes/QuizShareButton.tsx
 *
 * Share button for a public quiz — identical pattern to
 * components/polls/PollShareButton.tsx, hitting the quizzes share endpoint.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export function QuizShareButton({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const url = `${window.location.origin}/quiz/${slug}`;
      if (navigator.share) {
        await navigator.share({ url }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        setNotice(t("quizzes.share.linkCopied", "Link copied!"));
      }
      const res = await fetch(`/api/quizzes/${slug}/share`, { method: "POST", credentials: "include" });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.rewardClaimed) {
        setNotice(t("quizzes.share.rewardClaimed", "You earned {{amount}} credits from the reward pot!", { amount: json.data.rewardClaimed }));
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
        <span>{t("quizzes.share.button", "Share")}</span>
      </button>
      {notice && <span className="text-xs text-amber-400">{notice}</span>}
    </div>
  );
}
