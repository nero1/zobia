# Zobia Social — Forensic Bug Report (Rev 2)

**Generated:** June 16, 2026 · 5:36 AM UTC  
**Scope:** Full codebase — `apps/web` (Next.js App Router + PWA) and `apps/expo` (Android)  
**Analyst:** Deep static analysis, no sub-agents — second complete pass  

---

## Current Code Rating

**Overall: 7.5 / 10**

The codebase is architecturally sound and shows a high level of security awareness: HttpOnly cookie sessions with JWT key rotation, nonce-based CSP, CSRF Origin validation, atomic Lua rate-limiting, SSRF protection with DNS pinning, HMAC-SHA512 webhook verification, `SELECT FOR UPDATE` coin/star transactions with Decimal.js, idempotency guards on XP awards, dead-letter queues for XP and payouts, and a comprehensive payout reconciliation loop. The bugs found are logic gaps, missing DB constraints, and edge-case auth/security issues rather than fundamental design flaws. Fixing all 24 bugs would lift the rating to approximately **9.2 / 10**. The additional quality improvements outlined at the end would push it to **9.5 / 10**.

---

## Quick Bug Index (all bugs, one line each)

1. **BUG-CSRF-01** — Expo deep-link POST to `/api/auth/mobile-token` uses raw `fetch()` with no `Origin` header, blocked by middleware with 403 CSRF_ORIGIN_MISMATCH; OAuth login on mobile is fully broken.
2. **BUG-DB-01** — `guild_quests` table has no unique constraint; `ON CONFLICT DO NOTHING` in the Monday quest-reset CRON is inert, creating duplicate rows on every CRON retry.
3. **BUG-DB-02** — `guild_tier_history` partial unique index only covers rows where `war_id IS NOT NULL`; non-war tier changes can insert duplicate history rows on CRON retry.
4. **BUG-NOTIF-01** — Council invitation notifications are inserted without a `referenceId`; the partial unique index (`WHERE reference_id IS NOT NULL`) never fires, so each CRON run creates duplicate notifications.
5. **BUG-NOTIF-02** — Guild war final-hour notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
6. **BUG-NOTIF-03** — Guild tier-downgrade notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
7. **BUG-SYNC-01** — Web PWA offline sync never resets "sending" messages to "pending" on reconnect; any message stuck in "sending" after a browser crash is permanently stranded.
8. **BUG-AUTH-01** — `user.email` is `string | null` in the DB schema but passed directly to `signAccessToken` which expects `string`; null email produces a malformed JWT claim.
9. **BUG-SEC-01** — HTML sanitizer allows the `id` attribute on every element via `'*': ['class', 'id']`, enabling DOM-clobbering and CSS injection attacks.
10. **BUG-SEC-02** — Markdown link sanitizer only blocks 3 dangerous URI schemes; `blob:`, `file:`, and custom protocols pass through unchecked.
11. **BUG-AUTH-02** — Pre-auth 2FA gate uses fragile `endsWith('/2fa/verify')` path match instead of a strict exact check.
12. **BUG-DB-03** — `platform_events.name` single-column UNIQUE constraint silently breaks annual event recurrence AND causes the Flash XP lifecycle `platform_events` upsert to throw and be swallowed by `.catch`.
13. **BUG-PUSH-01** — `DeviceNotRegistered` push receipt handling fetches and purges all tokens for the user instead of only the specific failed device token.
14. **BUG-SEC-03** — Expo MMKV offline store is intentionally left unencrypted ("Phase 2" deferred); sensitive data including message drafts sits in plaintext on the device.
15. **BUG-NOTIF-04** — Nemesis overtake `last_notified_at` UPDATE only stamps the overtaking user's assignment row; the nemesis's own row is not updated, causing repeated triumph notifications on subsequent CRON runs.
16. **BUG-FIN-01** — Weekly payout CRON applies a second 10% platform fee to `available_earnings_kobo`, which is already the net balance after the platform fee was deducted at earnings credit time.
17. **BUG-DB-04** — Alliance war creation uses `ON CONFLICT DO NOTHING` but `alliance_wars` has no unique constraint on the alliance pair + week; duplicate wars can be created on CRON retry.
18. **BUG-DB-05** — `users` table has two separate columns for the same concept (`login_streak` and `login_streak_days`); divergent writes will corrupt streak data.
19. **BUG-SEC-04** — Legacy v1 field encryption derives the AES key with a single SHA-256 hash (no salt, no iterations); existing v1 ciphertext is vulnerable to offline brute-force.
20. **BUG-XP-01** — Guild chat XP daily cap (`CHAT_XP_DAILY_CAP = 20`) counts xp_ledger rows, not messages; each message inserts 2 rows (social + competitor tracks), so the cap fires after 10 messages instead of the intended 20.
21. **BUG-WAR-01** — `recordWarContribution` issues two DB queries (upsert into `war_contributions`, then UPDATE `guild_wars` points) without a transaction; a failure between them causes guild-level war points to diverge from the sum of member contributions.
22. **BUG-UI-01** — Announcement modal serial-mode view tracking reads from `user_modal_views` but never writes to it; the engine always returns modal #1 because views are never recorded (contrast: banner engine correctly records views).
23. **BUG-RACE-01** — `milestoneStickers.ts` sticker pack grant silently aborts when a concurrent INSERT causes `ON CONFLICT DO NOTHING` to return no rows; the user never receives their earned sticker pack.
24. **BUG-RACE-02** — Classroom enrollment existence check is performed outside the transaction; concurrent enrollment requests can both pass the check, double-deduct coins, and create duplicate enrolment records.

