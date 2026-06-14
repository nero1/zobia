# Zobia Codebase — Bug Fix Plan

**Generated:** June 14, 2026 — 01:42 AM  
**Companion to:** `custom-bugs-report.md` (14 findings, BUG-01 … BUG-14)  
**Status:** AWAITING REVIEW — do not implement until approved.

---

## Execution Order

Fix in this order to minimize cascading changes and allow incremental verification:

1. **BUG-02** (CRITICAL — economy exploit, deploy immediately)
2. **BUG-01** (HIGH — credential leak in headers)
3. **BUG-14** (HIGH — PIN brute force)
4. **BUG-05** (HIGH — coin inflation)
5. **BUG-11** (HIGH — nemesis permanent exclusion)
6. **BUG-04** (HIGH — subscription table mismatch)
7. **BUG-06** (MEDIUM — xp_competitor drift)
8. **BUG-09** (MEDIUM — alliance war XP audit trail)
9. **BUG-10** (MEDIUM — quest coin bypass)
10. **BUG-07** (MEDIUM — login XP wrong signal)
11. **BUG-12** (MEDIUM — season badge overwrite)
12. **BUG-08** (MEDIUM — Telegram fire-and-forget)
13. **BUG-03** (MEDIUM — referral idempotency collision)
14. **BUG-13** (LOW — redundant DB query)

---

## Fix Plans (One Per Bug)

---

### FIX-01: BUG-01 — Remove refresh token from HTTP response headers

**File:** `apps/web/app/api/auth/refresh/route.ts`

**Change:** Delete the two lines that set tokens as response headers. The tokens are already delivered via `buildCookieHeaders` as HttpOnly cookies — the header exposure is entirely redundant.

```ts
// DELETE these two lines:
response.headers.set("X-Access-Token", accessToken);
response.headers.set("X-Refresh-Token", rotatedRefreshToken);
```

**Verification:** After deploy, confirm `/api/auth/refresh` POST response headers contain no `X-Access-Token` or `X-Refresh-Token` fields. Confirm client-side token refresh still works (relies on cookies, not these headers).

**Risk:** Low. If any client code reads these headers to manually store tokens, it will break. Search codebase for `X-Access-Token` and `X-Refresh-Token` header reads before deploying. Expected: none (the app uses HttpOnly cookies exclusively).

---

### FIX-02: BUG-02 — DodoPayments server-side amount validation

**File:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**Change:** After HMAC signature verification, extract the item slug from metadata and look up the authoritative grant amounts from `store_items`.

```ts
// After signature verification:
const itemSlug = payload.metadata?.itemSlug;
if (!itemSlug) return NextResponse.json({ error: "Missing itemSlug" }, { status: 400 });

const { rows: itemRows } = await db.query(
  "SELECT coins_granted, stars_granted, item_type FROM store_items WHERE slug = $1 AND is_active = true",
  [itemSlug]
);
const storeItem = itemRows[0];
if (!storeItem) return NextResponse.json({ error: "Unknown item" }, { status: 400 });

// Use server values, not client metadata:
const serverCoinsGranted = storeItem.coins_granted;
const serverStarsGranted = storeItem.stars_granted;
```

Replace all `coinsGranted` / `starsGranted` references downstream with `serverCoinsGranted` / `serverStarsGranted`.

**Verification:** Attempt to send a DodoPayments webhook with manipulated `metadata.coinsGranted`. Confirm the server grants the `store_items`-authoritative amount, not the metadata value.

**Risk:** Medium. Requires `store_items` to have a `slug` that matches what the DodoPayments payment link sends in metadata. Coordinate with the DodoPayments payment-link creation flow to ensure `itemSlug` is always passed.

---

### FIX-03: BUG-03 — DodoPayments referral commission paymentId argument

**File:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**Change:** Pass `paymentId` as the 4th argument to `awardReferralCommissions`:

```ts
// Before:
await awardReferralCommissions(tx, userId, coinsGranted ?? 0);

// After:
const paymentId = payload.data.payment.payment_id; // or equivalent field from DodoPayments payload
await awardReferralCommissions(tx, userId, serverCoinsGranted, paymentId);
```

**Verification:** Make two separate purchases from the same user. Confirm both generate distinct referral commission ledger entries.

**Risk:** Low, additive change. Requires identifying the correct payment ID field name from the DodoPayments webhook payload schema.

---

