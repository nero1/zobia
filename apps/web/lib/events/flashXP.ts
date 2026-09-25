/**
 * lib/events/flashXP.ts
 *
 * Utility for checking, applying, and advancing Flash XP event lifecycle.
 *
 * Flash XP events are short-duration double (or higher) XP periods.
 * An event is "active" when:
 *   - fires_at <= NOW()
 *   - ends_at > NOW()
 *   - is_active = true
 *   - fired = true (confirmed as live)
 *
 * Lifecycle transitions (handled by advanceFlashXPLifecycle):
 *   announced_at reached → send push notifications (once, via announcement_notification_sent flag)
 *   fires_at reached     → set fired=true (XP engine starts applying multiplier)
 *   ends_at reached      → set is_active=false (multiplier stops)
 */

import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlashXPLifecycleResult {
  announced: number;
  fired: number;
  expired: number;
}

export interface FlashXPResult {
  /** The final XP value after applying any active flash multiplier. */
  finalXP: number;
  /** Whether a flash XP event was active at the time of the call. */
  flashActive: boolean;
  /** The name of the active flash event, or null if none. */
  eventName: string | null;
  /** The multiplier that was applied (1.0 if no event). */
  multiplier: number;
}

interface FlashXPEventRow {
  id: string;
  name: string;
  multiplier: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Advance the Flash XP event lifecycle: announce upcoming events, fire active
 * ones, and expire ended ones. Safe to call from multiple cron handlers —
 * uses atomic DB flags to prevent double-processing.
 *
 * @returns Counts of events that transitioned in each phase.
 */
export async function advanceFlashXPLifecycle(): Promise<FlashXPLifecycleResult> {
  const result: FlashXPLifecycleResult = { announced: 0, fired: 0, expired: 0 };
  const now = new Date();
  const db = await getDb();

  // Phase 1: Announce — announced_at reached, not yet sent notification
  try {
    const toAnnounce = await db
      .select({
        id: schema.flashXpEvents.id,
        name: schema.flashXpEvents.name,
        multiplier: sql<string>`${schema.flashXpEvents.multiplier}::TEXT`,
        firesAt: schema.flashXpEvents.firesAt,
        endsAt: schema.flashXpEvents.endsAt,
      })
      .from(schema.flashXpEvents)
      .where(
        and(
          eq(schema.flashXpEvents.isActive, true),
          lte(schema.flashXpEvents.announcedAt, now),
          eq(schema.flashXpEvents.announcementNotificationSent, false),
          gt(schema.flashXpEvents.firesAt, now)
        )
      );

    for (const evt of toAnnounce) {
      // Atomically claim the announcement with optimistic lock
      const claimed = await db
        .update(schema.flashXpEvents)
        .set({ announcementNotificationSent: true, notificationSentAt: new Date() })
        .where(
          and(eq(schema.flashXpEvents.id, evt.id), eq(schema.flashXpEvents.announcementNotificationSent, false))
        )
        .returning({ id: schema.flashXpEvents.id });
      if (claimed.length === 0) continue;

      // FIX-C03: include reference_id in INSERT so the ON CONFLICT target is valid
      const announceTimeStr = new Intl.DateTimeFormat("en", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        minute: "2-digit",
      }).format(evt.endsAt ? new Date(evt.endsAt) : now);

      await db
        .execute(sql`
          INSERT INTO notifications (user_id, type, title, body, metadata, is_read, reference_id, created_at)
          SELECT id,
                 'flash_xp_announced',
                 '⚡ Flash XP Event Coming!',
                 ${`Double XP is happening sometime before ${announceTimeStr} today! Stay active.`},
                 ${JSON.stringify({
                   eventId: evt.id,
                   name: evt.name,
                   multiplier: parseFloat(evt.multiplier),
                   windowEnd: evt.endsAt,
                 })}::jsonb,
                 FALSE,
                 ${`flash_xp:${evt.id}:announced`},
                 NOW()
          FROM users
          WHERE deleted_at IS NULL
            AND last_active_at > NOW() - INTERVAL '30 days'
          ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        `)
        .catch(() => {});
      result.announced++;
    }
  } catch {
    // Non-fatal — lifecycle step failures logged by caller
  }