---

## Detailed Bug Entries

---

### 1. BUG-CSRF-01 — Expo mobile OAuth login blocked by CSRF check

**FILES:**
- `apps/expo/app/auth/login.tsx` — `handleDeepLink` function
- `apps/web/middleware.ts` — `isCsrfSafe`, `isAuthMutation` logic

**FIX:**
The `handleDeepLink` function performs a raw `fetch()` POST to `/api/auth/mobile-token` without an `Origin` header. The middleware classifies all POSTs to `/api/auth/*` as `isAuthMutation = true`, then `isCsrfSafe()` returns `false` when no Origin header is present, responding with 403. The shared Axios client elsewhere in the Expo app already sets `Origin: env.API_BASE_URL` but this isolated `fetch()` bypasses it. Fix: add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the headers in that `fetch()` call, or refactor it to use the shared Axios instance.

---

### 2. BUG-DB-01 — `guild_quests` missing unique constraint makes deduplication impossible

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Monday quest-reset section
- `apps/web/lib/db/schema.ts` — `guildQuests` table

**FIX:**
`ON CONFLICT DO NOTHING` requires a matching unique constraint to be effective. The `guild_quests` table has none, so PostgreSQL ignores the conflict clause and inserts duplicates on every CRON retry. Add a unique constraint such as `UNIQUE (guild_id, quest_type, week_start)` to the schema and match the `ON CONFLICT` column list to it. Remove existing duplicate rows before applying the migration.

---

### 3. BUG-DB-02 — Non-war guild tier changes bypass the `guild_tier_history` unique index

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — guild tier promotion/demotion section
- `apps/web/lib/db/schema.ts` — `guildTierHistory` table

**FIX:**
The partial unique index on `guild_tier_history` only covers rows where `war_id IS NOT NULL`. Non-war tier changes (`war_id = NULL`) have no matching constraint, so `ON CONFLICT DO NOTHING` never fires and duplicates accumulate. Add a second partial index for the null-war case, e.g. `UNIQUE (guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`.

---

### 4. BUG-NOTIF-01 — Council invitation notifications duplicated on every CRON run

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — council invitation INSERT

**FIX:**
Council invitation notifications are inserted with `reference_id = NULL`. The `notifications` table partial unique index only applies `WHERE reference_id IS NOT NULL`, so the conflict clause never fires. Assign a deterministic `reference_id` such as `council_invite:<userId>:<YYYY-WW>` and include it in the INSERT.

---

### 5. BUG-NOTIF-02 — Guild war final-hour notifications duplicated on CRON re-runs

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts` — final-hour notification INSERT

**FIX:**
Same root cause as BUG-NOTIF-01. Assign `reference_id = 'war_final_hour:<warId>'` to each notification INSERT.

---

### 6. BUG-NOTIF-03 — Guild tier-downgrade notifications duplicated on CRON re-runs

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts` — tier-downgrade notification INSERT

**FIX:**
Same root cause as BUG-NOTIF-01 and BUG-NOTIF-02. Use `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'` or `<guildId>:<newTier>:<date::date>`.

---

### 7. BUG-SYNC-01 — Web PWA offline sync permanently strands "sending" messages after crash