### FIX-04: BUG-04 — DodoPayments subscription table mismatch

**File:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**Change:** Audit which table is authoritative for subscriptions. Assuming `user_subscriptions` (used by Paystack and all subscription-check queries):

```ts
// Change:
await tx.query(
  `INSERT INTO subscriptions (user_id, plan, ...) VALUES ($1, $2, ...)
   ON CONFLICT (user_id) DO UPDATE SET ...`,
  [...]
);

// To:
await tx.query(
  `INSERT INTO user_subscriptions (user_id, plan, provider, ...) VALUES ($1, $2, 'dodopayments', ...)
   ON CONFLICT (user_id) DO UPDATE SET 
     plan = EXCLUDED.plan,
     provider = EXCLUDED.provider,
     updated_at = NOW()`,
  [...]
);
```

**Prerequisite:** Confirm `user_subscriptions` schema matches the columns DodoPayments needs to write (add `provider` column migration if needed). Verify all subscription-check code queries `user_subscriptions`.

**Risk:** Medium. Schema migration may be needed. After switching, DodoPayments subscribers will appear correctly in subscription checks. Any existing records in the `subscriptions` table from DodoPayments will need migration.

---

### FIX-05: BUG-05 — Gift guild-share coin inflation

**File:** `apps/web/app/api/economy/gifts/send/route.ts`

**Change:** Source the guild share from the platform fee, not from new coins. The recommended approach:

```ts
// Current (creates coins from thin air):
const platformFeeCoins = Math.floor(coin_cost * platformFeeRate);
const recipientCoins = coin_cost - platformFeeCoins;
const guildShare = Math.floor(coin_cost * 0.05);
// sender pays coin_cost, recipient gets recipientCoins, guild gets guildShare NEW coins

// Fixed (guild share comes from platform fee):
const rawPlatformFee = Math.floor(coin_cost * platformFeeRate);
const guildShare = Math.floor(coin_cost * 0.05);
const platformRetained = rawPlatformFee - guildShare; // fee split
const recipientCoins = coin_cost - rawPlatformFee;    // unchanged

// Verify invariant: coin_cost === recipientCoins + rawPlatformFee
// Guild share comes out of rawPlatformFee, no new coins created
// UPDATE guilds SET treasury_balance = treasury_balance + guildShare (from fee, not new)
```

If `guildShare` could exceed `platformFeeRate * coin_cost` for small gifts, add a guard:
```ts
const guildShare = Math.min(Math.floor(coin_cost * 0.05), rawPlatformFee);
```

**Verification:** Send a gift. Confirm `debitCoins(sender)` === `creditCoins(recipient)` + `guildShare` + `platformRetained`. Check that total coin supply is unchanged.

**Risk:** Medium. This changes recipient coin amounts if guild share was previously an addition on top of the existing fee split. Coordinate with product to confirm intended split.

---

### FIX-06: BUG-06 — War engine xp_competitor column never updated

**File:** `apps/web/lib/guilds/warEngine.ts`

**Change:** Add `xp_competitor = xp_competitor + $1` to all war XP award UPDATE statements.

In `resolveWar` (victory XP loop):
```sql
-- Before:
UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2

-- After:
UPDATE users SET 
  xp_total = xp_total + $1,
  xp_competitor = xp_competitor + $1,
  updated_at = NOW()
WHERE id = $2
```

In `distributeWarRewards` (top contributor 1,000 XP bonus):
```sql
-- Same change: add xp_competitor = xp_competitor + $1
```

**Verification:** Resolve a war. Confirm `users.xp_competitor` increases by the expected XP amount and matches the sum of `xp_ledger WHERE track = 'competitor' AND user_id = ...`.

**Risk:** Low. Pure additive column update. No behavioral change, only corrects a missing column increment.

---

### FIX-07: BUG-07 — CRON login XP uses wrong activity signal

**File:** `apps/web/app/api/cron/daily/route.ts` (Step 4)

**Change:**
```sql
-- Before:
WHERE last_active_at::date = NOW()::date

-- After:
WHERE last_login_date = CURRENT_DATE
```

**Verification:** Confirm that users who only browsed (no login) do not receive login XP. Confirm users who explicitly logged in do receive it.

**Risk:** Low. Single-line SQL change. Aligns Step 4 with Step 2's streak logic.

---

### FIX-08: BUG-08 — CRON Telegram send must be awaited

**File:** `apps/web/app/api/cron/daily/route.ts` (Step 34)

