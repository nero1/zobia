# Zobia Codebase — Bug Fix Plan

**Date:** June 16, 2026  
**Time:** 02:26 AM UTC  
**Based on:** custom-bugs-report.md (same session)

> **IMPORTANT: Do NOT begin any fix until the report has been reviewed and approved.**

Fixes are ordered by severity. Within each severity tier, fix order is listed from most impactful to least. Each task is self-contained and can be worked independently unless a dependency is noted.

---

## CRITICAL Fixes

---

### TASK-01 — Add Payment Webhook Paths to `PUBLIC_PREFIXES`

**Fixes:** BUG-01  
**Risk:** Low — adding to an allowlist, not removing a check. The route handlers already verify HMAC signatures.  
**Effort:** ~5 minutes

**Steps:**
1. Open `apps/web/middleware.ts`.
2. In the `PUBLIC_PREFIXES` array, add these two entries:
   - `"/api/economy/webhooks/paystack"`
   - `"/api/economy/webhooks/dodopayments"`
3. Deploy and verify with a Paystack test event and a DodoPayments test event — both should now reach the route handler and return 200.
4. Confirm that sending a POST to either path without a valid HMAC signature still returns 400 (rejected by the route handler, not by middleware).

---

### TASK-02 — Fix `transferCoins` Parameter Order

**Fixes:** BUG-02  
**Risk:** Medium — every call site must be updated to use the corrected argument order.  
**Effort:** ~15 minutes

**Steps:**
1. Open `apps/web/lib/economy/coins.ts`.
2. In the `transferCoins` function signature, move `idempotencyRef: string` before `txClient?: TransactionClient`. The corrected order should be: `(fromUserId, toUserId, amount, type, referenceId, idempotencyRef, txClient?)`.
3. Search the entire `apps/web` directory for all calls to `transferCoins` and update argument positions at each call site.
4. If any call site legitimately needs to pass `txClient` without an `idempotencyRef`, make `idempotencyRef` optional (type `string | null`, default `null`) and verify the partial-unique constraint in `coin_ledger` still provides protection for non-null refs.
5. Run TypeScript type checking (`tsc --noEmit`) and confirm zero TS2016 errors.

---

## HIGH Fixes

---

### TASK-03 — Fix DodoPayments Webhook Error Handling

**Fixes:** BUG-03  
**Risk:** Low — changing catch block response code; no business logic changes.  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/app/api/economy/webhooks/dodopayments/route.ts`.
2. In the catch block, replace the unconditional `return NextResponse.json({ received: true }, { status: 200 })` with conditional logic:
   - If the caught error is a Postgres unique-violation (`err.code === '23505'`), return `{ status: 200 }` — the event was already processed, idempotent success.
   - For all other errors, log the full error with event type and return `{ status: 500 }` so DodoPayments retries delivery.
3. Add structured error logging (`logger.error(...)`) in the generic catch branch with enough context to diagnose the failure type.
4. Test with a simulated DB error (mock DB failure) and verify the endpoint returns 500. Test with a duplicate event and verify 200.

---

### TASK-04 — Add Idempotency Key to DM Gift Transfers

**Fixes:** BUG-04  
**Risk:** Medium — requires a per-request idempotency key and handler reordering.  
**Effort:** ~30 minutes

**Steps:**
1. Open `apps/web/app/api/messages/dm/route.ts`.
2. Ensure the client sends a stable `clientMessageId` or `idempotencyKey` in the request body for gift sends. If it does not, generate a server-side key using a composite of `conversationId + senderId + requestTimestamp` and store it in the idempotency Redis key at step 8.
3. Construct `giftRef = "dm_gift:${conversationId}:${senderId}:${clientMessageId}"`.
4. Move the `handleDMGift()` call to after the idempotency Redis check (step 8), not before it.
5. Pass `giftRef` as the `idempotencyRef` (and as `referenceId`) to both `debitCoins` and `creditCoins` inside `handleDMGift`. The partial unique index on `coin_ledger (transactionType, referenceId)` will prevent duplicate ledger entries on retry.
6. Confirm by sending the same gift request twice: the second call should return the idempotency-cached response without any coin movement.

---

### TASK-05 — Fix Group Chat XP `reference_id`

**Fixes:** BUG-05  
**Risk:** Medium — changes the XP deduplication key for group messages; existing ledger rows with `groupId` references are unaffected (they remain valid historical records).  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/app/api/messages/group/[groupId]/route.ts`.
2. Find the `xp_ledger` INSERT for `source = 'group_message'`.
3. Replace `reference_id = $groupId` with `reference_id = 'group_msg:' + messageId` where `messageId` is the UUID of the message row just inserted. This ensures uniqueness per message.
4. Wrap the XP award in a `safeAwardXP(userId, amount, 'social', 'group_message', 'group_msg:' + messageId)` call instead of raw SQL, so failures fall to the DLQ instead of rolling back silently.
5. Verify: send two messages in the same group as the same user — both should earn XP. Send the same message twice (simulate retry by calling the endpoint with the same `messageId`) — only one XP award should be recorded.

