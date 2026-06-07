# Referral System Gap Analysis

## Summary
The referral system has a **CRITICAL GAP**: The PRD specifies TWO separate referral systems, but only one is implemented.

---

## What the PRD Requires (§15 — Social Architecture)

### System 1: Regular Referral (One-Time Bonuses)
**Tier 1 (Direct Referral):**
- Referrer earns **one-time Coin + XP bonus** when referred user:
  1. Completes onboarding AND
  2. Performs a qualifying action (default: first coin purchase OR 7-day login streak)
- Amounts are **admin-configurable**

**Tier 2 (Indirect Referral):**
- If Tier 1 referral's referred user also refers someone who qualifies
- Original referrer earns a smaller **one-time bonus** (also admin-configurable)
- No Tier 3 or beyond (max 2 tiers)

### System 2: Creator Affiliate / Commission-Based (Lifetime)
**For creator affiliate scenarios:**
- Admin can configure **lifetime 5% cash commission** on referred users' coin purchases
- Paid in Coins or cash (per admin config)
- Separate from regular referral system

---

## What's Actually Implemented

### ✅ Present: Commission-Based System
- Implemented in `/lib/referrals/commissions.ts`
- **Tier 1 (Direct):** 5% of every coin purchase (lifetime)
- **Tier 2 (Indirect):** 2% of every coin purchase (lifetime)
- Called from payment webhooks (Paystack + DodoPayments)
- Atomic transactions with decimal precision ✅

### ❌ Missing: Regular One-Time Referral Bonuses
- Schema columns exist (`coin_reward`, `xp_reward`, `qualified_at`) but are **never populated**
- No logic to:
  1. Detect when referred user completes a qualifying action
  2. Award one-time bonus coins
  3. Award one-time XP bonus
  4. Set `qualified_at` timestamp
  5. Populate `coin_reward` and `xp_reward` columns
- No admin config for one-time bonus amounts

---

## The Problem

**Build-Progress Claims:** "Referral system implemented" (Phase 2)

**Reality:** Only the creator affiliate commission system is implemented. The regular referral system (the more common type) is structurally incomplete.

### Evidence

**Unused schema columns:**
```sql
referrals.coin_reward INTEGER              -- ❌ Never set by any code
referrals.xp_reward   INTEGER              -- ❌ Never set by any code
referrals.rewarded_at TIMESTAMPTZ          -- ❌ Never updated
referrals.qualified   BOOLEAN DEFAULT false -- ✅ Set to true on first purchase
referrals.qualified_at TIMESTAMPTZ         -- ❌ Never set (not in schema)
```

**Missing logic:**
- No CRON job or webhook that checks `qualified = false` and triggers reward
- No way to award the one-time XP bonus described in PRD §6 ("Referring a new user who completes onboarding: 500 XP")
- No admin endpoint to configure Tier 1 and Tier 2 bonus amounts

---

## Impact

### User Perspective
- Users with referral codes can **generate lifetime commission** on their referrals' purchases
- But users **cannot get a one-time welcome bonus** from using a referral code
- This breaks the onboarding incentive (PRD §4 expects referral to be part of first-week progression)

### Creator Perspective
- Creator affiliates work correctly (5% lifetime)
- But regular creators cannot participate in the referral system

---

## What Needs to Be Built

### Priority: **HIGH** (User-facing feature gap)

#### 1. Define Admin-Configurable Bonus Amounts
Create admin endpoint `/api/admin/referral-config/route.ts`:
```typescript
interface ReferralConfig {
  tier1CoinBonus: number;        // e.g., 100 coins
  tier1XpBonus: number;          // e.g., 500 XP
  tier2CoinBonus: number;        // e.g., 50 coins
  tier2XpBonus: number;          // e.g., 250 XP
  qualifyingAction: 'coin_purchase' | 'login_streak_7' | 'both'; // default: 'coin_purchase'
  qualifyingActionThreshold: number; // e.g., if login_streak_7, threshold is 7
}
```

#### 2. Detect Qualifying Actions
Add to `/api/economy/coins/purchase/route.ts` (after payment success):
```typescript
// Check if buyer is referred and hasn't qualified yet
const referral = await getReferralRecord(buyerId);
if (referral && !referral.qualified) {
  await qualifyAndAwardReferralBonus(referral, config);
}
```

And/or add to daily CRON for login streak qualifying:
```typescript
// For each referral where qualified=false and qualifyingAction includes 'login_streak_7'
const referredUsers = await db.query(`
  SELECT r.id, r.referrer_id, u.login_streak_days
  FROM referrals r
  JOIN users u ON u.id = r.referred_id
  WHERE r.qualified = false AND r.tier = 1
`);

for (const referral of referredUsers) {
  if (referral.login_streak_days >= 7) {
    await qualifyAndAwardReferralBonus(referral, config);
  }
}
```

#### 3. Implement Award Function
Create `lib/referrals/awardBonus.ts`:
```typescript
export async function qualifyAndAwardReferralBonus(
  referral: Referral,
  config: ReferralConfig,
  db: DatabaseClient
) {
  return db.transaction(async (tx) => {
    // Mark as qualified
    await tx.query(`
      UPDATE referrals 
      SET qualified = true, qualified_at = NOW(), 
          coin_reward = $1, xp_reward = $2
      WHERE id = $3
    `, [config.tier1CoinBonus, config.tier1XpBonus, referral.id]);

    // Award coins to referrer
    if (config.tier1CoinBonus > 0) {
      await creditCoins(
        tx, 
        referral.referrer_id, 
        config.tier1CoinBonus, 
        'referral_bonus',
        referral.id
      );
    }

    // Award XP to referrer
    if (config.tier1XpBonus > 0) {
      await awardXP(
        tx,
        referral.referrer_id,
        config.tier1XpBonus,
        'social',
        'referral_bonus',
        referral.id
      );
    }

    // Similar for Tier 2 if referred user also referred someone...
  });
}
```

#### 4. Add Admin UI Page
Create `/app/(admin)/admin/referral-config/page.tsx`:
- Input fields for coin/XP bonuses (Tier 1 & 2)
- Dropdown for qualifying action
- Save button that calls the config API

---

## Current Commission System (Already Working ✅)

The lifetime commission system (intended for creator affiliates) is correctly implemented:
- Triggers on every coin purchase
- Atomic with Decimal.js precision
- Tier 1 = 5%, Tier 2 = 2%
- Correctly records to `referral_commissions` table

**This is CORRECT and working.** The gap is ONLY the regular one-time referral bonus system.

---

## Effort Estimate
- Define config structure: 15 min
- Implement award function: 30 min
- Wire to coin purchase + CRON: 20 min
- Create admin UI: 30 min
- Test: 15 min

**Total: ~2 hours**

---

## Files to Modify/Create
- `lib/referrals/awardBonus.ts` (NEW)
- `app/api/admin/referral-config/route.ts` (NEW)
- `app/(admin)/admin/referral-config/page.tsx` (NEW)
- `app/api/economy/coins/purchase/route.ts` (ADD call to award function)
- `app/api/cron/daily/route.ts` (ADD login-streak qualifying check)
- `lib/manifest/index.ts` (ADD referral config keys)
