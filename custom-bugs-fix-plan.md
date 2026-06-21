# Zobia Bug Fix Plan
**Date:** June 21, 2026  **Time:** 12:00 PM

All 15 bugs from `custom-bugs-report.md`. Ordered highest-to-lowest impact. Do NOT begin any fix until the report has been reviewed and this plan approved.

---

## Fix Order and Priority

| # | Bug ID | Severity | Effort |
|---|--------|----------|--------|
| 1 | BUG-DM-01 | CRITICAL | Low |
| 2 | BUG-RL-01 | CRITICAL | Low |
| 3 | BUG-PAY-01 | HIGH | Medium |
| 4 | BUG-XP-DLQ-01 | HIGH | Low |
| 5 | BUG-MOB-01 | HIGH | Medium |
| 6 | BUG-IDEM-01 | HIGH | Medium |
| 7 | BUG-XP-FIRE-01 | MEDIUM-HIGH | Low |
| 8 | BUG-IDB-01 | HIGH | Medium |
| 9 | BUG-IDB-02 | MEDIUM | Medium |
| 10 | BUG-SW-01 | MEDIUM | Low |
| 11 | BUG-SW-02 | MEDIUM | Low |
| 12 | BUG-SEASON-PHASE-01 | MEDIUM | Low |
| 13 | BUG-ANTISPAM-01 | MEDIUM | Medium |
| 14 | BUG-HOF-01 | LOW | Medium |
| 15 | BUG-LOG-01 | LOW | Low |

---

## Fix Plans

---

### FIX-1: BUG-DM-01 — Remove coin-to-kobo financial corruption in handleDMGift
**File:** `apps/web/app/api/messages/dm/route.ts`

**What to change:** In `handleDMGift`, delete the entire `if (recipient.is_creator && recipientCoins > 0)` block that inserts into `creator_earnings` and updates `users.available_earnings_kobo` (approximately lines 207–217). These writes mix virtual coin values into real-money kobo columns. The coin_ledger entries written by `creditCoins(...)` are the canonical accounting record for DM gifts. If gift-to-fiat conversion is ever needed, apply the conversion at withdrawal time.

**Why safe:** The `gifts/send/route.ts` endpoint (the main gift send path) already omits this block entirely and explains why in a comment. Removing it from `handleDMGift` brings the DM path into alignment. The creator still receives the coins via `creditCoins`; only the incorrect fiat-column writes are removed.

**Test:** After fix, send a DM gift to a creator. Verify `creator_earnings` has no new row and `available_earnings_kobo` is unchanged. Verify `coin_ledger` has a credit entry for the recipient. Verify `coin_balance` on the recipient's users row increased correctly.

---

### FIX-2: BUG-RL-01 — Remove falsy-coerce in TRUSTED_PROXY_COUNT parsing
**File:** `apps/web/lib/security/rateLimit.ts`

**What to change:** Find the line that parses `TRUSTED_PROXY_COUNT`, which currently reads:
```
Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10) || 1)
```
Change to:
```
Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10))
```
Remove the trailing `|| 1`. Zero is a valid value meaning "trust no proxies — use the direct connection IP".

**Why safe:** The `|| 1` was a misguided null-safety guard. `parseInt("0", 10)` returns `0`, not `NaN`. `Math.max(0, 0)` = 0, which is the correct and intentional behavior for `TRUSTED_PROXY_COUNT=0`. No callers depend on `trustedProxyCount` being ≥ 1.

**Test:** Set `TRUSTED_PROXY_COUNT=0` in the test environment. Send a request with `X-Forwarded-For: 1.2.3.4`. Verify the rate limiter uses the actual socket IP, not the spoofed `1.2.3.4`.

---

### FIX-3: BUG-PAY-01 — Add FOR UPDATE to processTransferEvent payout read
**File:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**What to change:** In `processTransferEvent`, wrap the payout row read and any subsequent status update in a database transaction and change the SELECT to use `FOR UPDATE`:
```sql
SELECT ... FROM creator_payouts WHERE provider_reference = $1 FOR UPDATE
```
inside a `db.transaction(async (tx) => { ... })` block. All reads, status updates, and retry increments within the function should use the transaction client `tx` instead of `db`. This ensures the webhook handler and the CRON processor mutually exclude each other on the same payout row.

**Why safe:** The CRON processor already uses `FOR UPDATE SKIP LOCKED` to claim rows. Adding `FOR UPDATE` to the webhook path ensures only one of the two concurrent paths can hold the row lock at a time. The other will block and retry or skip, preventing double-processing.

**Test:** Simulate a concurrent `transfer.failed` webhook and a CRON batch processor run for the same payout row. Verify that only one retry_count increment occurs, not two.

---

### FIX-4: BUG-XP-DLQ-01 — Remove global db argument from safeAwardXP in referrals
**File:** `apps/web/lib/referrals/commissions.ts`