**Change:**
```ts
// Before:
sendBulkTelegramMessages(row.telegram_ids.map(...))

// After:
await sendBulkTelegramMessages(row.telegram_ids.map(...))
```

Also add error handling so a single batch failure doesn't abort all other notifications:
```ts
try {
  await sendBulkTelegramMessages(row.telegram_ids.map(...));
  await db.query("UPDATE ... SET delivered_at = NOW() ...");
} catch (err) {
  console.error("Telegram batch failed:", err);
  // Optionally: mark as failed rather than just skipping
}
```

**Verification:** Simulate a Telegram send failure (invalid bot token). Confirm `delivered_at` is NOT set for failed deliveries.

**Risk:** Low. Pure correctness fix. May slightly slow down Step 34 if Telegram sends are slow — acceptable since correctness is required.

---

### FIX-09: BUG-09 — Alliance war victory XP missing xp_ledger insert

**File:** `apps/web/app/api/cron/daily/route.ts` (Step 32b)

**Change:** After `UPDATE users SET xp_total = xp_total + $1`, insert an xp_ledger row and update `xp_competitor`:

```sql
-- Update xp_total AND xp_competitor:
UPDATE users SET 
  xp_total = xp_total + $1,
  xp_competitor = xp_competitor + $1,
  updated_at = NOW()
WHERE id = $2;

-- Insert audit record:
INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, created_at)
VALUES ($2, $1, 'competitor', 'alliance_war_victory', $3, NOW());
-- where $3 = alliance war ID
```

**Verification:** Resolve an alliance war. Confirm xp_ledger contains entries for all winners with `source = 'alliance_war_victory'`. Confirm `xp_competitor` matches ledger sum.

**Risk:** Low. Additive INSERT alongside existing UPDATE.

---

### FIX-10: BUG-10 — Quest engine coin award must use creditCoins()

**File:** `apps/web/lib/quests/questEngine.ts` (`updateQuestProgress`, lines ~234–259)

**Change:** Replace the raw `UPDATE users SET coin_balance` + `INSERT INTO coin_ledger` block with a `creditCoins()` call:

```ts
// Before (raw SQL block):
await tx.query(`UPDATE users SET coin_balance = coin_balance + $2 WHERE id = $1`, [userId, rewardAmount]);
await tx.query(`INSERT INTO coin_ledger SELECT $1, $2, coin_balance - $2, coin_balance ... FROM users WHERE id = $1`, [...]);

// After:
await creditCoins(userId, rewardAmount, "quest_reward", questCompletionId, tx);
```

Ensure `creditCoins` accepts a transaction parameter and uses it (check the function signature in `lib/economy/coins.ts`).

**Verification:** Complete a quest. Confirm `coin_ledger` entry has correct `balance_before`/`balance_after` values. Confirm no race condition under concurrent quest completions.

**Risk:** Low-Medium. Behavioral change only if `creditCoins` has additional logic (sanity checks, hooks). Verify `creditCoins` transaction parameter works correctly in the quest flow.

---

### FIX-11: BUG-11 — Nemesis refresh uses wrong filter column

**File:** `apps/web/lib/nemesis/nemesisEngine.ts`

**Change:** Replace all `dismissed_at IS NULL` filters with `is_active = true` / `is_active = false` filters:

In `refreshNemesisAssignments` (exclusion subquery):
```sql
-- Before:
WHERE id NOT IN (SELECT user_id FROM nemesis_assignments WHERE dismissed_at IS NULL)

-- After:
WHERE id NOT IN (SELECT user_id FROM nemesis_assignments WHERE is_active = true)
```

In `assignNemesis` (current nemesis query):
```sql
-- Before:
WHERE user_id = $1 AND dismissed_at IS NULL ORDER BY assigned_at DESC LIMIT 1

-- After:
WHERE user_id = $1 AND is_active = true ORDER BY assigned_at DESC LIMIT 1
```

**Verification:** Create a user with a deactivated (`is_active = false`) old nemesis assignment. Run `refreshNemesisAssignments`. Confirm the user appears in the eligible pool and receives a new assignment.

**Risk:** Low. Uses the column that the deactivation path already writes. No schema change required.

---

### FIX-12: BUG-12 — Season badge key must be season-specific

**File:** `apps/web/lib/seasons/seasonEngine.ts` (`distributeSeasonRewards`)

