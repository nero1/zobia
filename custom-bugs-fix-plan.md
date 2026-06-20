# Zobia Social — Bug Fix Plan
**Generated:** June 20, 2026 06:42 PM
**Reference:** custom-bugs-report.md (same session)
**Status:** AWAITING REVIEW. Do not execute fixes until approved.

All tasks are ordered by priority tier (Critical → High → Medium → Low). Each entry lists the bug serial, the files to change, and the precise action to take.

---

## Priority Tier 1 — Critical (financial correctness, security, platform breakage)

---

### TASK-01 | B01-EXPO-AUTH-LOGOUT
**Files:** `apps/expo/lib/auth/context.tsx`

In the `signOut()` function, before calling `deleteItemAsync` on the SecureStore access/refresh tokens, add a best-effort `POST /api/auth/logout` call using the current access token. If the request fails (network error, 4xx, 5xx), catch and swallow the error — signout must always complete locally. If the request succeeds, proceed to clear SecureStore. This ensures the Redis session and refresh token are invalidated at the server even if the client token is being discarded.

---

### TASK-02 | B02-WEBHOOK-DODO-401
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

Find the invalid-signature early-return. Change the response from:
```
return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
```
to:
```
console.warn("[webhook/dodopayments] Invalid HMAC signature — discarding event");
return NextResponse.json({ received: true }, { status: 200 });
```
Leave the HTTP 500 responses for genuine processing errors intact so DodoPayments retries those.

---

### TASK-03 | B03-GAME-REWARD-TX
**Files:** `apps/web/lib/games/sessions.ts`

Move the `grantGamingReward` call inside the same `db.transaction()` that sets the play row's `counted = true`. Pass the transaction client to `grantGamingReward`. Ensure `grantGamingReward` is idempotent by keying its coin/XP ledger inserts on the game_play `id` (e.g., `reference_id = 'game_reward:${playId}'`). If moving the reward inside the transaction is not feasible (due to external API calls in `grantGamingReward`), use the DLQ pattern instead: write a `pending_game_rewards` row inside the transaction before it commits, then resolve it in the post-commit phase.

---

### TASK-04 | B04-EXPO-2FA-DEEPLINK
**Files:** `apps/expo/app/auth/login.tsx`

In the `handleDeepLink` function, add an `else if` branch after the existing `code` check:
```
} else if (params.pre_auth_code) {
  // Server issued a pre-auth token — user has 2FA enabled
  router.replace({ pathname: '/auth/two-factor', params: { preAuthCode: params.pre_auth_code } });
}
```
Ensure the `/auth/two-factor` screen exists or create it. This screen should accept the `preAuthCode`, prompt the user for their TOTP/OTP, and call the appropriate verification endpoint.

---

