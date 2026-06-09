/**
 * lib/notifications/reengagement.ts
 *
 * Generates re-engagement notification payloads for inactive users.
 *
 * Different message buckets are used based on how many days the user
 * has been inactive. Returns null if the user has been active within
 * the last 3 days (not worth re-engaging yet).
 *
 * Optionally accepts pre-fetched personalised context to substitute
 * real event data into message bodies (PRD: "highlight real events that
 * occurred since the user went inactive").
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

/**
 * Optional personalised context that callers can pre-fetch and pass in.
 * When provided, the relevant message variant body is replaced with
 * real event data rather than static copy.
 *
 * Callers are responsible for querying the database before calling
 * `getReengagementPayload`. Recommended queries:
 *
 * Guild war outcome (last 30 days):
 * ```sql
 * SELECT gw.result, g.name
 * FROM guild_wars gw
 * JOIN guild_members gm ON gm.guild_id = gw.guild_id
 * WHERE gm.user_id = $userId
 *   AND gw.ended_at >= NOW() - INTERVAL '30 days'
 * ORDER BY gw.ended_at DESC
 * LIMIT 1
 * ```
 *
 * Current season phase:
 * ```sql
 * SELECT phase, name FROM seasons WHERE is_active = TRUE LIMIT 1
 * ```
 *
 * Nemesis XP delta:
 * ```sql
 * SELECT na.nemesis_id, (nu.xp_total - u.xp_total) AS xp_delta
 * FROM nemesis_assignments na
 * JOIN users u  ON u.id  = na.user_id
 * JOIN users nu ON nu.id = na.nemesis_id
 * WHERE na.user_id = $userId
 * LIMIT 1
 * ```
 */
export interface PersonalisedContext {
  /**
   * A human-readable description of a recent guild war event.
   * Replaces the body of the 7-day guild message variant when provided.
   * Example: "Your guild won a war while you were away!"
   */
  guildEvent?: string;
  /**
   * A human-readable description of the current season phase.
   * Replaces the body of the 14-day season message variant when provided.
   * Example: "The season is in its final week"
   */
  seasonPhase?: string;
  /**
   * A human-readable description of the user's nemesis XP delta.
   * Replaces the body of the 7-day nemesis message variant when provided.
   * Example: "Your nemesis gained 1,200 XP while you were away!"
   */
  nemesisContext?: string;
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
      {
        // Third variant: surfaced when guildEvent context is available.
        // Body is replaced at runtime by personalContext.guildEvent if provided.
        title: "Your Guild had big news",
        body: "Check what happened with your crew while you were away.",
        action: "/guilds",
      },
      {
        // Fourth variant: surfaced when nemesisContext is available.
        // Body is replaced at runtime by personalContext.nemesisContext if provided.
        title: "Your Nemesis is pulling ahead",
        body: "While you were away, your nemesis made their move. Time to catch up.",
        action: "/nemesis",
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
      {
        // Third variant: surfaced when seasonPhase context is available.
        // Body is replaced at runtime by personalContext.seasonPhase if provided.
        title: "The season has moved on",
        body: "Check your Season rank — the competition has been heating up without you.",
        action: "/seasons",
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
        body: "We saved 200 Coins for you. They expire in 7 days. Coins are real and are actually reserved — log in to claim them.",
        action: "/economy/coins",
      },
      {
        title: "Your old friends are still here",
        body: "We reserved 200 Coins just for you — come back within 7 days to claim them and reconnect with your crew.",
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
 * The function selects a message variant deterministically from the
 * appropriate time bucket using the userId as a seed (so the same user
 * always gets the same variant within a bucket, but different users see
 * different messages).
 *
 * When `personalContext` is supplied, real event data is substituted into
 * the relevant message body:
 *  - `personalContext.guildEvent`  → overrides the body of the 7-day
 *    "Your Guild had big news" variant.
 *  - `personalContext.seasonPhase` → overrides the body of the 14-day
 *    "The season has moved on" variant.
 *
 * @param userId                 - The user's UUID (used for deterministic message selection).
 * @param daysSinceActive        - Number of full days since the user last logged in.
 * @param loginStreakBeforeBreak - The login streak the user had just before going inactive.
 *                                 Used to gate the 3-day streak-at-risk notification.
 * @param personalContext        - Optional pre-fetched real-event strings. Callers are
 *                                 responsible for querying guild war / season / nemesis data
 *                                 before calling this function (see PersonalisedContext).
 * @returns A notification payload or null if daysSinceActive < 3 or streak gate not met.
 */
export async function getReengagementPayload(
  userId: string,
  daysSinceActive: number,
  loginStreakBeforeBreak: number = 0,
  personalContext?: PersonalisedContext
): Promise<ReengagementPayload | null> {
  if (daysSinceActive < 3) return null;

  // 3-day bucket is only a streak-at-risk alert — skip if the user had no meaningful streak
  if (daysSinceActive < 7 && loginStreakBeforeBreak < 5) return null;

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

  // Clone the selected message so we can safely mutate it
  const payload: ReengagementPayload = { ...selectedBucket.messages[variantIndex]! };

  // Substitute real event data into the body when personalContext is available.
  // The 7-day guild variant is identified by its action route ("/guilds") and title.
  if (
    personalContext?.guildEvent &&
    payload.title === "Your Guild had big news" &&
    payload.action === "/guilds"
  ) {
    payload.body = personalContext.guildEvent;
  }

  // The 14-day season variant is identified by its action route ("/seasons") and title.
  if (
    personalContext?.seasonPhase &&
    payload.title === "The season has moved on" &&
    payload.action === "/seasons"
  ) {
    payload.body = personalContext.seasonPhase;
  }

  // The 7-day nemesis variant is identified by its action route ("/nemesis") and title.
  if (
    personalContext?.nemesisContext &&
    payload.title === "Your Nemesis is pulling ahead" &&
    payload.action === "/nemesis"
  ) {
    payload.body = personalContext.nemesisContext;
  }

  return payload;
}