**FILES:**
- `apps/web/lib/offline/useOfflineSync.ts` — sync hook
- `apps/web/lib/offline/messageQueue.ts` — `getPendingMessages` (IndexedDB query)

**FIX:**
`getPendingMessages()` uses `IDBKeyRange.only("pending")` — "sending" messages are invisible to the retry loop. The Expo equivalent correctly calls `resetSendingMessages()` before the sync loop. Add a `resetSendingMessages()` function to `messageQueue.ts` that updates all `status === "sending"` rows back to `"pending"`, and call it at the start of the reconnect handler in `useOfflineSync.ts`.

---

### 8. BUG-AUTH-01 — Null `user.email` passed as `string` to JWT signing

**FILES:**
- `apps/web/lib/auth/session.ts` — `createSession`
- `apps/web/app/api/auth/2fa/verify/route.ts`
- `apps/web/lib/auth/jwt.ts` — `AccessTokenPayload.email` typed as `string` (non-nullable)

**FIX:**
`user.email` is `string | null` (Telegram/phone-only accounts have no email). Passing null silently produces `"email": null` in the JWT, breaking any downstream code that reads this claim as a guaranteed string. Fix: guard before signing — use `email: user.email ?? ''` as the minimum fix, or (better) omit the `email` claim when null and update `AccessTokenPayload` to reflect `email?: string`.

---

### 9. BUG-SEC-01 — HTML sanitizer allows `id` attribute, enabling DOM-clobbering

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `SANITIZE_OPTIONS` allowlist

**FIX:**
`'*': ['class', 'id']` permits the `id` attribute on any user-controlled element, enabling DOM clobbering attacks (shadow built-in properties, interfere with nonce-based CSP). Remove `'id'` from the wildcard allowlist. If specific elements need IDs for anchor navigation, allowlist only those elements.

---

### 10. BUG-SEC-02 — Markdown link sanitizer uses a deny-list of only 3 URI schemes

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `sanitizeMarkdown`

**FIX:**
Replace the deny-list with an allow-list: only accept `https:`, `http:`, and `mailto:` in link/image hrefs. Then pipe rendered markdown HTML through the same DOMPurify instance as `sanitizeHtml` for defense-in-depth.

---

### 11. BUG-AUTH-02 — Pre-auth 2FA gate uses fragile `endsWith` path match

**FILES:**
- `apps/web/lib/api/middleware.ts` — `withAuth` pre-auth bypass

**FIX:**
Replace `pathname.endsWith('/2fa/verify')` with `pathname === '/api/auth/2fa/verify'`.

---

### 12. BUG-DB-03 — `platform_events.name` UNIQUE breaks annual recurrence AND Flash XP upsert

**FILES:**
- `apps/web/lib/db/schema.ts` — `platformEvents` table
- `apps/web/app/api/cron/daily/route.ts` — Section 27, annual recurrence
- `apps/web/lib/events/flashXP.ts` — `advanceFlashXPLifecycle`

**FIX:**
The single-column `UNIQUE(name)` constraint causes two silent failures: (A) annual event cloning fails with a constraint violation swallowed by `ON CONFLICT DO NOTHING`, and (B) the Flash XP upsert uses `ON CONFLICT (name, starts_at) DO NOTHING` which references a non-existent composite index — PostgreSQL throws, the error is swallowed by `.catch`. Drop `UNIQUE(name)` and replace with a composite `UNIQUE(name, starts_at)`. Update all `ON CONFLICT` clauses to reference this composite key.

---

### 13. BUG-PUSH-01 — `DeviceNotRegistered` push receipt purges all tokens for the user

**FILES:**
- `apps/web/lib/notifications/push.ts` — receipt polling, `DeviceNotRegistered` branch

**FIX:**
On `DeviceNotRegistered`, the code queries all push tokens for `user_id` and marks all stale. One dead token silently removes all other devices from push delivery. Store a ticket-ID → token mapping at send time (Redis hash with a short TTL or a `push_tickets` table column), then look up only the specific failed token when processing the receipt.

---

### 14. BUG-SEC-03 — Expo MMKV offline store stores sensitive data in plaintext

**FILES:**
- `apps/expo/lib/offline/store.ts`

**FIX:**
Generate a random 256-bit key at first launch, store it in the Android Keystore via `react-native-keychain` or `expo-secure-store`, and pass it to the MMKV constructor as `encryptionKey`. Migrate any existing unencrypted data on first run.

