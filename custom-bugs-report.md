# Zobia Codebase Bug Report
**Date:** June 21, 2026  **Time:** 12:00 PM

---

## Summary

Forensic analysis of the Zobia codebase — web app (Next.js 14 App Router), PWA (Workbox service worker, IndexedDB offline queue), and Expo Android app. All critical library files, API route handlers, economy engine, auth layers, realtime hooks, offline queues, leaderboard engine, games system, and mobile layouts were examined.

---

## One-Line Bug Index

1. BUG-DM-01: handleDMGift in dm/route.ts writes virtual coin values into real-money kobo financial columns, corrupting creator payout accounting
2. BUG-RL-01: rateLimit.ts TRUSTED_PROXY_COUNT=0 is falsy-coerced to 1, allowing IP spoofing to bypass rate limiting
3. BUG-PAY-01: paystackWebhookHandler.ts processTransferEvent reads the payout row without FOR UPDATE, creating a race condition with the CRON batch processor
4. BUG-XP-DLQ-01: referrals/commissions.ts passes global db adapter to safeAwardXP as dbClient, which causes the DLQ guard to evaluate to false and silently drop XP award failures
5. BUG-MOB-01: expo/api/client.ts refreshAccessToken builds an incomplete updatedUser object missing plan, isAdmin, isModerator, isCreator, and onboardingCompleted fields
6. BUG-IDEM-01: dm/route.ts DM idempotency key is checked with a plain SELECT outside any transaction, allowing two concurrent identical requests to both pass and insert duplicate messages
7. BUG-XP-FIRE-01: gifts/send/route.ts XP plan-query + award chain is a fire-and-forget promise that may be garbage-collected before resolving when the serverless function returns
8. BUG-IDB-01: messageQueue.ts (PWA) module-level dbPromise is cached permanently if the IndexedDB open fails, permanently breaking the offline queue with no retry path
9. BUG-IDB-02: messageQueue.ts (PWA) updateMessageStatus performs a non-atomic get-then-put on IndexedDB — concurrent calls can silently overwrite each other with stale state
10. BUG-SW-01: sw.js self.skipWaiting() causes the new service worker to immediately claim all open tabs, creating a version mismatch between the new SW and old page JS
11. BUG-SW-02: sw.js JS chunk StaleWhileRevalidate strategy with maxAgeSeconds:86400 leaves users on stale JS bundles for up to 24 hours after a deploy
12. BUG-SEASON-PHASE-01: seasonEngine.ts getSeasonPhase uses logical OR (||) where the spec says "whichever is smaller", making the final_day window larger than intended for long seasons
13. BUG-ANTISPAM-01: antispam.ts phone regex matches any nine-plus-digit sequence in three separated groups, causing false positives on legitimate numeric content like scores, reference IDs, and prices
14. BUG-HOF-01: leaderboards/engine.ts Hall of Fame users with no leaderboard_snapshots row are computed at rank = total+1 (bottom of list) and injected there instead of being pinned
15. BUG-LOG-01: trustScore.ts uses console.info/console.error instead of the project's structured logger module, making trust score events invisible in the structured log pipeline

---

## Detailed Bug Descriptions

---

### 1. BUG-DM-01 — handleDMGift stores coin values in real-money kobo columns
**FILES:** `apps/web/app/api/messages/dm/route.ts` (lines ~207–217)

`handleDMGift` inserts `giftItem.coin_cost`, `platformFee`, and `recipientCoins` (all virtual-coin integers, e.g. 50, 10, 40) directly into `creator_earnings.gross_amount_kobo`, `platform_fee_kobo`, and `net_amount_kobo`. It also adds `recipientCoins` to `users.available_earnings_kobo`. These are real-money columns denominated in Nigerian kobo; inserting a coin value of 100 records ₦1.00 when the actual fiat equivalent may be far higher. The sister endpoint `gifts/send/route.ts` explicitly avoids this insertion and comments why (line ~299–303): "Gifts are virtual-coin denominated, not fiat (kobo). We do NOT insert into creator_earnings here because those columns are real-money (kobo) fields and mixing coin values there would corrupt payout accounting." The DM gift path missed this guard, silently corrupting every creator payout balance derived from DM gifts.

