# Zobia Codebase — Bug Report

**Generated:** June 14, 2026, 12:00 PM UTC  
**Scope:** Full forensic analysis — `apps/web` (Next.js 14 App Router), `apps/expo` (Expo Android), `apps/web/public/sw.js` (PWA Service Worker)  
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## Quick Index

1. BUG-SW01 — Service Worker: 24h API cache TTL serves stale financial/social data
2. BUG-WH01 — Paystack webhook: wrong column names in `system_alerts` INSERT
3. BUG-WH02 — DodoPayments webhook: `star_pack` missing zero-amount guard
4. BUG-EC01 — `transferCoins` hardcodes `gift_sent`/`gift_received` for all transfers
5. BUG-QS01 — `generateDailyDeck`: `pro` plan users cannot see `plus`-tier quests
6. BUG-LB01 — `calculateWeightedScore`: XP normalized to 10k max, caps every active user
7. BUG-PY01 — `reconcileStuckPayouts`: missing `FOR UPDATE SKIP LOCKED`
8. BUG-GW01 — `findWarOpponent`: TOCTOU race — two guilds can select same opponent
9. BUG-DM01 — `dm_conversations` upsert: `::text` UUID cast breaks UNIQUE ordering
10. BUG-LB02 — Hall of Fame users get wrong sequential rank numbers
11. BUG-RM01 — Room message GET: does not filter `is_pending_approval` messages
12. BUG-EC02 — `awardGiftXP`: `first_time_gifted` race condition awards bonus twice
13. BUG-SS01 — `claimPassMilestone`: `xp_bonus` UPDATE missing `updated_at = NOW()`
14. BUG-NE01 — `compareNemesisProgress`: fragile UUID array string interpolation
15. BUG-MD01 — Profanity wordlist never invalidated at runtime after admin updates
16. BUG-MD02 — `detectDuplicateMessage`: ASCII-only normalization, Unicode bypass
17. BUG-AU01 — Telegram OAuth mobile poll: no refresh token stored, users silently logged out
18. BUG-RF01 — Referral qualifying XP: missing `xp_social` track column update
19. BUG-FD01 — `checkNewAccountGiftInflow`: INTERVAL built via SQL string concatenation
20. BUG-GE01 — `geoAnomaly`: /8 prefix comparison too coarse for meaningful anomaly detection
21. BUG-SE01 — `fieldEncryption`: no key versioning, KYC_ENCRYPTION_KEY rotation is destructive
22. BUG-AU02 — TOTP anti-replay: code consumed but session not issued when `createSession` fails

---

## Detailed Bug Reports

---

### 1: BUG-SW01 — Service Worker: 24-hour cache TTL serves stale coin balances, notifications, and user profile data

The Workbox NetworkFirst strategy applied to ALL API GET routes uses `maxAgeSeconds: 86400` (24 hours) and `maxEntries: 16`. This means a coin balance, notification list, or user profile loaded up to 24 hours ago can be served from the cache while the user believes they are seeing live data. Financial endpoints (wallet balance, star balance), social endpoints (unread counts, notification list, DM inbox), and profile data are all subject to this cache. The NetworkFirst strategy does attempt the network first, but falls back to the stale cache on any network error or timeout (10 second timeout), which is frequently triggered on mobile connections.

FILES:
- `apps/web/public/sw.js`

FIX:
Apply `NetworkOnly` to financially sensitive endpoints: `/api/economy/coins/balance`, `/api/economy/stars/balance`, `/api/notifications`, `/api/messages/dm`. Apply `StaleWhileRevalidate` with `maxAgeSeconds: 30` for general profile and social routes. Reserve `NetworkFirst` with a shorter TTL (60–300 seconds) for lower-priority read endpoints. Add explicit route-level overrides in the Workbox config before the catch-all API rule.

---

### 2: BUG-WH01 — Paystack webhook error handler inserts into `system_alerts` with wrong column name and missing column

The error handler block in the Paystack webhook route (around line 601 of the file) attempts to log unhandled exceptions to `system_alerts` using `alert_type` as the column name. The actual `system_alerts` schema uses `type` as the column name. Additionally, the INSERT is missing the required `severity` column. As a result, every exception in the Paystack webhook handler silently fails to log to `system_alerts`, meaning critical payment errors (failed charge processing, transfer webhook errors) are invisible to admins.

