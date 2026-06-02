/**
 * lib/events/flashXP.ts
 *
 * Utility for checking and applying Flash XP event multipliers.
 *
 * Flash XP events are short-duration double (or higher) XP periods.
 * An event is "active" when:
 *   - fires_at <= NOW()
 *   - ends_at > NOW()
 *   - is_active = true
 *   - fired = true (confirmed as live)
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