**FIX:** Remove the `creator_earnings` INSERT and `available_earnings_kobo` UPDATE from `handleDMGift` entirely. If gift-to-fiat conversion is required, apply an explicit coin→kobo conversion rate at withdrawal time (as the gifts/send route recommends), not at gift-receipt time. The coin_ledger entry is the canonical record.

---

### 2. BUG-RL-01 — TRUSTED_PROXY_COUNT=0 silently treated as 1
**FILES:** `apps/web/lib/security/rateLimit.ts` (proxy count parsing line)

The trusted proxy count is parsed as:
```
Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10) || 1)
```
The `|| 1` short-circuit means any falsy result of `parseInt` (including the integer `0`) is replaced with `1`. An operator who sets `TRUSTED_PROXY_COUNT=0` to indicate "no trusted proxy, use direct IP" gets one trusted proxy instead. The consequence is that the leftmost IP in the `X-Forwarded-For` header is unconditionally trusted and used as the client IP, allowing any attacker to spoof their IP by prepending an arbitrary address to `X-Forwarded-For` and bypass per-IP rate limiting entirely.

**FIX:** Change to `Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10))` removing the `|| 1` fallback. Zero is a valid and meaningful value.

---

### 3. BUG-PAY-01 — processTransferEvent reads payout row without FOR UPDATE
**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts` (`processTransferEvent` function)

When Paystack fires a `transfer.failed` webhook, `processTransferEvent` reads the payout row with a plain `SELECT` (no `FOR UPDATE`). The CRON batch processor (`processPendingPayouts`) claims rows using `FOR UPDATE SKIP LOCKED`. If both execute concurrently, the webhook handler and the CRON can both read the same payout row simultaneously before either locks it. Both then attempt to increment `retry_count` or transition status, leading to double retry-count increments and potentially two simultaneous Paystack transfer initiation calls for the same payout.

**FIX:** Wrap the `processTransferEvent` payout read and status update in a transaction using `FOR UPDATE` on the payout row, consistent with how the CRON processor claims rows. This ensures mutual exclusion.

---

### 4. BUG-XP-DLQ-01 — safeAwardXP DLQ bypass when called with global db adapter
**FILES:** `apps/web/lib/referrals/commissions.ts` (line ~103), `apps/web/lib/xp/safeAwardXP.ts` (catch block, line ~145)

`awardReferralCommissions` calls `safeAwardXP(tier1Id, xpBonus, 'social', 'referral_first_purchase', referenceId, db)` passing the database adapter as the `dbClient` argument. `safeAwardXP`'s DLQ guard is `if (!dbClient)` — since `db` is a truthy object, the guard evaluates to `false` and the failed-award write to `failed_xp_awards` is skipped. Any XP award failure on the referral path is permanently and silently dropped. This defeats the entire purpose of the dead-letter queue for this call site.

**FIX:** Do not pass `db` (the global adapter) as `dbClient` to `safeAwardXP` when calling outside a transaction. Either omit the argument entirely (falls back to the internal global db with DLQ enabled) or change the DLQ guard to `if (!(dbClient instanceof TransactionClient))` to distinguish a transaction client from the global adapter.

---

### 5. BUG-MOB-01 — refreshAccessToken stores incomplete user object on mobile
**FILES:** `apps/expo/lib/api/client.ts` (`refreshAccessToken` function)

After a silent token refresh in the 401 response interceptor, the code constructs `updatedUser` from the decoded JWT payload and stores it in SecureStore. The object only populates `id`, `username`, `avatarEmoji`, `city`, `xp`, and `rankTier`. It omits `plan`, `isAdmin`, `isModerator`, `isCreator`, and `onboardingCompleted`. The `AuthUser` interface requires all of these. After the first token rotation, every screen that reads `user.plan` or `user.isAdmin` receives `undefined`, causing feature gates, plan-gated UI, and admin panels to behave as if the user has no plan and no elevated privileges, until the user kills and relaunches the app (which triggers a full profile fetch).

**FIX:** After a successful refresh, fetch the full user profile from `/api/users/me` (or include the missing fields in the JWT claims) and persist the complete user object to SecureStore, merging with the existing object rather than constructing a partial one from JWT claims alone.

---

### 6. BUG-IDEM-01 — DM idempotency key check outside transaction allows duplicate messages
**FILES:** `apps/web/app/api/messages/dm/route.ts` (GET idempotency check, step 8, ~line 465)

The idempotency check reads `SELECT id FROM messages WHERE sender_id = $1 AND idempotency_key = $2` outside any transaction, then the message INSERT happens inside a separate transaction without an `ON CONFLICT (sender_id, idempotency_key) DO NOTHING` clause and without a unique database constraint on that pair. Two concurrent requests with the same `idempotencyKey` both see no duplicate on the pre-check SELECT, both enter the transaction, and both INSERT — creating two message records and charging the sender's coin balance twice. The check is a best-effort guard, not an atomic one.

**FIX:** Add a unique database-level constraint or unique partial index on `(sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL` in the messages table migration, and add `ON CONFLICT (sender_id, idempotency_key) DO NOTHING RETURNING id` to the INSERT so the database enforces idempotency atomically.

---

### 7. BUG-XP-FIRE-01 — Gift XP award chain is fire-and-forget without serverless completion guarantee
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts` (lines ~441–447)

The XP award for gift sends is initiated as an unawaitedpromise chain:
```
db.query<...>(...).then(({ rows }) => { return awardGiftXP(...); }).catch(logger.error)
return NextResponse.json({...});
```
The response is returned to the client before the XP plan query or `awardGiftXP` resolves. In a serverless edge environment (Vercel), the function invocation terminates after the response is sent. Any pending microtasks/promises not captured by `waitUntil` are silently killed. The entire XP award (sender Generosity XP + recipient Social XP + first-time-gift XP + tipped-in-room XP) may be dropped with no DLQ fallback because `safeAwardXP` is never even called.

**FIX:** Either `await` the plan SELECT and the full `awardGiftXP` call before returning the response, or use `context.waitUntil(promise)` (or the equivalent Next.js `after()` API) to register the background task with the runtime so it survives function return.

---

### 8. BUG-IDB-01 — PWA offline queue broken permanently if IndexedDB fails to open
**FILES:** `apps/web/lib/offline/messageQueue.ts` (module-level `dbPromise` initialization)

`dbPromise` is assigned once at module load by calling `openDB(...)`. If the IndexedDB open call rejects (private browsing mode in some browsers, storage quota exceeded, browser restriction, corrupt IDB state), the rejected promise is stored permanently in the module-level `dbPromise` variable. Every subsequent call to any queue function (`enqueueMessage`, `getPendingMessages`, etc.) awaits the same cached rejected promise and immediately throws. There is no retry mechanism, no reset path, and no way to recover without a full page reload. The offline queue is broken for the entire session.

**FIX:** Lazily initialize `dbPromise` inside a wrapper function that clears the cached promise on rejection, allowing retry on the next call. Alternatively, wrap the initialization in a retry loop with exponential backoff and expose a `resetOfflineQueue()` function that sets `dbPromise = null` so callers can trigger re-initialization.

---

### 9. BUG-IDB-02 — updateMessageStatus non-atomic IndexedDB get-then-put allows stale overwrites
**FILES:** `apps/web/lib/offline/messageQueue.ts` (`updateMessageStatus` function)

`updateMessageStatus` fetches the existing record from IndexedDB using a `readonly` transaction, then opens a second `readwrite` transaction to put the updated record. Between the two operations, another concurrent call to `updateMessageStatus` can execute its own get-then-put sequence. The second call's `get` reads the record before the first call's `put` commits, and the second call's `put` then overwrites with a stale base record that lost the first call's changes. The result is a lost update — for example, a `status: "sent"` update can be silently overwritten back to `status: "failed"` by a concurrent status change.

**FIX:** Perform the get and put within the same `readwrite` transaction using a cursor or `objectStore.get()` followed immediately by `objectStore.put()` inside the same transaction scope.

---

### 10. BUG-SW-01 — skipWaiting() forces immediate SW takeover causing tab version mismatch
**FILES:** `apps/web/public/sw.js` (`self.skipWaiting()` + `clientsClaim()`)

`self.skipWaiting()` causes the new service worker to activate and take control of all open tabs immediately on install, skipping the normal "wait until all tabs are closed" lifecycle. Any open tab that was loaded from the previous build now has the new service worker serving requests, but its in-memory JavaScript (already parsed and executing) still references the old build's chunk names and hashes. Attempts to dynamically import a route chunk that existed in the old build but was renamed or removed in the new build throw `ChunkLoadError`, breaking navigation.

**FIX:** Remove `self.skipWaiting()` and let the SW follow the normal lifecycle (activate only after all controlled tabs close), OR keep it but add a `CLIENTS.matchAll({ type: 'window' }).then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))` post-activate message so the UI can prompt users to reload, preventing stale-chunk access.

---

### 11. BUG-SW-02 — JS chunk StaleWhileRevalidate with 24-hour max-age stale after deploy
**FILES:** `apps/web/public/sw.js` (static JS chunk caching strategy)

The service worker caches `/_next/static/chunks/**/*.js` with a `StaleWhileRevalidate` strategy and `maxAgeSeconds: 86400` (24 hours). After a deployment, the new server responds with updated HTML referencing new chunk filenames/hashes, but the service worker continues serving the cached previous-build JS for up to 24 hours. This creates a split-brain state: server-rendered HTML (or new API responses) from the new build, combined with client-side code from the old build, causing hydration mismatches and broken client-side navigation.

**FIX:** Since Next.js content-hashes all static chunk filenames, a `CacheFirst` strategy with a very long max-age is correct (new deploys produce new URLs). Alternatively, use `NetworkFirst` with a very short max-age to ensure fresh chunks after deploy. The current `StaleWhileRevalidate` + 1-day TTL is the worst of both worlds.

---

### 12. BUG-SEASON-PHASE-01 — getSeasonPhase final_day window uses OR where spec says "whichever is smaller"
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`getSeasonPhase` function, line ~100)