  // Phase 2: Fire — fires_at reached, not yet marked fired
  try {
    const toFire = await db
      .select({
        id: schema.flashXpEvents.id,
        name: schema.flashXpEvents.name,
        multiplier: sql<string>`${schema.flashXpEvents.multiplier}::TEXT`,
        firesAt: schema.flashXpEvents.firesAt,
        endsAt: schema.flashXpEvents.endsAt,
      })
      .from(schema.flashXpEvents)
      .where(
        and(
          eq(schema.flashXpEvents.isActive, true),
          eq(schema.flashXpEvents.fired, false),
          lte(schema.flashXpEvents.firesAt, now),
          gt(schema.flashXpEvents.endsAt, now)
        )
      );

    for (const evt of toFire) {
      const claimed = await db
        .update(schema.flashXpEvents)
        .set({ fired: true, updatedAt: new Date() })
        .where(and(eq(schema.flashXpEvents.id, evt.id), eq(schema.flashXpEvents.fired, false)))
        .returning({ id: schema.flashXpEvents.id });
      if (claimed.length === 0) continue;
      // Invalidate cache so the new active event is picked up immediately
      await invalidateFlashXPCache();

      // FIX-C03: include reference_id so the ON CONFLICT target is valid
      const liveTimeStr = new Intl.DateTimeFormat("en", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        minute: "2-digit",
      }).format(evt.endsAt ? new Date(evt.endsAt) : now);

      await db
        .execute(sql`
          INSERT INTO notifications (user_id, type, title, body, metadata, is_read, reference_id, created_at)
          SELECT id,
                 'flash_xp_live',
                 ${`⚡ ${evt.name} is LIVE NOW!`},
                 ${`${evt.multiplier}× XP until ${liveTimeStr}. Go earn!`},
                 ${JSON.stringify({
                   eventId: evt.id,
                   name: evt.name,
                   multiplier: parseFloat(evt.multiplier),
                   endsAt: evt.endsAt,
                 })}::jsonb,
                 FALSE,
                 ${`flash_xp:${evt.id}:live`},
                 NOW()
          FROM users
          WHERE deleted_at IS NULL
            AND last_active_at > NOW() - INTERVAL '7 days'
          ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        `)
        .catch(() => {});

      // Upsert into platform_events for the events calendar
      await db
        .insert(schema.platformEvents)
        .values({
          name: evt.name,
          description: "Double XP event",
          eventType: "flash_xp",
          xpMultiplier: evt.multiplier,
          startsAt: evt.firesAt ?? now,
          endsAt: evt.endsAt,
          isActive: true,
          metadata: { source_flash_xp_id: evt.id },
        })
        .onConflictDoNothing({
          target: [schema.platformEvents.name, schema.platformEvents.startsAt],
        })
        .catch(() => {});

      result.fired++;
    }
  } catch {
    // Non-fatal
  }

  // Phase 3: Expire — ends_at reached
  try {
    const toExpire = await db
      .select({ id: schema.flashXpEvents.id })
      .from(schema.flashXpEvents)
      .where(and(eq(schema.flashXpEvents.isActive, true), lte(schema.flashXpEvents.endsAt, now)));

    for (const evt of toExpire) {
      await db
        .update(schema.flashXpEvents)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.flashXpEvents.id, evt.id))
        .catch(() => {});
      // Invalidate cache so the expired event stops being served
      await invalidateFlashXPCache();
      result.expired++;
    }
  } catch {
    // Non-fatal
  }

  return result;
}

/** Redis cache key for the active flash XP event. */
const FLASH_XP_CACHE_KEY = "flash_xp:active_event";
/** TTL in seconds — flash events transition at most hourly, so 60s staleness is acceptable. */
const FLASH_XP_CACHE_TTL = 60;

/**
 * Invalidate the flash XP cache. Call this from the admin panel or lifecycle
 * CRON whenever a flash event is activated or deactivated.
 */
export async function invalidateFlashXPCache(): Promise<void> {
  await redis.del(FLASH_XP_CACHE_KEY).catch(() => {});
}

/**
 * Check for an active Flash XP event and apply its multiplier to the given
 * base XP amount.
 *
 * BUG-L05: The previous implementation queried the DB on every single XP award
 * call (could be thousands per minute under load). Replaced with a 60-second
 * Redis cache so the DB is only hit on cache miss.
 *
 * If multiple events are active (edge case), the highest multiplier wins.
 *
 * @param userId  - The user receiving the XP (reserved for future per-user checks).
 * @param baseXP  - The base XP amount before any flash multiplier.
 * @returns An object with finalXP, flashActive flag, event name, and multiplier used.
 */
export async function checkAndApplyFlashXP(
  _userId: string,
  baseXP: number
): Promise<FlashXPResult> {
  if (baseXP <= 0) {
    return { finalXP: 0, flashActive: false, eventName: null, multiplier: 1.0 };
  }

  const fetchActiveEventFromDb = async (): Promise<FlashXPEventRow | null> => {
    const db = await getDb();
    const [row] = await db
      .select({
        id: schema.flashXpEvents.id,
        name: schema.flashXpEvents.name,
        multiplier: sql<string>`${schema.flashXpEvents.multiplier}::TEXT`,
      })
      .from(schema.flashXpEvents)
      .where(
        and(
          lte(schema.flashXpEvents.firesAt, sql`NOW()`),
          gt(schema.flashXpEvents.endsAt, sql`NOW()`),
          eq(schema.flashXpEvents.isActive, true),
          eq(schema.flashXpEvents.fired, true)
        )
      )
      .orderBy(desc(schema.flashXpEvents.multiplier))
      .limit(1);
    return row ?? null;
  };

  // Try cache first
  let activeEvent: FlashXPEventRow | null = null;
  try {
    const cached = await redis.get(FLASH_XP_CACHE_KEY);
    if (cached !== null) {
      // "NONE" sentinel means we cached a negative result (no active event)
      activeEvent = cached === "NONE" ? null : (JSON.parse(cached) as FlashXPEventRow);
    } else {
      // Cache miss — query the DB and populate the cache
      activeEvent = await fetchActiveEventFromDb();
      await redis.set(
        FLASH_XP_CACHE_KEY,
        activeEvent ? JSON.stringify(activeEvent) : "NONE",
        "EX",
        FLASH_XP_CACHE_TTL
      ).catch(() => {});
    }
  } catch {
    // Cache failure is non-fatal — fall back to a direct DB query
    try {
      activeEvent = await fetchActiveEventFromDb();
    } catch {
      // If DB also fails, skip the flash multiplier rather than breaking XP awards
      return { finalXP: baseXP, flashActive: false, eventName: null, multiplier: 1.0 };
    }
  }

  if (!activeEvent) {
    return { finalXP: baseXP, flashActive: false, eventName: null, multiplier: 1.0 };
  }

  const multiplier = parseFloat(activeEvent.multiplier);
  const finalXP = Math.floor(baseXP * multiplier);

  return {
    finalXP,
    flashActive: true,
    eventName: activeEvent.name,
    multiplier,
  };
}