FILES:
- `apps/web/app/api/economy/webhooks/paystack/route.ts`

FIX:
Change the INSERT column `alert_type` to `type` and add the `severity` column (e.g., `'critical'`). Audit all other `system_alerts` INSERT statements across the codebase to ensure they all use the correct schema column names. Consider adding a TypeScript type for the `system_alerts` row to catch this at compile time.

---

### 3: BUG-WH02 — DodoPayments webhook: `star_pack` item type lacks zero-amount guard

The DodoPayments webhook handler processes two item types: `coin_pack` and `star_pack`. The `coin_pack` handler has an explicit guard (`if (coinAmount <= 0) throw new Error(...)`) to reject zero-value grants. The `star_pack` handler is missing this identical guard. A DodoPayments webhook for a `star_pack` with a metadata value of 0 (due to misconfiguration or tampering) would result in a silent no-op instead of an error, making the bug invisible in logs.

FILES:
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

FIX:
Add `if (starAmount <= 0) throw new Error('star_pack metadata contains zero or negative star amount')` to the `star_pack` handler, immediately after parsing the metadata, matching the pattern used by the `coin_pack` handler.

---

### 4: BUG-EC01 — `transferCoins` hardcodes `gift_sent`/`gift_received` as transaction types for all coin transfers

The `transferCoins` function in the coin economy library always records ledger entries with the transaction types `gift_sent` and `gift_received`, regardless of the actual reason for the transfer (war treasury distributions, season rewards, payout reconciliation credits, etc.). This means the `coin_ledger` table misclassifies all non-gift transfers, making transaction history inaccurate, analytics misleading, and audit trails unreliable.

FILES:
- `apps/web/lib/economy/coins.ts`

FIX:
Add `senderTransactionType: string` and `recipientTransactionType: string` parameters to `transferCoins`. Update all callers to pass the appropriate types (e.g., `'war_transfer'`, `'treasury_distribution'`). Gift-specific callers continue passing `'gift_sent'`/`'gift_received'`. The coin ledger `transaction_type` column will then accurately reflect the business operation.

---

### 5: BUG-QS01 — `generateDailyDeck` plan filter: `pro` users cannot see `plus`-tier quests

The quest template selection SQL uses `plan_required = $2 OR $2 = 'max'` to filter quests by plan. This treats plans as exactly equal rather than hierarchical. A `pro` user (`$2 = 'pro'`) can only see `NULL`-tier and `pro`-tier quests. They cannot see `plus`-tier quests, even though `pro` is a higher plan than `plus`. Only `max` users receive the full cascade via the `$2 = 'max'` exception. This means `pro` users receive fewer eligible quests than intended, reducing their daily deck quality.

FILES:
- `apps/web/lib/quests/questEngine.ts`

FIX:
Replace the plan equality check with an explicit tier hierarchy condition:
`plan_required IS NULL OR plan_required = 'free' OR (plan_required = 'plus' AND $2 IN ('plus','pro','max')) OR (plan_required = 'pro' AND $2 IN ('pro','max')) OR (plan_required = 'max' AND $2 = 'max')`. Alternatively, store plan tiers as integers in the DB and compare with `<=`.

---

### 6: BUG-LB01 — `calculateWeightedScore` normalizes XP against 10,000 — virtually all active users hit the 100-point cap immediately

The `calculateWeightedScore` function normalizes XP with `Math.min((xpTotal / 10000) * 100, 100)`, treating 10,000 XP as the maximum. According to the XP rank thresholds in the codebase, 10,000 XP corresponds to the "Hustler" rank — a threshold reached quickly by most active users. Any user above "Hustler" level gets a normalized XP score of exactly 100, making XP (which is weighted 40% of the composite score) completely indistinguishable among the vast majority of the platform's engaged users. This effectively removes differentiation from the weighted leaderboard's most heavily weighted signal.

FILES:
- `apps/web/lib/leaderboards/engine.ts`

FIX:
Change the normalization denominator to a value that provides useful spread across the active user base — for example, 100,000 XP ("Champion" rank) or make it configurable via the manifest/config system. The denominator should be set to a value above which only a small fraction of users (the true top performers) reach the cap.

---

### 7: BUG-PY01 — `reconcileStuckPayouts` outer SELECT lacks `FOR UPDATE SKIP LOCKED`, allowing concurrent reconciliation to double-process payouts

