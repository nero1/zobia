/**
 * lib/plans/graceFeatures.ts
 *
 * Registry of features that CAN be preserved during a subscription's grace
 * period (see lib/plans/gracePeriod.ts). Admin picks a subset of this list
 * per plan/business tier at /admin/config ("Grace Periods & Save Slots").
 *
 * To add a new grace-gated feature:
 *   1. Add an entry below.
 *   2. Wherever that feature's data is purged, gate the purge behind
 *      `isFeaturePreservedDuringGrace()` (see lib/games/saves.ts
 *      `purgeSavesForUser` for the reference implementation).
 * No new admin UI or migration is needed — the config page renders
 * checkboxes for whatever is in this array.
 */

export interface GraceFeatureDef {
  key: string;
  label: string;
  description: string;
}

export const GRACE_FEATURE_REGISTRY: GraceFeatureDef[] = [
  {
    key: "saved_games",
    label: "Saved Games (Save Slots)",
    description: "In-progress game saves sitting in the user's save slots.",
  },
  {
    key: "galleries",
    label: "Image Galleries",
    description: "Extra photo gallery slots. Feature not yet built — reserved for future use.",
  },
];

export const GRACE_FEATURE_KEYS = GRACE_FEATURE_REGISTRY.map((f) => f.key);