---

### 15. BUG-NOTIF-04 — Nemesis overtake `last_notified_at` misses the nemesis's own row

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — nemesis overtake section

**FIX:**
After sending triumph notifications, the UPDATE only stamps `user_id = ANY($userIds)`. Collect the nemesis IDs separately and extend the UPDATE or issue a second one: `WHERE user_id = ANY($nemesisIds::uuid[])`.

---

### 16. BUG-FIN-01 — Weekly payout CRON double-charges platform fee on creator earnings

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 33, weekly payout aggregation

**FIX:**
`available_earnings_kobo` is already net — the platform fee was deducted at credit time. Extracting a second 10% produces an understated transfer amount. Remove the secondary fee deduction and set `netKobo = grossKobo`. Audit existing payout records for underpayments and issue corrections.

---

### 17. BUG-DB-04 — Alliance war `ON CONFLICT DO NOTHING` is inert (no matching unique constraint)

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 32b
- `apps/web/lib/db/schema.ts` — `allianceWars` table

**FIX:**
Add a unique constraint on `(LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week)` to normalise pair order. Update the `ON CONFLICT` clause to match.

---

### 18. BUG-DB-05 — Duplicate login-streak columns (`login_streak` and `login_streak_days`)

**FILES:**
- `apps/web/lib/db/schema.ts` — `users` table

**FIX:**
Audit all read/write sites for both columns, select one canonical column (recommend `login_streak_days`), migrate values, drop the redundant column, and fix all references.

---

### 19. BUG-SEC-04 — Legacy v1 field encryption uses bare SHA-256 as the KDF

**FILES:**
- `apps/web/lib/security/fieldEncryption.ts` — v1 key derivation

**FIX:**
Schedule a migration job that decrypts all v1-prefixed ciphertext and re-encrypts with v2 (scrypt). After full migration, remove the v1 decryption code path. Ensure the master key is stored in a hardware-backed secret store.

---

### 20. BUG-XP-01 — Guild chat XP daily cap fires at 10 messages instead of intended 20

**FILES:**
- `apps/web/app/api/guilds/[guildId]/chat/route.ts` — XP award section

**FIX:**
The `CHAT_XP_DAILY_CAP = 20` check counts ALL `xp_ledger` rows where `source = 'guild_chat'`. Each message inserts 2 rows (one for `social` track, one for `competitor` track). So the COUNT reaches 20 after only 10 messages — half the intended cap. Fix: either change the COUNT query to filter by a single track (`AND track = 'social'`) so it counts messages rather than row pairs, or set `CHAT_XP_DAILY_CAP = 40` to reflect the actual row count at 20 messages.

---

### 21. BUG-WAR-01 — `recordWarContribution` lacks a transaction; guild war points can diverge

**FILES:**
- `apps/web/lib/guilds/recordWarContribution.ts`

**FIX:**
The function issues two queries in sequence: (1) upsert into `war_contributions`, (2) `UPDATE guild_wars SET challenger_points / defender_points`. If the second query fails (transient DB error, connection drop), the member's contribution is recorded but the guild's total war points are not updated. War resolution logic then operates on understated guild totals. Wrap both queries in a single `db.transaction()` call so they either both commit or both roll back.

---

### 22. BUG-UI-01 — Announcement modal serial-mode never writes views; always shows modal #1

**FILES:**
- `apps/web/lib/announcements/engine.ts` — `getActiveModalForUser`

**FIX:**
`getActiveModalForUser` reads from `user_modal_views` to find unviewed modals and returns the first unviewed one, but never writes a view record. Because the view is never persisted, the "first unviewed" query always returns modal #1 on every call, making serial mode nonfunctional. Add an upsert at the end of the function (mirroring `getActiveBannerForUser`):
```sql
INSERT INTO user_modal_views (user_id, modal_id, viewed_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id, modal_id) DO UPDATE SET viewed_at = NOW()
```

---

### 23. BUG-RACE-01 — `milestoneStickers.ts` silently aborts sticker pack grant on concurrent milestone awards

**FILES:**
- `apps/web/lib/stickers/milestoneStickers.ts` — `awardMilestoneStickers`