The Phase 1 batch processor correctly uses `FOR UPDATE SKIP LOCKED` inside a CTE to prevent concurrent CRON runs from picking the same pending payouts. However, `reconcileStuckPayouts` (which handles payouts stuck in `processing` status) performs its outer SELECT without any locking, then processes each row individually. Two concurrent reconciliation jobs can both read the same set of stuck payouts and both attempt to re-transfer them, potentially initiating duplicate bank transfers.

FILES:
- `apps/web/lib/payments/payouts.ts`

FIX:
Apply the same pattern as Phase 1: move the stuck-payout SELECT into a CTE with `FOR UPDATE SKIP LOCKED`, and wrap the status transition (`SET status = 'retrying'`) in the same atomic statement. This ensures each stuck payout is claimed by at most one reconciliation job.

---

### 8: BUG-GW01 — `findWarOpponent` TOCTOU race: two guilds can simultaneously select the same opponent guild

`findWarOpponent` fetches busy guilds in one query, then selects candidates in a second query, then filters in application memory. When two guilds declare war concurrently, both queries run before either writes the new war row. Both see the same candidate pool, both select the same top candidate, and both create wars against the same opponent guild simultaneously — violating the invariant that a guild can only be in one active war.

FILES:
- `apps/web/lib/guilds/warEngine.ts`

FIX:
Use a Redis distributed lock (`SET NX EX 30`) keyed on the opponent's guild ID before committing the war declaration. If the lock cannot be acquired, retry with the next candidate. Alternatively, wrap the opponent selection and war INSERT in a single DB transaction using `FOR UPDATE SKIP LOCKED` on the opponent's guild row, and rely on a UNIQUE partial index on `guild_wars (defender_guild_id) WHERE status IN ('active', 'final_hour')` to reject duplicate wars at the DB level.

---

### 9: BUG-DM01 — `dm_conversations` upsert uses `LEAST($1::text, $2::text)` — UUID-to-text cast breaks the uniqueness ordering

The `dm_conversations` table is designed so `user_id_1 < user_id_2` for any given conversation (enforced by a UNIQUE constraint on the pair). The upsert uses `LEAST($1::text, $2::text)` and `GREATEST($1::text, $2::text)` where `$1` and `$2` are UUID values. PostgreSQL's text sort order for UUIDs is different from UUID type sort order (text sorts lexicographically by character, UUID sorts by byte value). The same pair of UUIDs may produce different `(user_id_1, user_id_2)` orderings depending on whether the comparison happens as text or as UUID, potentially causing the `ON CONFLICT` clause to miss existing rows and insert duplicates.

FILES:
- `apps/web/app/api/messages/dm/route.ts`
- `apps/web/app/api/economy/gifts/send/route.ts`

FIX:
Cast both parameters to the `uuid` type before comparison: `LEAST($1::uuid, $2::uuid)` and `GREATEST($1::uuid, $2::uuid)`. Ensure the `dm_conversations` UNIQUE constraint is defined on `uuid`-typed columns. Audit the entire codebase for other `LEAST`/`GREATEST` patterns on UUID columns.

---

### 10: BUG-LB02 — Hall of Fame users pinned to the leaderboard receive sequential slot numbers instead of their real rank

When the `getLeaderboard` function injects Hall of Fame users not already present in the page results, it assigns `rank: entries.length + 1` to each successive pinned user. If the page has 100 results (full page), a Hall of Fame user could be listed as rank #101, #102, etc., even if their actual XP-based rank is #3. This produces a misleading display where the most prestigious users on the platform appear with incorrect rank numbers.

FILES:
- `apps/web/lib/leaderboards/engine.ts`

FIX:
For each injected Hall of Fame user, compute their actual rank using `getUserRank(hof.user_id, 'main', 'global', db)` before pushing to the entries array, then set `rank: actualRank`. Alternatively, order the HoF fetch by XP descending and derive rank from a `ROW_NUMBER()` subquery over the global leaderboard snapshot.

---

### 11: BUG-RM01 — Room message GET handler does not filter out messages pending moderation approval

The POST handler for room messages creates messages with `is_pending_approval = true` when the room requires creator approval. However, the GET handler (which populates the message feed) does not include a `WHERE is_pending_approval = FALSE` clause. As a result, messages awaiting creator moderation approval are immediately visible to all room participants, defeating the purpose of the approval queue entirely.

FILES:
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