### TASK-05 | B07-DODO-COINS-ZERO
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts`

In `processPaymentSucceeded`, before the `creditCoins` call for `coin_pack` items, add a guard:
```
if (coinsToGrant <= 0) {
  await tx.query(
    `INSERT INTO failed_webhooks (...) VALUES (...)`, [...]
  );
  return; // do not throw — let the transaction commit with status=completed
}
```
This prevents `creditCoins` from throwing on a zero-amount grant and keeps the payment status consistent.

---

### TASK-06 | B19-IAP-SUB-ACK-FIRE-FORGET
**Files:** `apps/web/app/api/economy/iap/verify/route.ts`

In `verifyAndActivateSubscription`, find the fire-and-forget fetch call that sends the subscription acknowledgment to Google Play. Change it from:
```
fetch(ackUrl, { ... }).catch(...).finally(() => clearTimeout(ackTimer));
```
to:
```
try {
  const ackResp = await fetch(ackUrl, { signal: ackCtrl.signal, method: 'POST', ... });
  if (!ackResp.ok) console.error('[iap/verify] Subscription ack failed:', ackResp.status);
} catch (e) {
  console.error('[iap/verify] Subscription ack error:', e);
} finally {
  clearTimeout(ackTimer);
}
```
The `await` ensures the acknowledgment completes before the serverless function returns its response. Failures are logged but do not fail the subscription activation.

---

## Priority Tier 2 — High (correctness errors with real user impact)

---

### TASK-07 | B05-SEASON-STICKER-THROW
**Files:** `apps/web/lib/seasons/seasonEngine.ts`

In `claimPassMilestone`, find the block that handles `reward_type === 'sticker_pack'`. Replace the `throw new Error(...)` on pack-not-found with:
```
logger.error({ milestoneId, userId }, '[seasonEngine] Sticker pack not found for milestone reward — skipping grant');
await globalDb.query(
  `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
   VALUES ('missing_sticker_pack', 'warning', $1, $2::jsonb, NOW())`,
  [`Sticker pack not found for milestone ${milestoneId}`, JSON.stringify({ milestoneId, userId })]
).catch(() => {});
// fall through — milestone is still marked claimed
```
The milestone claim commit should still succeed so the user is not permanently blocked.

---

### TASK-08 | B14-WAR-DRAW-REMATCH
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

In the Step 2 resolved-war loop, wrap the rematch token insert in an outcome check:
```
if (result.outcome !== 'draw') {
  const loserGuildId = result.loserGuildId; // use the value returned by resolveWar
  await db.query(
    `INSERT INTO guild_war_rematch_tokens (...) VALUES ($1, $2, 50, false, NOW() + INTERVAL '7 days')
     ON CONFLICT DO NOTHING`,
    [loserGuildId, war.id]
  );
}
```
Note: `resolveWar` already returns `loserGuildId` — use that directly instead of re-deriving it from `winnerGuildId`.

---

### TASK-09 | B15-TRUST-DOUBLE-PENALTY
**Files:** `apps/web/lib/trust/trustScore.ts`

In `calculateTrustScore`, change the `moderation_action_count` subquery from:
```sql
SELECT COUNT(*)::text FROM moderation_actions WHERE target_user_id = u.id
```
to:
```sql
SELECT COUNT(*)::text FROM moderation_actions WHERE target_user_id = u.id AND action_type != 'warn'
```

In `batchCalculateTrustScores`, apply the same change to the `mac` LEFT JOIN subquery:
```sql
FROM moderation_actions WHERE target_user_id = ANY($1::uuid[]) AND action_type != 'warn'
```
This ensures warnings are penalised only once (through `warningCount`) rather than twice.

---

### TASK-10 | B17-PAYOUT-APPROVE-SILENT-PASS
**Files:** `apps/web/app/api/admin/payouts/[payoutId]/approve/route.ts`

Change the user query from:
```sql
SELECT COALESCE(is_banned, false) AS is_banned FROM users WHERE id = $1
```
to:
```sql
SELECT COALESCE(is_banned, false) AS is_banned FROM users WHERE id = $1 AND deleted_at IS NULL
```
Then add a missing-row check after the query:
```ts
if (!userRows[0]) {
  throw badRequest("Cannot approve payout: creator account not found or deleted", "USER_NOT_FOUND");
}
```

---

### TASK-11 | B11-PAYSTACK-SUB-SQL
**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`

In the `subscription.disable` handler, replace the conditional string-interpolated SQL with a fixed-shape query that always includes `ends_at`:
```sql
UPDATE users
SET plan = $1,
    subscription_status = 'cancelled',
    plan_expires_at = $2,
    updated_at = NOW()
WHERE subscription_code = $3
```
Pass `cancellationDate ?? null` as `$2`. This eliminates the conditional parameter shift and makes the query safe to audit and modify.

---

## Priority Tier 3 — Medium (reliability, edge cases, security hardening)

---

### TASK-12 | B08-CSP-BROAD-CONNECT
**Files:** `apps/web/middleware.ts`

In `buildCsp`, replace:
```
"connect-src 'self' https: wss:",
```
with an explicit allowlist. Identify all external fetch targets used by the app (Paystack API, DodoPayments API, Expo push API, your WebSocket server, any CDN) and list them explicitly. Example:
```
"connect-src 'self' https://api.paystack.co https://api.dodo.ac wss://ws.yourdomain.com",
```
Test in staging before deploying — an overly restrictive connect-src will break live features.

---

### TASK-13 | B06-PUSH-DEDUP-DEVICES
**Files:** `apps/web/lib/notifications/push.ts`

In `sendPushNotification`, after fetching all tokens for the user, deduplicate by `device_id` before building the push payload:
```ts
const seenDevices = new Set<string>();
const dedupedTokens = tokens.filter(t => {
  if (seenDevices.has(t.device_id)) return false;
  seenDevices.add(t.device_id);
  return true;
});
```
Use the most recently active token per device (ORDER BY last_active_at DESC before dedup). This ensures one push per physical device regardless of how many tokens it has registered.

---

### TASK-14 | B09-SAFEAWARD-PHANTOM-DLQ
**Files:** `apps/web/lib/quests/questEngine.ts`, `apps/web/lib/guilds/warEngine.ts`

Audit every `safeAwardXP` call site that currently passes a `TransactionClient`. Restructure the callers so XP awards are issued after the outer transaction commits:

In `questEngine.ts` (updateQuestProgress): after the outer `db.transaction()` call returns, call `safeAwardXP(userId, xp, track, source, referenceId)` using `globalDb` (no transaction client). If the outer transaction throws, skip the XP award entirely — the DLQ should not be filled with phantom entries.

In `warEngine.ts` (resolveWar): collect the list of XP awards to issue (userId, xp, referenceId) from within the transaction, then after the transaction commits, issue them via `safeAwardXP` with `globalDb`.

---

### TASK-15 | B10-TELEGRAM-STALE-INTERVAL
**Files:** `apps/expo/app/auth/login.tsx`

In the Telegram polling useEffect or function, introduce a cancellation flag:
```ts
let cancelled = false;
const cleanup = () => { cancelled = true; clearInterval(intervalId); };

// Inside each poll tick, after any await:
if (cancelled) return;
```
Add `cancelled` checks before every `setState`, `navigation.replace`, and any other side-effect that runs after an async call. Return `cleanup` from useEffect so it runs on component unmount.

---

### TASK-16 | B16-MONTHLY-BONUS-STALE-BALANCE
**Files:** `apps/web/app/api/cron/daily-economy/route.ts`

Wrap the monthly plan bonus loop in a `db.transaction()` that adds `FOR UPDATE` to the `users` SELECT within the `eligible` CTE:
```sql
WITH eligible AS (
  SELECT id, coin_balance FROM users
  WHERE plan = $1 AND deleted_at IS NULL AND ...
  FOR UPDATE
), ...
```
This guarantees the balance snapshot used for `balance_before`/`balance_after` in the coin_ledger is accurate at the time of the INSERT. Alternatively, use `SELECT ... FOR UPDATE` separately and read the locked balance inside the transaction.

---

### TASK-17 | B18-WAR-CONTRIB-LOCK
**Files:** `apps/web/lib/guilds/recordWarContribution.ts`

Remove the `FOR UPDATE OF gw` from the guild_wars SELECT. Instead, rely on the brief implicit row lock from the subsequent `UPDATE guild_wars SET challenger_points = ...` statement. The `ON CONFLICT (war_id, user_id) DO UPDATE` on `war_contributions` already serialises concurrent contribution upserts. To prevent recording contributions for just-resolved wars (the original reason for the lock), add a re-check of `gw.status IN ('active', 'final_hour')` in the `WHERE` clause of the points UPDATE:
```sql
UPDATE guild_wars SET challenger_points = challenger_points + $1
WHERE id = $2 AND status IN ('active', 'final_hour')
```
If this UPDATE affects 0 rows, the war was just resolved — silently skip.

---

## Priority Tier 4 — Low (minor issues, accepted trade-offs, observability)

---

### TASK-18 | B12-REFERRAL-TX-HOT
**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`, `apps/web/lib/payments/dodoWebhookHandler.ts`

Move the `awardReferralCommissions` call to after the payment webhook transaction commits. Capture the `userId` and `paymentId` from the transaction result, then call `awardReferralCommissions(userId, paymentId, db)` as a fire-and-forget operation outside the transaction, wrapped in a `.catch()` that logs errors. This reduces the hot-path transaction hold time without changing referral correctness (commissions are still awarded on first purchase).

---

### TASK-19 | B13-RATE-LIMIT-L1-DRIFT
**Files:** `apps/web/lib/security/rateLimit.ts`

This is a known architectural trade-off documented in the code. No code change is required for typical endpoints. For the highest-sensitivity endpoints (coin withdrawal, payout request, gift send), explicitly set `bypassL1: true` in their rate limit call so those limits are enforced strictly via Redis on every call, eliminating the ~120% drift. This is already done for some endpoints — verify coverage for the three listed above.

---

## Implementation Notes

- Work in the order presented (Tier 1 first) to address the highest-risk bugs first.
- TASK-03 (game reward transaction) and TASK-06 (IAP ack) touch financial flows — validate with end-to-end tests before deploying.
- TASK-12 (CSP connect-src) must be validated in staging first; an overly restrictive policy will break API calls in production.
- TASK-14 (safeAwardXP phantom DLQ) requires coordination across questEngine and warEngine — test the quest completion and war resolution flows after the change to confirm XP is still awarded correctly.
- TASK-09 (trust score double-penalty) changes scoring for all existing users. Consider whether existing trust_score values should be recalculated via `batchCalculateTrustScores` after the fix is deployed.

---

*Fix plan footer: June 20, 2026 06:42 PM*
*Zobia Social — 19 tasks covering 19 identified bugs. Await approval before implementation.*