---

### TASK-06 — Replace DM Text XP Raw Queries with `safeAwardXP`

**Fixes:** BUG-06  
**Risk:** Low — `safeAwardXP` is already used elsewhere; this is a like-for-like replacement.  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/app/api/messages/dm/route.ts`.
2. Locate the two-query pattern for text message XP (`INSERT INTO xp_ledger` + `UPDATE users SET xp_total`).
3. Replace both queries with a single `await safeAwardXP(userId, xpAmount, 'social', 'dm_text', 'dm_text:' + messageId)` call.
4. Remove the now-unused raw query imports/variables for the XP section.
5. Confirm the `xp_ledger` and `users` tables stay in sync by checking both tables after a test DM.

---

### TASK-07 — Replace DM Gift XP Raw Queries with `safeAwardXP`

**Fixes:** BUG-07  
**Risk:** Low — same pattern as TASK-06.  
**Effort:** ~20 minutes

**Steps:**
1. In `apps/web/app/api/messages/dm/route.ts`, inside `handleDMGift` (or wherever the gift XP awards happen).
2. Locate both the sender XP and the recipient XP two-query patterns.
3. Replace sender XP with `await safeAwardXP(senderId, senderXp, 'generosity', 'dm_gift_sent', 'dm_gift_sent:' + giftId)`.
4. Replace recipient XP with `await safeAwardXP(recipientId, recipientXp, 'social', 'dm_gift_received', 'dm_gift_received:' + giftId)`.
5. Remove unused raw XP query code.

---

### TASK-08 — Fix DM Coin Ledger `balance_before` TOCTOU

**Fixes:** BUG-08  
**Risk:** Low — audit data fix; no change to coin movement logic.  
**Effort:** ~15 minutes

**Steps:**
1. Open `apps/web/lib/economy/coins.ts`. In `debitCoins`, the function already performs `SELECT ... FOR UPDATE` to lock the row. After the lock, the actual `coin_balance` at that moment is read — expose this as part of the return value or use it directly within the function when writing `balance_before` to the ledger.
2. In `apps/web/app/api/messages/dm/route.ts`, remove the use of `sender.coin_balance` from the pre-transaction outer query as the `balance_before` source.
3. Ensure the `balance_before` value recorded in the ledger INSERT comes from the locked row inside the transaction, not from the outer read. The easiest way is to compute it inside the `debitCoins` function itself where the lock is already held.

---

## MEDIUM Fixes

---

### TASK-09 — Fix Push Token Deletion to Target Only the Failing Token

**Fixes:** BUG-09  
**Risk:** Low — scope reduction; only removes the single stale token.  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/lib/notifications/push.ts`.
2. In the `push_tickets` table INSERT (where tickets are created), add the `token` field so each ticket row stores the specific device token used to send that notification.
3. In `apps/web/lib/db/schema.ts`, add a `token` column to the `push_tickets` table.
4. In the receipt polling loop, when a `DeviceNotRegistered` receipt is processed, read `ticket.token` (the stored token for that specific ticket) and add only that token to `staleTokens`. Remove the secondary `SELECT token FROM user_push_tokens WHERE user_id = $1` query that fetches all tokens.
5. Verify: simulate a `DeviceNotRegistered` receipt for one device; confirm only that device's token is deleted and the other device's token remains.

---

### TASK-10 — Fix Service Worker Root Route Caching

