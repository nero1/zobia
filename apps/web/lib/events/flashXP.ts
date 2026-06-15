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

import { db } from "@/lib/db";

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
  const now = new Date().toISOString();

  // Phase 1: Announce — announced_at reached, not yet sent notification
  try {
    const { rows: toAnnounce } = await db.query<{
      id: string; name: string; multiplier: string; fires_at: string; ends_at: string;
    }>(
      `SELECT id, name, multiplier::TEXT AS multiplier, fires_at, ends_at
       FROM flash_xp_events
       WHERE is_active = TRUE
         AND announced_at <= $1
         AND announcement_notification_sent = FALSE
         AND fires_at > $1`,
      [now]
    );

    for (const evt of toAnnounce) {
      // Atomically claim the announcement with optimistic lock
      const { rowCount } = await db.query(
        `UPDATE flash_xp_events
         SET announcement_notification_sent = TRUE, notification_sent_at = NOW()
         WHERE id = $1 AND announcement_notification_sent = FALSE`,
        [evt.id]
      );
      if (!rowCount || rowCount === 0) continue;

      await db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         SELECT id,
                'flash_xp_announced',
                $1::jsonb,
                FALSE,
                NOW()
         FROM users
         WHERE deleted_at IS NULL
           AND last_active_at > NOW() - INTERVAL '30 days'
         ON CONFLICT DO NOTHING`,
        [
          JSON.stringify({
            eventId: evt.id,
            name: evt.name,
            multiplier: parseFloat(evt.multiplier),
            windowEnd: evt.ends_at,
            message: `⚡ Double XP is happening sometime before ${new Date(evt.ends_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })} today! Stay active.`,
          }),
        ]
      ).catch(() => {});
      result.announced++;
    }
  } catch {
    // Non-fatal — lifecycle step failures logged by caller
  }

  // Phase 2: Fire — fires_at reached, not yet marked fired
  try {
    const { rows: toFire } = await db.query<{
      id: string; name: string; multiplier: string; fires_at: string; ends_at: string;
    }>(
      `SELECT id, name, multiplier::TEXT AS multiplier, fires_at, ends_at
       FROM flash_xp_events
       WHERE is_active = TRUE
         AND fired = FALSE
         AND fires_at <= $1
         AND ends_at > $1`,
      [now]
    );

    for (const evt of toFire) {
      const { rowCount } = await db.query(
        `UPDATE flash_xp_events SET fired = TRUE, updated_at = NOW() WHERE id = $1 AND fired = FALSE`,
        [evt.id]
      );
      if (!rowCount || rowCount === 0) continue;

      // Notify all recently active users that the event is live
      await db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         SELECT id,
                'flash_xp_live',
                $1::jsonb,
                FALSE,
                NOW()
         FROM users
         WHERE deleted_at IS NULL
           AND last_active_at > NOW() - INTERVAL '7 days'
         ON CONFLICT DO NOTHING`,
        [
          JSON.stringify({
            eventId: evt.id,
            name: evt.name,
            multiplier: parseFloat(evt.multiplier),
            endsAt: evt.ends_at,
            message: `⚡ ${evt.name} is LIVE NOW! ${evt.multiplier}× XP until ${new Date(evt.ends_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}. Go earn!`,
          }),
        ]
      ).catch(() => {});

      // Upsert into platform_events for the events calendar
      await db.query(
        `INSERT INTO platform_events
           (name, description, event_type, xp_multiplier, starts_at, ends_at, is_active, metadata, created_at, updated_at)
         VALUES ($1, 'Double XP event', 'flash_xp', $2::numeric, $3, $4, TRUE, jsonb_build_object('source_flash_xp_id', $5::text), NOW(), NOW())
         ON CONFLICT (name, starts_at) DO NOTHING`,
        [evt.name, evt.multiplier, evt.fires_at, evt.ends_at, evt.id]
      ).catch(() => {});

      result.fired++;
    }
  } catch {
    // Non-fatal
  }

  // Phase 3: Expire — ends_at reached
  try {
    const { rows: toExpire } = await db.query<{ id: string }>(
      `SELECT id FROM flash_xp_events WHERE is_active = TRUE AND ends_at <= $1`,
      [now]
    );

    for (const evt of toExpire) {
      await db.query(
        `UPDATE flash_xp_events SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [evt.id]
      ).catch(() => {});
      result.expired++;
    }
  } catch {
    // Non-fatal
  }

  return result;
}

/**
 * Check for an active Flash XP event and apply its multiplier to the given
 * base XP amount.
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

  // Query active flash XP events
  const { rows } = await db.query<FlashXPEventRow>(
    `SELECT id, name, multiplier::TEXT AS multiplier
     FROM flash_xp_events
     WHERE fires_at <= NOW()
       AND ends_at > NOW()
       AND is_active = TRUE
       AND fired = TRUE
     ORDER BY multiplier DESC
     LIMIT 1`
  );

  if (!rows[0]) {
    return { finalXP: baseXP, flashActive: false, eventName: null, multiplier: 1.0 };
  }

  const event = rows[0];
  const multiplier = parseFloat(event.multiplier);
  const finalXP = Math.floor(baseXP * multiplier);

  return {
    finalXP,
    flashActive: true,
    eventName: event.name,
    multiplier,
  };
}