The code is:
```
if (ratio >= 0.95 || end - now <= 24 * 60 * 60 * 1000) return "final_day";
```
The inline comment reads "Last 5% (or last 24 hours, whichever is smaller)". With `||`, `final_day` begins when EITHER condition is first satisfied — whichever comes sooner (larger window). For a 100-day season, 5% = 5 days; the `||` means `final_day` starts 5 days early. With AND (`&&`), `final_day` would only begin when both conditions are true simultaneously — the last 24 hours of the last 5%, which is the "smaller" window the comment describes. For most seasons under 20 days, the 24-hour condition is the binding one; for long seasons the discrepancy is significant.

**FIX:** Change `||` to `&&`:
```
if (ratio >= 0.95 && end - now <= 24 * 60 * 60 * 1000) return "final_day";
```
Or if the intent is truly "whichever is larger (earlier onset)", update the comment to avoid confusion.

---

### 13. BUG-ANTISPAM-01 — Phone regex false positives on legitimate numeric content
**FILES:** `apps/web/lib/messaging/antispam.ts` (`getPhoneRegex` function, line ~41)

The regex pattern `\b(?:\+?\d{1,3}[\s\-.])?(?:\(?\d{1,4}\)?[\s\-.]?)?\d{3,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b` matches any three groups of 3–4 digits separated by a single space, dash, or dot. With the `digits.length >= 7` guard in `stripContactInfo`, any sequence of 9+ consecutive digits in three groups is treated as a phone number and stripped. Legitimate content containing reference numbers, game scores, inventory counts, or addresses (e.g. "Match ID: 123-456-7890", "Score: 234 567 891") gets silently removed from messages without any indication to the sender.

