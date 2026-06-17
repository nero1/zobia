"use client";

import { useFloatingNotification } from "@/hooks/useFloatingNotification";
import Link from "next/link";

function DemoButton({
  label,
  description,
  onClick,
  color = "blue",
}: {
  label: string;
  description: string;
  onClick: () => void;
  color?: "blue" | "green" | "amber" | "violet" | "rose" | "neutral";
}) {
  const colorMap: Record<string, string> = {
    blue:    "bg-blue-600 hover:bg-blue-700 text-white",
    green:   "bg-emerald-600 hover:bg-emerald-700 text-white",
    amber:   "bg-amber-500 hover:bg-amber-600 text-white",
    violet:  "bg-violet-600 hover:bg-violet-700 text-white",
    rose:    "bg-rose-600 hover:bg-rose-700 text-white",
    neutral: "bg-neutral-700 hover:bg-neutral-800 text-white dark:bg-neutral-600 dark:hover:bg-neutral-500",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={onClick}
        className={`rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${colorMap[color]}`}
      >
        {label}
      </button>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
    </div>
  );
}

export default function NotificationsDemoPage() {
  const { fireXP, fireCredits, fireStars, fireReferral, fireGift, fireDeckComplete, fireConfetti, isEnabled } = useFloatingNotification();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Floating Notifications Demo
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Test the floating reward notification system. Status:{" "}
            <span className={isEnabled ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>
              {isEnabled ? "Enabled" : "Disabled"}
            </span>
            {" — "}
            <Link href="/admin/config" className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400">
              Configure in Settings
            </Link>
          </p>
        </div>
      </div>

      {!isEnabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Floating Notifications are currently disabled. Enable them in Config → Floating Notifications to see demos. Demos below use the system directly and will still show.
        </div>
      )}

      {/* XP Demos */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">XP Notifications</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo +5 XP"
            description="Small XP award — no confetti (below default 100 threshold)"
            onClick={() => fireXP(5)}
            color="green"
          />
          <DemoButton
            label="Demo +50 XP"
            description="Medium XP award — still below confetti threshold"
            onClick={() => fireXP(50)}
            color="green"
          />
          <DemoButton
            label="Demo +500 XP (confetti)"
            description="Large XP award — triggers confetti (above default threshold)"
            onClick={() => fireXP(500)}
            color="green"
          />
        </div>
      </section>

      {/* Credits Demos */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Credits Notifications</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo +10 Credits"
            description="Small credit award — no confetti"
            onClick={() => fireCredits(10)}
            color="amber"
          />
          <DemoButton
            label="Demo +100 Credits (confetti)"
            description="Large credit award — triggers confetti"
            onClick={() => fireCredits(100)}
            color="amber"
          />
        </div>
      </section>

      {/* Stars Demos */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Stars Notifications</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo +5 Stars"
            description="Small stars award — no confetti"
            onClick={() => fireStars(5)}
            color="violet"
          />
          <DemoButton
            label="Demo +25 Stars (confetti)"
            description="Large stars award — triggers confetti"
            onClick={() => fireStars(25)}
            color="violet"
          />
        </div>
      </section>

      {/* Referral Demo */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Referral Notification</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo +1 Referral"
            description="Shown to a user when someone joins via their referral link"
            onClick={() => fireReferral()}
            color="blue"
          />
        </div>
      </section>

      {/* Gift Demo */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Gift Notification</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo +1 Gift"
            description="Shown when a user receives a gift from another user"
            onClick={() => fireGift(1)}
            color="rose"
          />
          <DemoButton
            label="Demo +3 Gifts"
            description="Shown when a user receives multiple gifts at once"
            onClick={() => fireGift(3)}
            color="rose"
          />
        </div>
      </section>

      {/* Quest Completion Demo */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Quest Completion</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo Quest Deck Completion"
            description="Simulates completing all daily quests — confetti + notifications sequence"
            onClick={() => fireDeckComplete(500, 100)}
            color="rose"
          />
        </div>
      </section>

      {/* Raw Confetti Demo */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Confetti Only</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DemoButton
            label="Demo Confetti"
            description="Trigger confetti animation only, no notification text"
            onClick={() => fireConfetti()}
            color="neutral"
          />
        </div>
      </section>
    </div>
  );
}
