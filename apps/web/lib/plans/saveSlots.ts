/**
 * lib/plans/saveSlots.ts
 *
 * Per-plan save slot counts for the Save Slots feature (PRD "Save Slots for
 * games"). Admin-configurable via x_manifest `save_slots_<plan>` keys
 * (migration 0042), read through the shared manifest cache (15s memory +
 * 60s Redis) to keep Redis calls minimal.
 */

import { getManifestValue } from "@/lib/manifest";
import type { Plan } from "@zobia/types";

/** Fallback defaults — must match migration 0042's seeded x_manifest values. */
const DEFAULT_SAVE_SLOTS: Record<Plan, number> = {
  free: 0,
  plus: 1,
  pro: 3,
  max: 5,
};

export async function getSaveSlotLimit(plan: string): Promise<number> {
  const key = (plan in DEFAULT_SAVE_SLOTS ? plan : "free") as Plan;
  const raw = await getManifestValue(`save_slots_${key}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_SAVE_SLOTS[key];
}
