/**
 * lib/classroom/draftLimits.ts
 *
 * How many classrooms (draft + live combined) a user may own at once, and
 * the creator level a Free-plan user must reach before creating any
 * classroom at all. Same admin-configurable-via-x_manifest idiom as
 * lib/plans/saveSlots.ts.
 */

import { getManifestValue } from "@/lib/manifest";
import type { Plan } from "@zobia/types";

/** Fallback defaults, seeded into x_manifest by migration 0006. Paid plans
 *  get access at any level; only Free requires DEFAULT_FREE_MIN_LEVEL. */
const DEFAULT_MAX_CLASSROOMS: Record<Plan, number> = {
  free: 3,
  plus: 10,
  pro: 15,
  max: 20,
};

/** Creator-track level a Free-plan user must reach before creating any
 *  classroom (paid plans bypass this entirely). */
const DEFAULT_FREE_MIN_LEVEL = 5;

export async function getMaxClassrooms(plan: string): Promise<number> {
  const key = (plan in DEFAULT_MAX_CLASSROOMS ? plan : "free") as Plan;
  const raw = await getManifestValue(`classroom_max_total_${key}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_MAX_CLASSROOMS[key];
}

export async function getFreeMinLevel(): Promise<number> {
  const raw = await getManifestValue("classroom_free_min_level");
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_FREE_MIN_LEVEL;
}