**FIX:** Tighten the regex by requiring at least one internationally recognized phone prefix pattern (country code `+` or a leading `0` for local Nigerian format) before treating a digit sequence as a phone number. At minimum, increase the minimum digit threshold from 7 to 10 within `stripContactInfo` to reduce false positives, and consider requiring a leading `+` or `0` for any match without a `(` area-code indicator.

---

### 14. BUG-HOF-01 — Hall of Fame users with no snapshot injected at bottom rank
**FILES:** `apps/web/lib/leaderboards/engine.ts` (`getLeaderboard` function, ~line 310–332)

When injecting Hall of Fame users not already in the current result page, the code RIGHT JOINs `leaderboard_snapshots` to get each HoF user's XP value, then computes rank as `COUNT(*) + 1` of users with higher XP. For a HoF user with no snapshot entry (they joined Hall of Fame but haven't earned any XP on the main track), `COALESCE(ls.xp_value, 0)` = 0, and their rank becomes the total count of all users with XP > 0 — placing them at the very bottom of the leaderboard rather than pinned to the top as PRD §9 intends.

**FIX:** For HoF users lacking a snapshot, assign rank = 1 (or a pinned slot), or ensure HoF enrollment triggers an initial snapshot upsert with the user's current `xp_total`. The display should visually distinguish HoF-pinned entries from rank-earned entries regardless.