**What to change:** In `awardReferralCommissions`, find the call to `safeAwardXP` that passes `db` as the last argument:
```
await safeAwardXP(tier1Id, xpBonus, 'social', 'referral_first_purchase', referenceId, db);
```
Remove the trailing `db` argument entirely:
```
await safeAwardXP(tier1Id, xpBonus, 'social', 'referral_first_purchase', referenceId);
```
`safeAwardXP` will fall back to its internal global db reference when no client is provided, and `!dbClient` will correctly evaluate to `true`, enabling DLQ writes on failure.

**Why safe:** `awardReferralCommissions` is called after the main purchase transaction has committed. There is no enclosing transaction at this call site. Passing `db` (the global adapter) was incorrect — it is not a `TransactionClient` and should not be used as one. Removing the argument restores DLQ protection for all referral XP award failures.

**Test:** Force a DB error on the `xp_ledger` INSERT while a referral purchase is being processed. Verify a row appears in `failed_xp_awards` after the failure.

---

### FIX-5: BUG-MOB-01 — Fetch complete user profile after token refresh on mobile
**File:** `apps/expo/lib/api/client.ts`

**What to change:** In the `refreshAccessToken` function (the 401 response interceptor), after receiving the new tokens from the refresh endpoint, make an additional call to fetch the complete user profile (e.g. `GET /api/users/me`) and persist the full profile to SecureStore. The current code constructs a partial object from JWT payload fields only:
```
const updatedUser: AuthUser = {
  id: decoded.sub,
  username: decoded.username,
  ...
  // MISSING: plan, isAdmin, isModerator, isCreator, onboardingCompleted
};
```
Replace this with either:
- Fetching `/api/users/me` with the new access token and storing the response as the user object, OR
- Merging the partial JWT fields with the existing stored user object (using `mergeUser(existingUser, partialFromJWT)`) so existing fields survive the refresh.

**Why safe:** The `/api/users/me` endpoint is already called on app boot and on `signIn`. Adding a call there after token refresh aligns the mobile client's user state with the server's source of truth. If network fails, fall back to the existing stored user rather than the partial object.

**Test:** Sign in, perform token refresh (wait for token expiry or force a 401). After refresh, read `user.plan`, `user.isAdmin`, `user.isCreator` from the auth context. Verify they match the pre-refresh values.

---

### FIX-6: BUG-IDEM-01 — Move DM idempotency enforcement to the database layer
**File:** `apps/web/app/api/messages/dm/route.ts` + migration

**What to change (two parts):**