**Change:**
```sql
-- Before:
INSERT INTO user_badges (user_id, badge_key, badge_name, season_id, ...)
VALUES ($1, 'season_top10', 'season_top10', $2, ...)
ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING

-- After:
INSERT INTO user_badges (user_id, badge_key, badge_name, season_id, ...)
VALUES ($1, 'season_top10:' || $2::text, 'Season Top 10', $2, ...)
ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING
```

The `ON CONFLICT` clause is now safe because each `(user_id, 'season_top10:<seasonId>')` pair is unique — a user can have one badge per season, and re-runs of the reward distribution won't duplicate.

**Verification:** Award a season badge to a user. Award another for a different season. Confirm the user has two separate badge rows with distinct `badge_key` values.

**Risk:** Low. Purely additive change. Existing `season_top10` badges without season suffix remain valid (historical). Consider backfilling historical badges with the correct season ID if needed.

---

### FIX-13: BUG-13 — Paystack subscription: deduplicate email-to-userId query

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processSubscriptionEvent`)

**Change:** Cache the result of the first email lookup and reuse it:

```ts
// Before (two queries):
if (!userId) {
  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  // ... use rows
}
const resolvedUserId = userId ?? (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0]?.id;

// After (one query):
let resolvedUserId = userId;
if (!resolvedUserId) {
  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  resolvedUserId = rows[0]?.id;
  if (!resolvedUserId) {
    console.warn("Paystack subscription event: no user found for email", email);
    return; // or log and return early
  }
}
```

**Verification:** Send a subscription webhook with no `userId` in metadata. Confirm only one DB query is executed. No behavioral change expected.

**Risk:** Very low. Pure refactor with no behavioral change.

---

### FIX-14: BUG-14 — Add PIN-specific rate limit with escalating lockout

**Files:** `apps/web/lib/security/rateLimit.ts`, PIN verification route handler

**Step 1 — Add PIN rate limit preset in `rateLimit.ts`:**
```ts
export const RATE_LIMITS = {
  // ... existing presets ...
  pinVerify: { limit: 5, windowMs: 15 * 60 * 1000, name: "pin:verify" } as RateLimitOptions,
} as const;
```

**Step 2 — Apply in PIN verification handler:**
```ts
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// At the top of the PIN verification route handler:
await enforceRateLimit(userId, "user", RATE_LIMITS.pinVerify);
```

**Step 3 (recommended) — Add hard lockout tracking in Redis:**
```ts
const failureKey = `pin:failures:${userId}`;
const failures = parseInt(await redis.get(failureKey) ?? "0", 10);
if (failures >= 10) {
  throw forbidden("PIN locked. Please re-authenticate.");
}

// On PIN failure:
await redis.incr(failureKey);
await redis.expire(failureKey, 30 * 60); // 30-minute lockout window

// On PIN success:
await redis.del(failureKey);
```

**Step 4 (optional):** Send a push notification / email alert to the user when PIN failures exceed threshold (3+).

**Verification:** Attempt 6 PIN verifications within 15 minutes. Confirm 429 on 6th attempt. Confirm lockout resets after 15 minutes of no attempts.

**Risk:** Low-Medium. This is a new restriction — any client code that retries PIN verification automatically (e.g., retry on network error) must handle 429 gracefully. Test the PIN flow end-to-end.

---

## Migration Notes

| Bug | DB Migration Required? | Notes |
|-----|----------------------|-------|
| BUG-01 | No | Header removal only |
| BUG-02 | No | Requires `store_items.slug` populated for Dodo items |
| BUG-03 | No | Code-only |
| BUG-04 | Maybe | Add `provider` column to `user_subscriptions` if missing; migrate existing Dodo subscription records |
| BUG-05 | No | Coin math logic change only |
| BUG-06 | No | Column already exists, just not written |
| BUG-07 | No | SQL filter change only |
| BUG-08 | No | `await` keyword addition only |
| BUG-09 | No | INSERT addition; xp_ledger table already exists |
| BUG-10 | No | Use existing `creditCoins()` helper |
| BUG-11 | No | Column already exists, filter corrected |
| BUG-12 | No | Badge key string change; existing badges unaffected |
| BUG-13 | No | Refactor only |
| BUG-14 | No | New Redis keys (auto-created) |

---

**Fix plan generated:** June 14, 2026 — 01:42 AM  
**DO NOT IMPLEMENT until this plan has been reviewed and approved.**
