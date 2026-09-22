"use client";

/**
 * components/classroom/ClassroomShareButton.tsx
 *
 * Share a classroom's public /c/<slug> URL — Web Share API with a copy-link
 * fallback, mirroring components/polls/PollShareButton.tsx. The share is
 * recorded (POST /api/classroom/:id/share) for the creator's stats, best
 * effort: it never blocks or error-toasts the share itself. The viewer's own
 * referral code (if logged in) is auto-appended so every share doubles as a
 * referral link.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { appendReferralCode } from "@zobia/shared/utils";
import { useMyReferralCode } from "@/lib/referral/useReferralCode";

export function ClassroomShareButton({
  roomId,
  slug,
  name,
  signedIn = true,
  className,
}: {
  roomId: string;
  slug: string | null;
  name: string;
  signedIn?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { code: refCode } = useMyReferralCode();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const url = appendReferralCode(`${window.location.origin}/c/${slug ?? roomId}`, refCode);
      if (navigator.share) {
        await navigator.share({ url, title: name }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        setNotice(t("classroom.share.linkCopied", "Link copied!"));
        setTimeout(() => setNotice(null), 2500);
      }
      if (signedIn) {
        void fetch(`/api/classroom/${roomId}/share`, { method: "POST", credentials: "include" }).catch(() => {});
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={sharing}
        className={
          className ??
          "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }
      >
        🔗 {t("classroom.share.button", "Share")}
      </button>
      {notice && <span className="text-xs text-teal-600 dark:text-teal-400">{notice}</span>}
    </span>
  );
}
