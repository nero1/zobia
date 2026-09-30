import { isCelebratableCreditType, shouldCelebrateCreditAward } from "@zobia/shared/utils";

describe("isCelebratableCreditType", () => {
  it.each(["quest_reward", "gift_received", "poll_treasury_claim", "referral_bonus", "game_payout"])(
    "celebrates earned/gifted inflow %s",
    (type) => expect(isCelebratableCreditType(type)).toBe(true)
  );

  it.each([
    "poll_treasury_refund",
    "quiz_treasury_refund",
    "wiki_treasury_refund",
    "blog_treasury_refund",
    "bbforum_pot_refund",
    "refund",
    "gift_refund",
    "game_refund",
    "ad_campaign_refund",
    "purchase",
    "coin_purchase",
    "coin_balance_adjustment",
    "creator_coin_conversion",
    "comeback_bonus_reserved",
    "comeback_bonus_expired",
  ])("never celebrates %s", (type) => expect(isCelebratableCreditType(type)).toBe(false));

  it("is an allow-list: unknown types are not celebrated", () => {
    expect(isCelebratableCreditType("some_future_type")).toBe(false);
    expect(isCelebratableCreditType(null)).toBe(false);
    expect(isCelebratableCreditType(undefined)).toBe(false);
  });
});

describe("shouldCelebrateCreditAward", () => {
  it("allows legacy awards that carry no transaction type", () => {
    expect(shouldCelebrateCreditAward()).toBe(true);
    expect(shouldCelebrateCreditAward(null)).toBe(true);
  });
  it("blocks refunds even when the amount would cross the threshold", () => {
    expect(shouldCelebrateCreditAward("poll_treasury_refund")).toBe(false);
  });
});