---

### 15. BUG-LOG-01 — trustScore.ts uses console instead of structured logger
**FILES:** `apps/web/lib/trust/trustScore.ts` (`updateTrustScore` function, lines ~324–333)

`updateTrustScore` logs via `console.info(...)` and `console.error(...)`. Every other production module in the codebase uses the `logger` from `@/lib/logger` for structured JSON output (with request context, timestamps, severity levels). Trust score update events and failures are invisible to any structured log aggregation system (Datadog, Logtail, etc.) that ingests structured log output, making trust score anomalies undetectable in production.

**FIX:** Import `logger` from `@/lib/logger` and replace `console.info` with `logger.info` and `console.error` with `logger.error`, passing the relevant context object (userId, event, score) as the first argument.

---

## Code Quality Rating

### Current: 7.0 / 10

The codebase has strong foundational patterns: append-only coin ledger with idempotency, `SELECT FOR UPDATE` for concurrency control, a dead-letter queue for failed XP awards, atomic Lua rate-limiting scripts, kid-based JWT rotation, constant-time CSRF comparison, Zod schema validation at all boundaries, and careful separation of transaction-scoped vs. fire-and-forget work. Architecture decisions are thoughtful overall.

The score is held back by: one critical financial integrity bug (coin/kobo mixing) that corrupts creator payout accounting on every DM gift; a security bypass in IP-based rate limiting; PWA offline reliability issues that permanently fail on first error; and an auth state gap on mobile that breaks plan-gated features post-refresh.

### Predicted After All Fixes: 8.5 / 10

Addressing the 15 bugs above would close all identified critical and high-severity gaps. The architecture is sound — these are implementation gaps rather than design flaws. Post-fix the codebase would exhibit strong financial integrity guarantees, correct rate-limit security, reliable PWA offline behavior, and consistent auth state across token rotations. The remaining ceiling to 10/10 would be reached through deeper automated test coverage, formal load testing of the concurrency-sensitive paths, and schema-level enforcement of idempotency constraints.

---

*Report generated: June 21, 2026, 12:00 PM*
