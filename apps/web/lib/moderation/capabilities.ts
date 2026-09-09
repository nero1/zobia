/**
 * lib/moderation/capabilities.ts
 *
 * Granular, admin-configurable capability checks for the two moderator
 * tiers (PRD "Platform Mods and Forum Mods"):
 *
 *  - Platform Mods (users.is_moderator) — sitewide jurisdiction.
 *  - Forum Mods (guild_members.is_moderator) — scoped to a single guild,
 *    assigned by that guild's captain (or an admin).
 *
 * Admins can always perform every action regardless of these flags — the
 * flags only ever narrow what a non-admin moderator may do. Defaults live
 * in lib/manifest (DEFAULT_MANIFEST.moderation), editable at
 * /gate44/moderation/settings.
 */

import type { ZobiaManifest } from "@/lib/manifest";
import { loadManifest } from "@/lib/manifest";

export type PlatformModAction = keyof ZobiaManifest["moderation"]["platformModActions"];
export type GuildModAction = keyof ZobiaManifest["moderation"]["guildModActions"];

/** Maps the wire-format action string (e.g. "remove_content") used by the API to the manifest capability key (e.g. "removeContent"). */
const PLATFORM_ACTION_TO_CAP: Record<string, PlatformModAction> = {
  dismiss: "dismiss",
  warn: "warn",
  remove_content: "removeContent",
  suspend_user: "suspendUser",
  ban_user: "banUser",
  escalate_ai: "escalateAi",
};

const GUILD_ACTION_TO_CAP: Record<string, GuildModAction> = {
  dismiss: "dismiss",
  warn: "warn",
  remove_content: "removeContent",
  mute_member: "muteMember",
  kick_member: "kickMember",
};

/** Whether a Platform Mod (non-admin) is allowed to perform `action`. Admins should bypass this check entirely at the call site. */
export async function canPlatformModPerform(action: string): Promise<boolean> {
  const cap = PLATFORM_ACTION_TO_CAP[action];
  if (!cap) return false;
  const manifest = await loadManifest();
  return manifest.moderation.platformModActions[cap];
}

/** Whether a Forum Mod (guild-scoped, non-admin/non-captain) is allowed to perform `action`. */
export async function canGuildModPerform(action: string): Promise<boolean> {
  const cap = GUILD_ACTION_TO_CAP[action];
  if (!cap) return false;
  const manifest = await loadManifest();
  return manifest.moderation.guildModActions[cap];
}