FIX:
Add `AND (rm.is_pending_approval = FALSE OR rm.is_pending_approval IS NULL)` to the WHERE clause of the GET query. Ensure that the approval-queue management endpoint (admin/creator approve/reject) updates `is_pending_approval` to `FALSE` on approval and deletes or marks rejected messages accordingly.

---

### 12: BUG-EC02 — `awardGiftXP` first_time_gifted bonus can be awarded multiple times under concurrent gifts

The `first_time_gifted` XP check queries `COUNT(*) FROM gifts WHERE recipient_id = $1` inside the XP transaction. Because `awardGiftXP` is called after the gift INSERT (outside the main gift transaction), concurrent gift sends to the same recipient can each see a `count <= 1` before either XP transaction completes, and both award the one-time 15 XP bonus. The recipient ends up with double (or more) first-time XP.

FILES:
- `apps/web/app/api/economy/gifts/send/route.ts`

FIX:
Move the `first_time_gifted` XP award into the main gift transaction (before it commits). Use an `INSERT INTO first_time_gifted_users (recipient_id) ON CONFLICT DO NOTHING RETURNING recipient_id` gate, or add a boolean flag column `first_gift_received_xp_awarded` on the `users` table with `UPDATE ... SET first_gift_received_xp_awarded = true WHERE id = $1 AND first_gift_received_xp_awarded IS NOT TRUE RETURNING id` — the `RETURNING` clause confirms the award actually ran.

---

### 13: BUG-SS01 — `claimPassMilestone` `xp_bonus` reward UPDATE missing `updated_at = NOW()`

In the `xp_bonus` reward branch of `claimPassMilestone`, the UPDATE that increments the user's XP is:
`UPDATE users SET xp_total = xp_total + $1 WHERE id = $2`
This omits `updated_at = NOW()`. Every other `UPDATE users` statement in the codebase includes this column. The missing timestamp means the user row's `updated_at` remains stale after a season pass XP bonus is applied, which can cause cache invalidation failures and incorrect "last active" tracking.

FILES:
- `apps/web/lib/seasons/seasonEngine.ts`

FIX:
Change the UPDATE to `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2`, consistent with all other user XP updates in the codebase.

---

### 14: BUG-NE01 — `compareNemesisProgress` passes UUID array as raw string interpolation

The function builds the PostgreSQL UUID array parameter as `` `{${userId},${nemesisId}}` `` — a raw string literal constructed by interpolating two UUIDs into the `{val1,val2}` PostgreSQL array literal syntax. While UUIDs only contain hex digits and hyphens (no injection risk in practice), this is fragile: it bypasses type safety, won't work correctly if UUIDs ever contain unexpected characters, and is not idiomatic parameterized SQL. It forces PostgreSQL to parse and validate two strings as UUIDs at query time rather than having the driver handle type binding.

FILES:
- `apps/web/lib/nemesis/nemesisEngine.ts`

FIX:
Use two separate parameters and `ARRAY[$1::uuid, $2::uuid]` in the query:
`query = \`SELECT id AS user_id, ${col} AS xp_value FROM users WHERE id = ANY(ARRAY[$1::uuid, $2::uuid])\``
`params = [userId, nemesisId]`
This is idiomatic, type-safe, and avoids manual string construction.

---

### 15: BUG-MD01 — Profanity wordlist is cached at module initialization and never invalidated

The content filter loads the profanity wordlist at module initialization into a module-level variable. When an admin updates the wordlist via the admin panel, the running server process never picks up the change. The stale wordlist remains active until the Next.js process is restarted or redeployed. For a moderation-sensitive platform, this means newly added offensive terms continue to appear in messages for hours or days after being added to the blocked list.

FILES:
- `apps/web/lib/moderation/contentFilter.ts`

FIX:
Add a TTL-based re-fetch: store a `lastFetchedAt` timestamp alongside the cached wordlist and re-query the database if the cache is older than N minutes (e.g., 5 minutes). Alternatively, use a Redis-backed cache with a short TTL that is explicitly invalidated by the admin wordlist update endpoint, so the next request picks up the fresh wordlist immediately after an admin save.

---

### 16: BUG-MD02 — `detectDuplicateMessage` normalization strips only ASCII — Unicode homoglyphs bypass detection