**FIX:**
When two concurrent XP awards both reach the same milestone simultaneously, the first `INSERT INTO sticker_packs ON CONFLICT (name) DO NOTHING RETURNING id` succeeds and returns a row. The second gets `ON CONFLICT DO NOTHING` with no rows returned, hits `if (!newPack[0]) return []`, and exits without granting the user their sticker pack. Fix: after the conflict (when `newPack[0]` is undefined), do a `SELECT id FROM sticker_packs WHERE name = $1` to get the existing pack ID, then proceed with the `user_sticker_packs` INSERT. This converts a silent skip into a correct idempotent grant.

---

### 24. BUG-RACE-02 — Classroom enrollment existence check is outside the transaction; concurrent enrollments can double-deduct coins

**FILES:**
- `apps/web/app/api/classroom/[roomId]/enroll/route.ts`

**FIX:**
The existing-enrollment check (`SELECT id FROM classroom_enrolments WHERE room_id = $1 AND user_id = $2`) runs outside the transaction. Two concurrent enrollment requests can both pass this check before either transaction commits. Both then proceed to deduct coins and insert enrollment records, potentially double-deducting coins and creating duplicate enrollment rows. Fix: move the existence check inside the transaction, add `FOR UPDATE` to the check query to serialise it, and add a `UNIQUE(room_id, user_id)` constraint to `classroom_enrolments` so any race survivor is caught by the constraint.

---

## What it takes to reach 9.5 / 10

Fixing all 24 bugs brings the codebase to approximately **9.2 / 10**. The remaining 0.3 points require the following quality improvements beyond bug fixes:

### Q1 — Opaque cursor-based pagination

Guild chat (`/api/guilds/[guildId]/chat/route.ts`) uses `created_at` as a pagination cursor. Timestamp cursors are not unique — multiple messages can share a millisecond — which causes page gaps or duplicates under load. Encode the cursor as `base64(created_at + ':' + id)` and add `AND (created_at, id) < ($cursor_ts, $cursor_id)` to the WHERE clause (composite keyset pagination). Apply the same pattern to any other routes using timestamp-only cursors.

### Q2 — Council join endpoint needs transaction + idempotency guard

`/api/council/join/route.ts` performs its invitation check, existing-member check, and INSERT as independent queries. A race condition or rapid double-tap can create duplicate council memberships. Wrap all three steps in a single transaction, add `FOR UPDATE` to the membership check, and add a `UNIQUE(user_id, cycle_month)` constraint to `platform_council_members`.

### Q3 — Classroom quiz attempt needs idempotency guard

`/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts` checks for an existing attempt inside a transaction, but without `SELECT FOR UPDATE` or a unique constraint, concurrent attempts can both succeed and award double XP. Add a `UNIQUE(quiz_id, user_id)` constraint to `classroom_quiz_attempts` and use `ON CONFLICT (quiz_id, user_id) DO NOTHING RETURNING id` to detect duplicates atomically.

### Q4 — Add `Retry-After` header to rate-limited responses

The rate limiter (`lib/security/rateLimit.ts`) returns 429 but does not include a `Retry-After` header indicating when the client may retry. This makes it impossible for API clients (Expo axios, web fetch) to implement automatic backoff correctly. Return `Retry-After: <seconds>` derived from the Lua script's remaining window time.

### Q5 — Add `SameSite=Strict` to session cookies where safe

Session cookies currently use `SameSite=Lax`. On modern browsers `SameSite=Strict` provides stronger CSRF isolation (top-level navigations also require same-site origin). Evaluate whether any top-level navigation flows require the cookie to be sent cross-site (OAuth redirects from Google/Telegram might), and if not, upgrade to `Strict`. This is complementary to the existing Origin-header CSRF check.

### Q6 — Monthly gift drop announcement query has no LIMIT

`processPendingGiftDrops` in `lib/events/monthlyGiftDrop.ts` fetches all active, non-banned user IDs with no LIMIT clause before passing them to `insertNotificationBatch`. At 1M+ users this loads millions of UUIDs into Node.js memory in one query. Stream users in cursor-paginated batches (e.g. 10,000 at a time) and fan out notifications in chunks, or use a server-side INSERT ... SELECT directly.

---

## Post-Fix Ratings

| State | Rating | Notes |
|-------|--------|-------|
| Current (pre-fix) | **7.5 / 10** | Solid architecture; logic gaps and missing constraints |
| After 24 bug fixes | **9.2 / 10** | Production-ready; all critical paths correct |
| After bugs + Q1–Q6 quality items | **9.5 / 10** | Enterprise-grade security, concurrency, and UX |

---

*Report generated: June 16, 2026 · 5:36 AM UTC*
