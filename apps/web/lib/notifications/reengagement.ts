/**
 * lib/notifications/reengagement.ts
 *
 * Generates re-engagement notification payloads for inactive users.
 *
 * Different message buckets are used based on how many days the user
 * has been inactive. Returns null if the user has been active within
 * the last 3 days (not worth re-engaging yet).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReengagementPayload {
  /** Push notification title. */
  title: string;
  /** Push notification body text. */
  body: string;
  /** Deep link action / route to open. */
  action: string;
}

// ---------------------------------------------------------------------------
// Message buckets
// ---------------------------------------------------------------------------

/**
 * The 5 re-engagement tiers ordered from earliest to latest.
 * Each bucket defines the minimum days threshold and the message variants.
 */
const REENGAGEMENT_BUCKETS: Array<{
  minDays: number;
  messages: ReengagementPayload[];
}> = [
  {
    minDays: 3,
    messages: [
      {
        title: "We miss you! 👀",
        body: "It's been a few days. Jump back in and see what you've been missing.",
        action: "/home",
      },
      {
        title: "Your friends are active",
        body: "Someone might be waiting for you to reply. Don't leave them hanging!",
        action: "/inbox",
      },
    ],
  },
  {
    minDays: 7,
    messages: [
      {
        title: "A week without Zobia? 😮",
        body: "Your streak is in danger. Log in today and keep the vibe alive.",
        action: "/home",
      },
      {
        title: "Guild needs you!",
        body: "Your guild hasn't heard from you in a week. Show up for the team.",
        action: "/guilds",
      },
    ],
  },
  {
    minDays: 14,
    messages: [
      {
        title: "Come back, we have gifts 🎁",
        body: "Two weeks away? Log in now to claim your comeback bonus coins.",
        action: "/economy/coins",
      },
      {
        title: "Lots has changed",
        body: "New rooms, new drama, new legends — you've been missing everything!",
        action: "/home",
      },
    ],
  },
  {
    minDays: 30,
    messages: [
      {
        title: "A whole month? 😢",
        body: "We saved your spot. Come back and get your 30-day return bonus.",
        action: "/home",
      },
      {
        title: "Season updates you missed",
        body: "The season has moved on — check your rank and earn your way back up!",
        action: "/seasons",
      },
    ],
  },
  {
    minDays: 90,
    messages: [
      {
        title: "Long time no see 🙏",
        body: "3 months is a long time. A lot has changed — come see what's new on Zobia.",
        action: "/home",
      },
      {
        title: "Your old friends are still here",
        body: "Don't lose your connections. Log back in and reconnect with your crew.",
        action: "/friends",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a re-engagement notification payload for a user based on how
 * many days they have been inactive.
 *
 * @param userId          - The user's UUID (used for deterministic message selection).
 * @param daysSinceActive - Number of full days since the user last logged in.
 * @returns A notification payload or null if daysSinceActive < 3.
 */
export async function getReengagementPayload(
  userId: string,
  daysSinceActive: number
): Promise<ReengagementPayload | null> {
  if (daysSinceActive < 3) return null;

  // Find the highest applicable bucket
  let selectedBucket = REENGAGEMENT_BUCKETS[0];
  for (const bucket of REENGAGEMENT_BUCKETS) {
    if (daysSinceActive >= bucket.minDays) {
      selectedBucket = bucket;
    }
  }

  // Pick a message variant deterministically based on userId
  // (avoids always showing the same message to the same user)
  const variantIndex =
    userId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) %
    selectedBucket.messages.length;

  return selectedBucket.messages[variantIndex];
}