**Part A — Migration:** Add a unique partial index on the `messages` table:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_idempotency_key_uq
  ON messages (sender_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Part B — Route:** Change the message INSERT to use `ON CONFLICT`:
```sql
INSERT INTO messages (..., idempotency_key, ...)
VALUES (...)
ON CONFLICT (sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL
DO NOTHING
RETURNING id, sender_id, ...
```
If the `RETURNING` result is empty (conflict), fetch and return the existing message row. The pre-check SELECT can remain as a fast-path optimization but is no longer the correctness guard.

**Why safe:** The unique partial index enforces idempotency atomically at the DB level, eliminating the TOCTOU race. `WHERE idempotency_key IS NOT NULL` ensures rows without an idempotency key are unaffected.

**Test:** Fire two identical POST requests with the same `idempotencyKey` simultaneously. Verify only one message row exists in the database and the sender is charged once.

---

### FIX-7: BUG-XP-FIRE-01 — Await XP award or use waitUntil in gift send route
**File:** `apps/web/app/api/economy/gifts/send/route.ts`

**What to change:** The current fire-and-forget pattern:
```js
db.query<{ plan: Plan }>(...).then(...awardGiftXP).catch(logger.error);
return NextResponse.json({...});
```
Replace with either:
- **Option A (simpler):** `await` both the plan query and the XP award before returning the response. The latency increase is minimal (one DB read + `safeAwardXP` which is already doing a DB write).
- **Option B (if latency is a concern):** Use Next.js's `unstable_after()` (Next 15) or `waitUntil()` (available via Cloudflare Workers / Vercel Edge) to register the award as a background task that the runtime will complete after the response is sent.

**Why safe:** `safeAwardXP` is idempotent via the `referenceId` argument. Awaiting it adds one round-trip of latency but guarantees delivery. If it fails, the DLQ catches it.

**Test:** Deploy to a staging environment. Send a gift and immediately kill the serverless function (via timeout simulation). Verify the DLQ has a pending entry, meaning at minimum the attempt was registered.

---

### FIX-8: BUG-IDB-01 — Make PWA IndexedDB initialization retryable
**File:** `apps/web/lib/offline/messageQueue.ts`

**What to change:** Change `dbPromise` from a module-level eagerly-assigned constant to a lazy getter that clears itself on failure:
```js
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('zobia-offline', 1, { upgrade(db) { /* ... */ } })
      .catch((err) => {
        dbPromise = null; // clear cache so next call retries
        throw err;
      });
  }
  return dbPromise;
}
```
All queue functions that currently reference `dbPromise` should call `getDB()` instead. On any failure, `dbPromise` is reset to `null` so the next call retries the open.

**Why safe:** IDB open failures are transient in many cases (browser restarts, quota is freed, private browsing tab is closed). Retrying on the next queue operation is safe and correct. The DB schema upgrade logic runs only once per database version.

**Test:** Open the PWA in Firefox private browsing (which blocks IDB). Attempt to enqueue a message — it should fail. Close and reopen a normal tab. Attempt to enqueue again — it should succeed.

---

### FIX-9: BUG-IDB-02 — Make updateMessageStatus a single atomic IDB transaction
**File:** `apps/web/lib/offline/messageQueue.ts`

**What to change:** Rewrite `updateMessageStatus` to perform the get and put inside a single `readwrite` transaction:
```js
async function updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) { resolve(); return; }
      const updated = { ...req.result, status };
      store.put(updated);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```
No second `readwrite` transaction is opened. The get and put share the same transaction, so no concurrent call can read between them.

**Why safe:** IDB readwrite transactions are serialized by the browser. A second call to `updateMessageStatus` for the same object store will queue behind the first transaction.

**Test:** Call `updateMessageStatus(id, 'sending')` and `updateMessageStatus(id, 'failed')` concurrently. Verify the final status is the one from the last-started call, not a mix of both.

---

### FIX-10: BUG-SW-01 — Replace skipWaiting with user-prompted reload
**File:** `apps/web/public/sw.js`

**What to change:** Remove the unconditional `self.skipWaiting()` call. In its place, post a message to all controlled clients after the new SW activates so the UI can show a "New version available — reload to update" prompt:
```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
    })
  );
});
```
In the web app's root component, listen for `SW_UPDATED` messages and display a toast/banner. The `clientsClaim()` call can remain so fresh tabs get the new SW immediately on next open.

**Why safe:** Without `skipWaiting`, the new SW waits until all controlled tabs are closed (or the user clicks "reload"). This eliminates the version mismatch. The UX prompt gives users a graceful upgrade path.

**Test:** Load the app in two tabs. Deploy a new build. Verify neither tab auto-refreshes. Verify both show an "update available" prompt. After clicking reload, verify the new build is served.

---

### FIX-11: BUG-SW-02 — Change JS chunk caching strategy to CacheFirst
**File:** `apps/web/public/sw.js`

**What to change:** For the `/_next/static/chunks/**/*.js` route, change the Workbox strategy from `StaleWhileRevalidate` with `maxAgeSeconds: 86400` to `CacheFirst` with `maxAgeSeconds: 31536000` (1 year). Since Next.js content-hashes all chunk filenames (e.g. `_next/static/chunks/abc123.js`), a new deploy produces entirely new URLs. Old hashed URLs cached by the SW will never be stale — if the URL exists in cache, it is correct by definition. New URLs miss the cache and go to network.

**Why safe:** Content-addressed filenames are immutable. CacheFirst is the canonical strategy for immutable assets. This eliminates the 24-hour window of stale-chunk service while improving performance (zero network for cached chunks).

**Test:** Deploy a new build. Open the app in a tab with the old SW still active. Verify that navigating to a new route fetches new chunks from the network (cache miss), not the old cached chunks.

---

### FIX-12: BUG-SEASON-PHASE-01 — Fix final_day condition to use AND
**File:** `apps/web/lib/seasons/seasonEngine.ts`

**What to change:** In `getSeasonPhase`, change:
```js
if (ratio >= 0.95 || end - now <= 24 * 60 * 60 * 1000) return "final_day";
```
to:
```js
if (ratio >= 0.95 && end - now <= 24 * 60 * 60 * 1000) return "final_day";
```
This ensures `final_day` only fires when the season is simultaneously in its last 5% AND has fewer than 24 hours remaining — matching the spec comment "whichever is smaller."

**Why safe:** This is a pure logic change. It tightens the `final_day` window to its intended scope. Seasons shorter than 20 days are unaffected (for those, 5% < 24h, so the AND condition fires at the same time as before). Only long seasons (> 20 days) see the `final_day` window shrink.

**Test:** Create a 100-day test season. Verify `getSeasonPhase` returns `"push"` at 96 days elapsed (96% > 95% but > 24h remaining). Verify it returns `"final_day"` at 99 days 1 hour elapsed (> 95% AND < 24h).

---

### FIX-13: BUG-ANTISPAM-01 — Tighten phone regex to reduce false positives
**File:** `apps/web/lib/messaging/antispam.ts`

**What to change:** In `getPhoneRegex()`, tighten the pattern to require an internationally recognized phone indicator:
- Require either a leading `+` with country code OR a leading `0` (Nigerian local format) OR an area code in parentheses `(NNN)` before accepting the number as a phone candidate.
- Alternatively, raise the numeric digit threshold in `stripContactInfo` from `digits.length >= 7` to `digits.length >= 10` (minimum for any internationally valid phone number).

A safer approach is to add a pre-condition: the match must begin with `+`, `0`, or `(` to be considered a phone number, rather than any bare digit sequence. This preserves the existing logic for genuine phone numbers while excluding numeric content like "123 456 789".

**Why safe:** The filter is intentionally silent (no user notification). Making it more specific reduces false positives without creating a bypass for real phone numbers, which always have country codes or local `0` prefixes in Nigerian SMS.

**Test:** Run `getPhoneRegex()` against messages containing "score: 123 456 789", "match: 234-567-891", and "ref: 1234 5678 90" — none should match. Run against "+234 801 234 5678", "0801 234 5678", "+1 (555) 234-5678" — all should match.

---

### FIX-14: BUG-HOF-01 — Assign correct rank to Hall of Fame users with no snapshot
**File:** `apps/web/lib/leaderboards/engine.ts`

**What to change:** In the HoF injection block inside `getLeaderboard`, for users with no snapshot (`ls.xp_value` is NULL after the RIGHT JOIN), assign rank = `total + 1` and flag them with `is_hall_of_fame: true` so the frontend can render them in a visually distinct "Hall of Fame" pinned section separate from the ranked list — not mixed into the ranked list at the bottom. Alternatively, ensure HoF enrollment (`INSERT INTO hall_of_fame`) triggers `upsertLeaderboardSnapshot` with the user's current `xp_total`, so they always have a snapshot entry.

**Why safe:** The UI already receives `is_hall_of_fame: true` on the entry. A frontend pinned-section render makes the intent clear regardless of rank number. Server-side, injecting them with `rank: total + 1` is at least semantically honest rather than misleadingly placing them at the mathematical last position of the ranked list.

**Test:** Add a HoF entry for a user who has never earned XP on the main track. Fetch the global main leaderboard page 1. Verify the HoF user appears in the result with `is_hall_of_fame: true` and a rank that does not collide with ranked users.

---

### FIX-15: BUG-LOG-01 — Replace console with structured logger in trustScore.ts
**File:** `apps/web/lib/trust/trustScore.ts`

**What to change:** Add `import { logger } from "@/lib/logger";` at the top of the file. Replace:
```js
console.info(`[trustScore] Updated for user ${userId} ...`);
console.error(`[trustScore] Failed to update for user ${userId} ...`);
```
with:
```js
logger.info({ userId, event, score: newScore }, '[trustScore] Updated');
logger.error({ userId, event, err }, '[trustScore] Failed to update');
```
passing a structured context object as the first argument as is standard for the project's logger.

**Why safe:** Pure logging change. No functional behavior changes. The structured format makes trust score events queryable in log aggregation tools.

**Test:** Trigger a trust score update and a trust score failure (mock DB error). Verify structured JSON log entries appear with `userId`, `event`, and severity fields rather than bare strings.

---

## Migration Checklist

The following schema change must accompany the code fix above:

- [ ] **FIX-6 migration:** Add `CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_idempotency_key_uq ON messages (sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL;` to a new migration file (e.g. `0021_dm_idempotency_constraint.sql`).

---

## Deployment Order

Deploy fixes in this order to minimize production risk:

1. FIX-2 (RL-01) — Security; zero risk; deploy immediately
2. FIX-15 (LOG-01) — Logging; zero risk
3. FIX-4 (XP-DLQ-01) — One-line removal; zero risk
4. FIX-12 (SEASON-PHASE-01) — Logic correction; low risk
5. FIX-1 (DM-01) — Financial; test in staging first; deploy with monitoring on creator_earnings
6. FIX-7 (XP-FIRE-01) — Await XP award; adds ~5ms to gift latency; low risk
7. FIX-10 + FIX-11 (SW-01 + SW-02) — Service worker; test in staging; clear cache after deploy
8. FIX-13 (ANTISPAM-01) — Regex change; test with corpus before deploying
9. FIX-3 (PAY-01) — Needs staging test with Paystack sandbox; deploy after verification
10. FIX-6 (IDEM-01) — Requires DB migration; test migration on staging first; deploy migration then code atomically
11. FIX-5 (MOB-01) — Mobile app update; submit to Play Store after testing
12. FIX-8 + FIX-9 (IDB-01 + IDB-02) — PWA offline queue; test across Chrome/Firefox/Safari
13. FIX-14 (HOF-01) — Low urgency; coordinate with frontend for pinned-section UI

---

*Fix plan generated: June 21, 2026, 12:00 PM*
