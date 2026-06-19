export const dynamic = 'force-dynamic';

/**
 * app/api/cron/daily/route.ts — DEPRECATED
 *
 * This monolithic 2700-line handler has been split into 7 staggered daily
 * slots to stay within Vercel Hobby's 10-second function timeout.
 *
 * New endpoints (all scheduled in vercel.json, all UTC):
 *   23:00  /api/cron/daily-core      — quest reset, login streaks, XP, moments, pins
 *   00:00  /api/cron/daily-users     — inactivity events, guild discovery, comeback coins
 *   01:00  /api/cron/daily-notify    — re-engagement push/email/Telegram, council invites
 *   02:00  /api/cron/daily-guilds    — guild tiers, patron badge, contribution alerts, quests
 *   03:00  /api/cron/daily-economy   — creator fund, plan bonus, ad revenue, payouts, referrals
 *   04:00  /api/cron/daily-social    — nemesis, season snapshot, leaderboard, stickers, trust
 *   05:00  /api/cron/daily-platform  — season transitions, mystery XP, flash XP, alliance wars,
 *                                      Telegram queue, room expiry, SYS maintenance
 */

import { NextResponse } from "next/server";

export const GET = async () => {
  return NextResponse.json(
    {
      error: "Gone",
      message:
        "This endpoint has been replaced by 7 staggered daily CRON slots. " +
        "See /api/cron/daily-core through /api/cron/daily-platform.",
      replacements: [
        "/api/cron/daily-core",
        "/api/cron/daily-users",
        "/api/cron/daily-notify",
        "/api/cron/daily-guilds",
        "/api/cron/daily-economy",
        "/api/cron/daily-social",
        "/api/cron/daily-platform",
      ],
    },
    { status: 410 }
  );
};
