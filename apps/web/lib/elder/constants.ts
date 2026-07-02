/**
 * lib/elder/constants.ts
 *
 * Shared Elder System thresholds (PRD §7). Single source of truth so
 * GET /api/elder and POST /api/elder/request never drift out of sync.
 */

/** Minimum prestige count to be eligible as an elder. */
export const ELDER_MIN_PRESTIGE = 3;

/** Elder must have been active within this many days. */
export const ELDER_ACTIVITY_DAYS = 30;

/** Maximum concurrent mentees per elder. */
export const MAX_MENTEES = 5;

/** Users below this XP can request an elder as a mentor. */
export const MENTEE_MAX_XP = 6_000;
