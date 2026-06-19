/**
 * lib/games/config.ts
 *
 * Small helpers around the games feature flag + runtime config (manifest).
 */

import { loadManifest } from "@/lib/manifest";
import { forbidden } from "@/lib/api/errors";

/** Returns true when the games feature is enabled by the admin. */
export async function gamesEnabled(): Promise<boolean> {
  const manifest = await loadManifest();
  return manifest.features.games === true;
}

/** Throws a 403 ApiError when the games feature is disabled. */
export async function assertGamesEnabled(): Promise<void> {
  if (!(await gamesEnabled())) {
    throw forbidden("The games feature is currently unavailable.", "GAMES_DISABLED");
  }
}

/** Resolved games runtime config from the manifest. */
export async function getGamesConfig() {
  const manifest = await loadManifest();
  return manifest.games;
}