**Fixes:** BUG-10  
**Risk:** Low — tightening the cache strategy; no new features.  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/public/sw.js`.
2. Locate the `NetworkFirst` registration for root `/`.
3. Replace it with either:
   - `NetworkOnly` for the root URL (no caching of navigation responses to `/`), OR
   - Add a response plugin that filters out `opaqueredirect` responses: before caching any response, check `response.type !== 'opaqueredirect'` and skip caching if it is.
4. If the app has a PWA shell HTML file (e.g., `/offline.html` or the precached app shell), use `NavigationRoute` with `createHandlerBoundToURL('/index.html')` for all navigation requests and let the client-side router handle auth redirects after hydration.
5. Test by loading the app while unauthenticated, checking the browser cache for the root URL — confirm no opaque response is stored.

---

### TASK-11 — Batch Nemesis Refresh into Single SQL Operation

**Fixes:** BUG-11  
**Risk:** Medium — significant rewrite of the refresh query; test thoroughly with large user counts.  
**Effort:** ~1 hour

**Steps:**
1. Open `apps/web/lib/nemesis/nemesisEngine.ts`.
2. Identify the outer loop that iterates user pairs and issues one transaction per pair.
3. Replace the loop with a single CTE-based query:
   - Use a ranked window function to identify each user's closest XP competitor (nemesis candidate) in a single pass over the `users` table.
   - Build the full assignments array in one SELECT with `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ABS(u.xp_total - candidate.xp_total) ASC)`.
   - Issue a single `INSERT INTO nemesis_assignments (...) SELECT ... ON CONFLICT DO UPDATE` with the full result set.
4. Wrap in one transaction (not N transactions).
5. Benchmark the batch query against the current loop on a dataset of 1,000 and 10,000 users to confirm the improvement.

---

### TASK-12 — Handle Paystack `subscription.not_renew` Event

**Fixes:** BUG-12  
**Risk:** Low — adding a new handler branch, no changes to existing logic.  
**Effort:** ~20 minutes

**Steps:**
1. Open `apps/web/app/api/economy/webhooks/paystack/route.ts`.
2. In the event-type switch/if block, add a case for `subscription.not_renew`.
3. In the handler:
   - Look up the subscription by Paystack `subscription_code` from the event payload.
   - Set `cancel_at_period_end = true` on the matching subscription record in the database.
   - Optionally trigger a notification to the user (push/email) informing them their subscription will not renew.
4. Return HTTP 200 after processing.
5. Test with a Paystack test event of type `subscription.not_renew` and verify the DB row is updated.

---

### TASK-13 — Add Idempotency Guard to `insertNotification`

**Fixes:** BUG-13  
**Risk:** Medium — requires a schema migration to add the `reference_id` column and unique index.  
**Effort:** ~45 minutes

**Steps:**
1. Open `apps/web/lib/db/schema.ts`. Add a `reference_id` column (`varchar(255), nullable`) to the `notifications` table.
2. Add a unique partial index: `CREATE UNIQUE INDEX uidx_notifications_ref ON notifications (reference_id) WHERE reference_id IS NOT NULL`.
3. Write and run the migration.
4. Open `apps/web/lib/notifications/insert.ts`. Update `insertNotification` and `insertNotificationBatch` to:
   - Accept an optional `referenceId` parameter.
   - Include `reference_id` in the INSERT.
   - Append `ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING`.
5. Update all callers to pass a deterministic `referenceId` where available (e.g., `xp_award:${userId}:${source}:${date}`, `gift_received:${giftId}`).
6. For notification types without a natural dedup key, leave `referenceId` null — they will not be deduplicated, but this is an improvement over the current state where every notification is duplicate-prone.

---

### TASK-14 — Verify and Harden Leaderboard `ON CONFLICT` Expression

**Fixes:** BUG-14  
**Risk:** Low to verify; medium if the index actually mismatches and needs correction.  
**Effort:** ~30 minutes

**Steps:**
1. On a staging or production Postgres instance, run `\d leaderboard_snapshots` and examine the index definition for the `COALESCE`-based unique index.
2. Compare the exact expression string to the `ON CONFLICT` clause in `apps/web/lib/leaderboards/engine.ts`.
3. If they differ in any whitespace, type cast format, or quoting, update the raw SQL `ON CONFLICT` clause to exactly match what Postgres shows for the index.
4. Long-term: add a surrogate `snapshot_key` column populated as a deterministic hash or concatenation of the composite key, add a unique index on that column, and change `ON CONFLICT (snapshot_key) DO UPDATE` to eliminate reliance on expression matching.
5. Add an integration test that inserts two rows with the same logical key and verifies the `ON CONFLICT` upsert fires correctly rather than raising an error.

---

## LOW Fixes

---

### TASK-15 — Make `CRON_SECRET` Required in Env Validation

**Fixes:** BUG-15  
**Risk:** Low — boot-time validation change; any deployment without the var will fail fast at startup instead of silently at runtime.  
**Effort:** ~10 minutes

**Steps:**
1. Open `apps/web/lib/env.ts`.
2. Change `CRON_SECRET: z.string().optional()` to `CRON_SECRET: z.string().min(32)`.
3. In `apps/web/app/api/cron/daily/route.ts` (and any other cron route), update `validateCronSecret` to throw a descriptive error if `process.env.CRON_SECRET` is undefined at runtime rather than silently returning false.
4. Ensure `CRON_SECRET` is documented in `.env.example` with a note that it must be at least 32 characters.
5. Verify deployment pipeline sets the var; add it to the Vercel environment variable list if not already there.

---

### TASK-16 — Fix Creator Fund Pool Distribution for Small Cohorts

**Fixes:** BUG-16  
**Risk:** Low — edge-case math fix; production cohorts above ~20 creators are unaffected.  
**Effort:** ~30 minutes

**Steps:**
1. Open `apps/web/lib/creator/fund.ts`.
2. Add a guard at the top of the distribution function: if `totalCreators < 5` (or a configurable threshold), skip the tier structure and distribute the entire pool equally among all eligible creators (`perCreator = pool / totalCreators`).
3. If keeping the tier structure for small cohorts is required, detect empty tier slices after computing cutoffs and redistribute their allocation proportionally to the non-empty tiers.
4. Add unit tests covering 1, 2, 3, 5, and 10 creators that assert the sum of all payouts equals the input pool amount.

---

### TASK-17 — Pass `blockLinks` Flag to Content Filter

**Fixes:** BUG-17  
**Risk:** Very low — single-line change, no new logic.  
**Effort:** ~5 minutes

**Steps:**
1. Open `apps/web/app/api/rooms/[roomId]/messages/route.ts`.
2. Find the call to `filterPublicContent(content)` (or equivalent).
3. Change it to `filterPublicContent(content, { blockLinks })`.
4. Open the content filter module (`apps/web/lib/moderation/contentFilter.ts` or similar). Verify the `blockLinks` option is implemented as a code path that strips or rejects URLs. If not, implement it: when `blockLinks` is true, run a URL-stripping regex over the content (or reject the message) before returning.
5. Test by sending a message containing a URL to a room configured with `blockLinks = true` — it should be filtered or rejected.

---

### TASK-18 — URL-Decode Cookie Values in `parseCookies`

**Fixes:** BUG-18  
**Risk:** Very low — purely additive decoding; valid unencoded cookies are unaffected.  
**Effort:** ~10 minutes

**Steps:**
1. Open `apps/web/lib/security/csrf.ts`.
2. In `parseCookies`, after splitting each name=value pair, wrap the value assignment in `decodeURIComponent`:
   - `value = decodeURIComponent(rawValue)` inside a try/catch that falls back to the raw value on `URIError`.
3. Add a test that sets a cookie with a URL-encoded value (e.g., `state=abc%2Bdef`) and asserts `parseCookies` returns `abc+def`.

---

### TASK-19 — Improve Reengagement Variant Distribution

**Fixes:** BUG-19  
**Risk:** Very low — notification content change; no security or financial impact.  
**Effort:** ~10 minutes

**Steps:**
1. Open `apps/web/lib/notifications/reengagement.ts`.
2. Replace the char-code sum variant selector with a more uniform approach:
   - Option A (simplest): `parseInt(userId.replace(/-/g, '').slice(-6), 16) % messages.length` — uses the last 6 hex characters of the UUID, which are uniformly random in v4 UUIDs.
   - Option B (more robust): Implement a 32-bit FNV-1a hash of the `userId` string and modulo by `messages.length`.
3. The change is purely cosmetic — no DB migrations or API changes needed.
4. Verify by generating 10,000 random UUIDs and confirming the variant distribution is close to uniform (within ±5% of expected for each variant).

---

## Recommended Fix Order

For a production hotfix sequence:

1. **Deploy TASK-01 immediately** (5 min, CRITICAL — restores all payment processing)
2. **Deploy TASK-02** (15 min, CRITICAL — fixes TypeScript error)
3. **Deploy TASK-03** (20 min, HIGH — DodoPayments retry reliability)
4. **Deploy TASK-04 + TASK-05 + TASK-06 + TASK-07 + TASK-08 together** in a single PR (DM and group message fixes — they touch related files and should be tested together)
5. **Deploy TASK-09** (push notification fix)
6. **Deploy TASK-10** (service worker fix)
7. Remaining medium and low tasks can be batched into a single cleanup PR.

---

*Fix plan generated: June 16, 2026 — 02:26 AM UTC*  
*Based on: custom-bugs-report.md (same session)*  
*Repository: nero1/zobia*