The duplicate-message normalization uses `.replace(/[^a-z0-9 ]/gi, '')` which only removes non-ASCII-alphanumeric characters. Cyrillic characters (е, а, о, с, etc.) are visually identical to their Latin counterparts but pass through this filter unchanged. A user can defeat duplicate detection by substituting a single character with its Cyrillic lookalike, sending the same message repeatedly without triggering the similarity check.

FILES:
- `apps/web/lib/moderation/contentFilter.ts`

FIX:
Apply `String.prototype.normalize('NFKD')` before the regex strip to decompose Unicode characters into their base forms. Add a transliteration pass to map common Cyrillic/Greek homoglyphs to their Latin equivalents before normalization. Consider using a library such as `unidecode` for a more complete mapping.

---

### 17: BUG-AU01 — Telegram OAuth mobile polling omits refresh token — Telegram users silently logged out after access token expires

In `startTelegramPoll`, when the `/api/auth/telegram/status` endpoint returns `status: 'approved'`, the code calls `await signIn(data.token, data.user as AuthUser)` passing only the access token (no third argument for `refreshToken`). The `AuthContext.signIn` function stores the refresh token to SecureStore only when `refreshToken` is provided. Without it, the Axios interceptor's `refreshAccessToken()` function reads `null` from SecureStore on the first 401, immediately notifies `onUnauthenticated()`, and logs the user out. The default access token TTL is ~15 minutes, so every Telegram-authenticated mobile user gets silently logged out after their first session expires.

FILES:
- `apps/expo/app/auth/login.tsx`
- `apps/expo/lib/api/client.ts`
- `apps/expo/lib/auth/context.tsx`

FIX:
Update the `/api/auth/telegram/status` endpoint to include `refreshToken` in the `approved` response payload. In `startTelegramPoll` (login.tsx), destructure `data.refreshToken` from the response and pass it as the third argument: `await signIn(data.token, data.user as AuthUser, data.refreshToken)`.

---

### 18: BUG-RF01 — Referral qualifying XP updates `xp_total` only, not the `xp_social` track column

