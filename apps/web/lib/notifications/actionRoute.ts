/**
 * lib/notifications/actionRoute.ts
 *
 * ZSB-16 fix: GET /api/notifications/route.ts's response never included an
 * `actionUrl` field, even though the web notifications page
 * (app/(app)/notifications/page.tsx) has always rendered
 * `notification.actionUrl` as a link — the field was simply always
 * `undefined`, so tapping a notification never navigated anywhere on any
 * platform. There is no `action`/`actionUrl` column on the `notifications`
 * table itself (the `action` passed to `sendPushNotification` at insert time
 * is only used for the push payload, never persisted), so this derives the
 * in-app route from the notification's already-stored `type` + `metadata`
 * columns — the same two fields both web and Android already fetch.
 *
 * Deliberately maps a bounded, verified set of `type` values (the
 * `NotificationType` union in lib/notifications/insert.ts plus every other
 * `type` string actually passed to insertNotification/insertNotificationBatch
 * found via a full-codebase search) rather than guessing — an unrecognised
 * type resolves to `null` (no action), which is the same as today's
 * behaviour, so this can only add navigation, never break an existing route.
 */

interface NotificationMetadata {
  [key: string]: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Derive the in-app route a notification of this `type` (with this
 * `metadata`) should open when tapped, or `null` if there isn't one.
 *
 * Both the Android app and the web client re-validate this against their own
 * route allowlist before navigating (see
 * apps/android/src/lib/notifications/routing.ts's `isAllowedRoute`) — this
 * function's output is never trusted blindly by the client.
 */
export function deriveNotificationActionUrl(
  type: string,
  metadata: NotificationMetadata | null
): string | null {
  const m = metadata ?? {};

  switch (type) {
    case "gift_received":
      return "/gifts";
    case "dm_sticker_unlock":
      return isNonEmptyString(m.threadId) ? `/messages/${m.threadId}` : "/messages";
    case "guild_discovery":
    case "guild_low_contribution":
      return "/guilds";
    case "ad_revenue_enrolled":
    case "kyc_verification_fee":
    case "mentorship_bonus":
      return "/wallet";
    case "season_reward":
      return "/seasons";
    case "war_result":
      return isNonEmptyString(m.roomId) ? `/rooms/${m.roomId}` : "/rooms";
    case "referral_qualified":
      return "/referrals";
    case "welcome":
      return "/home";
    case "friend_request":
      return "/friends";
    case "blog_new_post":
      return isNonEmptyString(m.blogSlug) && isNonEmptyString(m.postSlug)
        ? `/blogs/${m.blogSlug}/${m.postSlug}`
        : null;
    case "gift_drop_announced":
      return "/events";
    case "kyc_submitted":
    case "kyc_escalated":
    case "kyc_approved":
    case "kyc_rejected":
      return "/kyc";
    default:
      return null;
  }
}
