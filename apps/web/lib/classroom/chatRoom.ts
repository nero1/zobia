/**
 * lib/classroom/chatRoom.ts
 *
 * Gating + capacity for the classroom's live chat Room
 * (classroom_settings.chatRoomEnabled → /rooms/<roomId>). Off by default;
 * only Pro/Max personal plans and Business accounts may turn it on. When
 * enabled, the room's total roster is capped (default 150) — the existing
 * `rooms.max_members` field already enforces this at join time (see
 * lib/rooms/capacity.ts) — and a smaller default (20) is recorded as the
 * target for concurrently-active participants for future realtime-presence
 * throttling.
 */

import { getManifestValue } from "@/lib/manifest";

const PLANS_WITH_CHAT_ROOM = new Set(["pro", "max"]);

export interface ChatRoomEligibility {
  eligible: boolean;
  reason?: string;
}

/** @param plan personal plan ("free"|"plus"|"pro"|"max")
 *  @param isBusinessAccount whether the creator also has an active Business account */
export function canEnableClassroomChatRoom(plan: string, isBusinessAccount: boolean): ChatRoomEligibility {
  if (isBusinessAccount || PLANS_WITH_CHAT_ROOM.has(plan)) return { eligible: true };
  return {
    eligible: false,
    reason: "The classroom chat Room is available on Pro, Max and Business plans. Upgrade to enable it.",
  };
}

export async function getChatRoomMaxActive(): Promise<number> {
  const raw = await getManifestValue("classroom_chat_max_active");
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export async function getChatRoomMaxTotal(): Promise<number> {
  const raw = await getManifestValue("classroom_chat_max_total");
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 150;
}