When a referral is marked as "qualified" (referred user's first coin purchase), a 500 XP bonus is awarded to the referrer. The UPDATE is `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2`. The `xp_social` column is not incremented. Every other social-track XP award in the codebase updates both `xp_total` AND the track-specific column simultaneously. The referral XP shows up in the user's total XP but is invisible on the Social track leaderboard and in track-specific analytics.

FILES:
- `apps/web/lib/referrals/commissions.ts`

FIX:
Change the UPDATE to `UPDATE users SET xp_total = xp_total + $1, xp_social = COALESCE(xp_social, 0) + $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`. The `xp_ledger` INSERT already specifies `track = 'social'`, so the users table column just needs to be kept in sync.

---

### 19: BUG-FD01 — `checkNewAccountGiftInflow` builds PostgreSQL INTERVAL via SQL string concatenation

The fraud detection query uses `($2 || ' days')::INTERVAL` where `$2 = String(NEW_ACCOUNT_AGE_DAYS)` (currently `"7"`). Concatenating a parameterized value with a SQL string literal to form an INTERVAL is non-standard and fragile — if the constant is ever changed to a non-integer string value, the cast will throw a runtime PostgreSQL error inside an async fraud-check that is silently caught, causing this fraud check to be silently skipped without any error visibility.

FILES:
- `apps/web/lib/fraud/payouts.ts`

FIX:
Replace `($2 || ' days')::INTERVAL` with the arithmetic form `$2 * INTERVAL '1 day'` (passing `NEW_ACCOUNT_AGE_DAYS` as a number parameter), or since the value is a hardcoded constant, inline it directly as `INTERVAL '7 days'` and remove the `$2` parameter entirely from this query.

---

### 20: BUG-GE01 — `geoAnomaly` uses first-octet (/8) prefix comparison — too coarse for meaningful anomaly detection

The IP anomaly detection compares only the first octet of the user's IP address against their previously seen IP. A `/8` block spans 16 million addresses. Large Nigerian ISPs (MTN, Airtel, Glo) routinely assign different cities to the same `/8` range. A user traveling from Lagos to Abuja on the same ISP would not trigger an anomaly alert because both cities share the same first octet. Meanwhile, the alert fires unnecessarily for users who simply switch between two ISPs in the same city if they happen to be in different `/8` ranges.

FILES:
- `apps/web/lib/security/geoAnomaly.ts`

FIX:
Compare the first three octets (a `/24` block) for a practical balance between false positives and sensitivity. For a stronger solution, integrate a GeoIP database (e.g., MaxMind GeoLite2) to compare country and city codes, and only alert on country-level changes (which indicates a genuine session hijacking risk) while suppressing alerts for expected domestic city changes.

---

### 21: BUG-SE01 — `fieldEncryption.ts` has no key versioning — KYC key rotation permanently destroys all existing encrypted records

The `encryptField` function derives the AES-256 key by taking a SHA-256 hash of `KYC_ENCRYPTION_KEY` and uses it to encrypt KYC data (wallet addresses, bank account numbers). There is no version prefix on ciphertexts and no support for decrypting with a prior key. If `KYC_ENCRYPTION_KEY` is rotated (required periodically for security compliance), `decryptField` will fail for every previously encrypted record, returning errors or garbage data. This makes key rotation operationally impossible without a coordinated migration that would require downtime.

FILES:
- `apps/web/lib/security/fieldEncryption.ts`

FIX:
Prefix every ciphertext with a version tag (e.g., `"v1:" + base64ciphertext`). The `decryptField` function reads the prefix, selects the matching key from a key-store object (e.g., `{ v1: oldKey, v2: newKey }`), and decrypts accordingly. Provide an offline migration script that re-encrypts all stored ciphertexts under the new key version. Store old key versions in environment variables (`KYC_ENCRYPTION_KEY_V1`, `KYC_ENCRYPTION_KEY_V2`) until migration is complete.

---

### 22: BUG-AU02 — TOTP anti-replay key is set before session creation — code is consumed if `createSession` fails

In the admin TOTP login route, the anti-replay Redis key (`totp:used:${userId}:${code}`) is set with `SET NX EX 90` after `verifyTotp` passes but before `createSession` is called. If `createSession` fails (database error, Redis outage, etc.), the TOTP code is permanently marked as "used" in Redis for 90 seconds. The admin user receives a 500 error and must wait 30 seconds for the next TOTP code to attempt login again, even though they were never issued a session. Under repeated failure conditions this creates a 90-second window where no code will work.

FILES:
- `apps/web/app/api/admin/auth/totp/route.ts`

FIX:
In the catch block, after a `createSession` failure, immediately delete the anti-replay key: `await redis.del(usedKey)` before re-throwing the error. This restores the ability to retry with the same code. Wrap this cleanup in its own try/catch to prevent Redis errors from masking the original error.

---

## Code Quality Assessment

### Current State — 7.0 / 10

The Zobia codebase demonstrates a strong architectural foundation. Financial operations (coin credit/debit, star credit/debit, payout processing) use `SELECT FOR UPDATE` and atomic DB transactions consistently. JWT + Redis session management with refresh token rotation and grace windows is correctly implemented. Zod validation at API boundaries, idempotency keys for gift sends, and a well-structured fraud detection pipeline are all above-average for a platform of this scope. The XP engine, quest engine, war engine, nemesis engine, and season engine are each coherent and well-isolated.

The bugs found are primarily in the gaps between systems: a missing `FOR UPDATE SKIP LOCKED` in a secondary code path, a wrong column name in an error handler, missing guard clauses in a parallel code path, and a handful of missing column updates. There are no catastrophic design flaws. No unparameterized SQL queries were found. No missing authentication on protected routes.

**Weaknesses at current state:**
- Two concurrent-access race conditions with financial impact (BUG-PY01, BUG-EC02)
- One financial ledger integrity issue (BUG-EC01 — misclassified transaction types)
- One silent admin visibility failure (BUG-WH01 — system alerts never written)
- One mobile auth regression silently logging out all Telegram users (BUG-AU01)
- One KYC security gap making key rotation impossible (BUG-SE01)
- Service Worker serving 24h stale financial data to PWA users (BUG-SW01)

### After All Recommended Fixes — 8.5 / 10

Applying all 22 fixes closes the identified race conditions, corrects ledger accuracy, restores alert visibility, fixes the mobile auth regression, and adds KYC key rotation support. The remaining gap to 10/10 reflects areas outside the scope of this analysis: test coverage depth, end-to-end monitoring/alerting, formal incident response runbooks, and i18n completeness.

---

*Report generated: June 14, 2026, 12:00 PM UTC*  
*Analyst: Claude Code — Repository: nero1/zobia*
