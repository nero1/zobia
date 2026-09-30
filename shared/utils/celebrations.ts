/**
 * shared/utils/celebrations.ts
 *
 * Which coin-ledger movements may trigger the confetti celebration.
 *
 * Only genuine inflows the user earned or was gifted qualify. Refunds
 * ("Reduced a poll reward pot", failed-payout returns, cancelled wagers, ...),
 * purchases, conversions and balance adjustments give credits back or move
 * them around; they must never be celebrated no matter how large the amount
 * is. The list is an allow-list on purpose: an unknown/new transaction type is
 * NOT celebrated until it is added here.
 *
 * Shared by the web app (and PWA) and the Capacitor Android app so both apply
 * identical rules.
 */

const CELEBRATABLE_CREDIT_TYPES: ReadonlySet<string> = new Set([
  // earned: quests, activity and rewards
  "quest_reward",
  "daily_login",
  "ad_reward",
  "welcome_bonus",
  "onboarding_welcome",
  "monthly_plan_bonus",
  "subscription_bonus",
  "brand_broadcast_bonus",
  "prestige_reward",
  "season_reward",
  "season_milestone",
  "sponsored_quest_payout",
  "war_reward",
  "game_reward",
  "game_payout",
  "forum_question_reward",
  "forum_answer_reward",
  "forum_upvote_reward",
  "forum_best_answer_reward",
  "bbforum_thread_reward",
  "bbforum_reply_reward",
  "bbforum_pot_claim",
  "blog_treasury_claim",
  "blog_gift_treasury_claim",
  "poll_create_reward",
  "poll_vote_reward",
  "poll_treasury_claim",
  "quiz_create_reward",
  "quiz_attempt_reward",
  "quiz_treasury_claim",
  "wiki_create_reward",
  "wiki_contribute_reward",
  "wiki_treasury_claim",
  "room_reward_claim",
  "report_reward",
  "group_join_credit",
  "group_message_credit",
  "comeback_bonus_claimed",
  "referral_bonus",
  "referral_commission",
  "referral_qualifying_action",
  "merch_sale",
  "blog_gift_earnings",
  // gifted
  "gift_received",
  "friend_gift",
  "season_pass_gift",
  "admin_grant",
]);

/**
 * True when a ledger entry of this transaction type is an earned or gifted
 * inflow that may be celebrated. Refund/purchase/adjustment types (and any
 * unknown type) return false.
 */
export function isCelebratableCreditType(transactionType: string | null | undefined): boolean {
  return !!transactionType && CELEBRATABLE_CREDIT_TYPES.has(transactionType);
}

/**
 * Gate for a realtime/imperative credits or stars award. Existing emitters
 * that predate ledger typing send no `transactionType` and are earned awards
 * by construction, so an absent type is allowed; a present type must be an
 * earned/gifted inflow.
 */
export function shouldCelebrateCreditAward(transactionType?: string | null): boolean {
  if (transactionType == null || transactionType === "") return true;
  return isCelebratableCreditType(transactionType);
}
