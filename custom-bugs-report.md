# Zobia Social — Forensic Bug Report (Rev 3)

**Generated:** June 16, 2026 · 5:47 AM UTC  
**Scope:** Full codebase — `apps/web` (Next.js App Router + PWA) and `apps/expo` (Android)  
**Analyst:** Deep static analysis, no sub-agents — complete pass  

---

## Current Code Rating

**Overall: 7.5 / 10**

The codebase is architecturally sound and shows a high level of security awareness: HttpOnly cookie sessions with JWT key rotation, nonce-based CSP, CSRF Origin validation, atomic Lua rate-limiting, SSRF protection with DNS pinning, HMAC-SHA512 webhook verification, `SELECT FOR UPDATE` coin/star transactions with Decimal.js, idempotency guards on XP awards, dead-letter queues for XP and payouts, and a comprehensive payout reconciliation loop. The issues found are logic gaps, missing DB constraints, security edge cases, and scalability blind spots rather than fundamental design flaws. Fixing all 30 items would lift the rating to **9.5 / 10**.

---

## Complete Issue Index (all 30 items, one line each)

1. **BUG-CSRF-01** — Expo deep-link POST to `/api/auth/mobile-token` uses raw `fetch()` with no `Origin` header, blocked by middleware with 403; OAuth login on mobile is fully broken.
2. **BUG-DB-01** — `guild_quests` table has no unique constraint; `ON CONFLICT DO NOTHING` in the Monday quest-reset CRON is inert, creating duplicate rows on every retry.
3. **BUG-DB-02** — `guild_tier_history` partial unique index only covers rows where `war_id IS NOT NULL`; non-war tier changes insert duplicate history rows on CRON retry.
4. **BUG-NOTIF-01** — Council invitation notifications are inserted without a `referenceId`; the partial unique index (`WHERE reference_id IS NOT NULL`) never fires; each CRON run duplicates them.
5. **BUG-NOTIF-02** — Guild war final-hour notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
6. **BUG-NOTIF-03** — Guild tier-downgrade notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
7. **BUG-SYNC-01** — Web PWA offline sync never resets "sending" messages to "pending" on reconnect; messages stuck in "sending" after a browser crash are permanently stranded.
8. **BUG-AUTH-01** — `user.email` is `string | null` in the DB schema but passed directly to `signAccessToken` which expects `string`; null email produces a malformed JWT claim.
9. **BUG-SEC-01** — HTML sanitizer allows the `id` attribute on every element via `'*': ['class', 'id']`, enabling DOM-clobbering and CSS injection attacks.
10. **BUG-SEC-02** — Markdown link sanitizer only blocks 3 URI schemes (`javascript:`, `vbscript:`, `data:`); `blob:`, `file:`, and custom protocols pass through unchecked.
11. **BUG-AUTH-02** — Pre-auth 2FA gate uses fragile `endsWith('/2fa/verify')` path match instead of a strict exact-equality check.
12. **BUG-DB-03** — `platform_events.name` single-column UNIQUE constraint silently breaks annual event recurrence AND causes the Flash XP `platform_events` upsert to throw and be swallowed by `.catch`.
13. **BUG-PUSH-01** — `DeviceNotRegistered` push receipt handling fetches and purges all tokens for the user instead of only the one specific failed device token.
14. **BUG-SEC-03** — Expo MMKV offline store is intentionally left unencrypted ("Phase 2" deferred); sensitive data including message drafts sits in plaintext on the device.
15. **BUG-NOTIF-04** — Nemesis overtake `last_notified_at` UPDATE only stamps the overtaking user's assignment row; the nemesis's own row is not updated, causing repeated triumph notifications.
16. **BUG-FIN-01** — Weekly payout CRON applies a second 10% platform fee to `available_earnings_kobo`, which is already net after the fee was deducted at credit time; creators are underpaid.
17. **BUG-DB-04** — Alliance war creation uses `ON CONFLICT DO NOTHING` but `alliance_wars` has no unique constraint on the alliance pair + week; duplicate wars can be created on CRON retry.
18. **BUG-DB-05** — `users` table has two separate columns for the same concept (`login_streak` and `login_streak_days`); divergent writes corrupt streak data.
19. **BUG-SEC-04** — Legacy v1 field encryption derives the AES key with a single SHA-256 hash (no salt, no iterations); existing v1 ciphertext is vulnerable to offline brute-force.
20. **BUG-XP-01** — Guild chat XP daily cap (`CHAT_XP_DAILY_CAP = 20`) counts xp_ledger rows, not messages; each message inserts 2 rows, so the cap fires after 10 messages instead of 20.
21. **BUG-WAR-01** — `recordWarContribution` issues two DB queries without a transaction; a failure between them causes guild-level war points to diverge from member contributions.
22. **BUG-UI-01** — Announcement modal serial-mode reads `user_modal_views` to find unviewed modals but never writes a view record; it always returns modal #1.
23. **BUG-RACE-01** — `milestoneStickers.ts` sticker pack grant silently aborts when a concurrent INSERT triggers `ON CONFLICT DO NOTHING`; the user never receives their earned sticker pack.
24. **BUG-RACE-02** — Classroom enrollment existence check runs outside the transaction; concurrent requests can both pass it, double-deduct coins, and create duplicate enrollment records.
25. **IMP-CURSOR-01** — Guild chat (and other routes) uses raw `created_at` timestamps as pagination cursors; timestamp ties cause page gaps or duplicates under load.
26. **IMP-IDMP-01** — Council join endpoint performs invitation check, membership check, and INSERT as independent queries; a race or double-tap creates duplicate council memberships.
27. **IMP-IDMP-02** — Classroom quiz attempt uses SELECT-then-INSERT without `FOR UPDATE` or a unique constraint; concurrent submissions can both pass the duplicate check and award double XP.
28. **IMP-RATE-01** — Rate limiter returns 429 without a `Retry-After` header; API clients cannot implement correct automatic backoff.
29. **IMP-SEC-05** — Session cookies use `SameSite=Lax`; upgrading to `SameSite=Strict` (where OAuth flows permit) would add an additional CSRF isolation layer.
30. **IMP-SCALE-01** — Monthly gift drop announcement fetches all user IDs with no LIMIT; at scale (1M+ users) this loads millions of UUIDs into Node.js memory in a single query.

---

## Detailed Entries

---

### 1. BUG-CSRF-01 — Expo mobile OAuth login blocked by CSRF check

**FILES:**
- `apps/expo/app/auth/login.tsx` — `handleDeepLink` function
- `apps/web/middleware.ts` — `isCsrfSafe`, `isAuthMutation` logic

**FIX:**
The `handleDeepLink` function performs a raw `fetch()` POST to `/api/auth/mobile-token` without an `Origin` header. The middleware classifies all POSTs to `/api/auth/*` as `isAuthMutation = true`, then `isCsrfSafe()` returns `false` when no Origin header is present, returning a 403. The shared Axios client elsewhere in the Expo app already sets `Origin: env.API_BASE_URL` but this isolated `fetch()` bypasses it. Fix: add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the headers in that `fetch()` call, or refactor it to use the shared Axios instance so the header is always included.

---

### 2. BUG-DB-01 — `guild_quests` missing unique constraint makes deduplication impossible

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Monday quest-reset section
- `apps/web/lib/db/schema.ts` — `guildQuests` table

**FIX:**
`ON CONFLICT DO NOTHING` requires a matching unique constraint to be effective in PostgreSQL. The `guild_quests` table has none, so the conflict clause is silently ignored and duplicate rows accumulate on every CRON retry. Add `UNIQUE (guild_id, quest_type, week_start)` to the schema and match the `ON CONFLICT` column list in the CRON section. Delete existing duplicate rows before applying the migration.

---

### 3. BUG-DB-02 — Non-war guild tier changes bypass the `guild_tier_history` unique index

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — guild tier promotion/demotion section
- `apps/web/lib/db/schema.ts` — `guildTierHistory` table

**FIX:**
The partial unique index on `guild_tier_history` only covers rows where `war_id IS NOT NULL`. Non-war tier changes have no matching constraint, so `ON CONFLICT DO NOTHING` never fires and duplicates accumulate. Add a second partial index for the null-war case: `UNIQUE (guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`.

---

### 4. BUG-NOTIF-01 — Council invitation notifications duplicated on every CRON run

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — council invitation notification INSERT

**FIX:**
Council invitation notifications are inserted with `reference_id = NULL`. The `notifications` partial unique index only applies `WHERE reference_id IS NOT NULL`, so it never fires. Assign a deterministic `reference_id` such as `council_invite:<userId>:<YYYY-WW>` and include it in the INSERT.

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
Same root cause as BUG-NOTIF-01. Use `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'` or `<guildId>:<newTier>:<date::date>`.

---

### 7. BUG-SYNC-01 — Web PWA offline sync permanently strands "sending" messages after crash

**FILES:**
- `apps/web/lib/offline/useOfflineSync.ts` — sync hook
- `apps/web/lib/offline/messageQueue.ts` — `getPendingMessages`

**FIX:**
`getPendingMessages()` uses `IDBKeyRange.only("pending")` — messages in "sending" state are invisible to the retry loop. The Expo equivalent correctly calls `resetSendingMessages()` before the sync loop. Add a `resetSendingMessages()` function to `messageQueue.ts` that updates all `status === "sending"` rows back to `"pending"` in IndexedDB, and call it at the start of the reconnect handler in `useOfflineSync.ts`.

---

### 8. BUG-AUTH-01 — Null `user.email` passed as `string` to JWT signing

**FILES:**
- `apps/web/lib/auth/session.ts` — `createSession`
- `apps/web/app/api/auth/2fa/verify/route.ts`
- `apps/web/lib/auth/jwt.ts` — `AccessTokenPayload.email` typed as `string`

**FIX:**
`user.email` is `string | null` for Telegram/phone-only accounts. Passing null silently produces `"email": null` in the JWT, breaking downstream code that reads the claim as a guaranteed string. Preferred fix: make `email` optional in `AccessTokenPayload` and omit the claim when null. Minimal fix: guard with `email: user.email ?? ''`.

---

### 9. BUG-SEC-01 — HTML sanitizer allows `id` attribute, enabling DOM-clobbering

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `SANITIZE_OPTIONS` allowlist

**FIX:**
`'*': ['class', 'id']` permits the `id` attribute on any user-controlled element, enabling DOM-clobbering (shadow built-in properties, interfere with nonce-based script loading). Remove `'id'` from the wildcard allowlist. If specific elements need IDs for anchor navigation, allowlist only those elements (e.g. `'h2': ['id']`).

---

### 10. BUG-SEC-02 — Markdown link sanitizer uses a deny-list of only 3 URI schemes

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `sanitizeMarkdown`

**FIX:**
Replace the deny-list approach with a DOMPurify allow-list configured with `ALLOWED_URI_REGEXP: /^(https?|mailto):/` applied to the fully-rendered markdown HTML. This blocks `blob:`, `file:`, custom app-scheme URIs, and future unknown schemes by default.

---

### 11. BUG-AUTH-02 — Pre-auth 2FA gate uses fragile `endsWith` path match

**FILES:**
- `apps/web/lib/api/middleware.ts` — `withAuth` pre-auth bypass

**FIX:**
Replace `pathname.endsWith('/2fa/verify')` with the exact-match check `pathname === '/api/auth/2fa/verify'`.

---

### 12. BUG-DB-03 — `platform_events.name` UNIQUE breaks annual recurrence AND Flash XP upsert

**FILES:**
- `apps/web/lib/db/schema.ts` — `platformEvents` table
- `apps/web/app/api/cron/daily/route.ts` — Section 27, annual recurrence cloning
- `apps/web/lib/events/flashXP.ts` — `advanceFlashXPLifecycle`

**FIX:**
The single-column `UNIQUE(name)` causes two silent failures: (A) annual event cloning inserts the same name and is swallowed by `ON CONFLICT DO NOTHING`, so next-year events are never created. (B) Flash XP upsert uses `ON CONFLICT (name, starts_at) DO NOTHING` which references a non-existent composite index — PostgreSQL throws an error that is swallowed by `.catch`. Drop `UNIQUE(name)` and replace with `UNIQUE(name, starts_at)`. Update all `ON CONFLICT` clauses to reference the composite key.

---

### 13. BUG-PUSH-01 — `DeviceNotRegistered` push receipt purges all tokens for the user

**FILES:**
- `apps/web/lib/notifications/push.ts` — receipt polling, `DeviceNotRegistered` branch

**FIX:**
On `DeviceNotRegistered`, the code queries all push tokens for `user_id` and marks every one stale. One dead token silently removes all other devices from push delivery. Store a ticket-ID → token mapping at send time (Redis hash `push_ticket:<ticketId>` with 24h TTL or a `push_tickets` DB column). On receipt processing, look up only the specific token for that ticket ID and delete only that row.

---

### 14. BUG-SEC-03 — Expo MMKV offline store stores sensitive data in plaintext

**FILES:**
- `apps/expo/lib/offline/store.ts`

**FIX:**
Generate a random 256-bit key at first launch using `crypto.getRandomValues`, store it in the Android Keystore via `react-native-keychain` or `expo-secure-store`, and pass it as `encryptionKey` to the MMKV constructor. Migrate existing unencrypted data on first run (read all values, delete old store, create encrypted store, write back).

---

### 15. BUG-NOTIF-04 — Nemesis overtake `last_notified_at` misses the nemesis's own assignment row

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — nemesis overtake notification section

**FIX:**
The UPDATE only stamps `user_id = ANY($userIds)` (the overtaking users). Collect the nemesis IDs separately and extend the UPDATE: `WHERE user_id = ANY(($userIds || $nemesisIds)::uuid[])`.

---

### 16. BUG-FIN-01 — Weekly payout CRON double-charges platform fee on creator earnings

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 33, weekly payout aggregation

**FIX:**
`available_earnings_kobo` is already net — the platform fee was deducted at credit time. Extracting a second 10% produces an understated transfer amount. Remove the secondary fee calculation and set `netKobo = grossKobo`. Audit existing payout records for underpayments and issue corrections to affected creators.

---

### 17. BUG-DB-04 — Alliance war `ON CONFLICT DO NOTHING` is inert (no matching unique constraint)

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 32b
- `apps/web/lib/db/schema.ts` — `allianceWars` table

**FIX:**
Add a unique index normalising pair order:
```sql
CREATE UNIQUE INDEX ON alliance_wars
  (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week);
```
Update the `ON CONFLICT` clause to reference this expression index.

---

### 18. BUG-DB-05 — Duplicate login-streak columns (`login_streak` and `login_streak_days`)

**FILES:**
- `apps/web/lib/db/schema.ts` — `users` table

**FIX:**
Audit all read/write sites for both columns, select `login_streak_days` as canonical, write a migration that sets it to `GREATEST(login_streak, login_streak_days)` for all users, drops `login_streak`, and updates all application references.

---

### 19. BUG-SEC-04 — Legacy v1 field encryption uses bare SHA-256 as the KDF

**FILES:**
- `apps/web/lib/security/fieldEncryption.ts` — v1 key derivation path

**FIX:**
Schedule a background job that decrypts all v1-prefixed ciphertext and re-encrypts with v2 (scrypt + random salt). After 0 v1 rows remain, remove the v1 decryption code path. Ensure the master encryption key is stored in a hardware-backed secret store.

---

### 20. BUG-XP-01 — Guild chat XP daily cap fires at 10 messages instead of intended 20

**FILES:**
- `apps/web/app/api/guilds/[guildId]/chat/route.ts` — XP award section

**FIX:**
`CHAT_XP_DAILY_CAP = 20` is compared against a COUNT of all `xp_ledger` rows with `source = 'guild_chat'`. Each message inserts 2 rows (social + competitor tracks), so the count reaches 20 after 10 messages. Fix: add `AND track = 'social'` to the COUNT query so it counts messages (one social-track row each), preserving `CHAT_XP_DAILY_CAP = 20` as the intended 20-message cap.

---

### 21. BUG-WAR-01 — `recordWarContribution` lacks a transaction; guild war points can diverge

**FILES:**
- `apps/web/lib/guilds/recordWarContribution.ts`

**FIX:**
The function issues two queries in sequence without a transaction: (1) upsert into `war_contributions`, (2) UPDATE `guild_wars` challenger/defender points. A transient failure between them leaves member contributions recorded but guild totals incorrect, causing war resolution to operate on understated point totals. Wrap both queries in `db.transaction()`.

---

### 22. BUG-UI-01 — Announcement modal serial-mode never writes views; always shows modal #1

**FILES:**
- `apps/web/lib/announcements/engine.ts` — `getActiveModalForUser`

**FIX:**
`getActiveModalForUser` reads from `user_modal_views` to find unviewed modals but never writes a view record after selecting one. The "first unviewed" query always returns modal #1 on every API call. Add an upsert at the end of the function (mirroring `getActiveBannerForUser`):
```sql
INSERT INTO user_modal_views (user_id, modal_id, viewed_at)
VALUES ($userId, $selectedId, NOW())
ON CONFLICT (user_id, modal_id) DO UPDATE SET viewed_at = NOW()
```

---

### 23. BUG-RACE-01 — Milestone sticker pack grant silently aborts on concurrent inserts

**FILES:**
- `apps/web/lib/stickers/milestoneStickers.ts` — `awardMilestoneStickers`

**FIX:**
When two concurrent XP awards both trigger the same milestone simultaneously, the second `INSERT INTO sticker_packs ON CONFLICT (name) DO NOTHING RETURNING id` returns no rows. The code hits `if (!newPack[0]) return []` and exits without granting the sticker pack. Fix: after `newPack[0]` is undefined, fall back to `SELECT id FROM sticker_packs WHERE name = $1` to get the existing pack ID, then proceed with the `user_sticker_packs` INSERT as normal.

---

### 24. BUG-RACE-02 — Classroom enrollment existence check outside transaction enables coin double-spend

**FILES:**
- `apps/web/app/api/classroom/[roomId]/enroll/route.ts`

**FIX:**
The existing-enrollment check runs before the transaction opens. Concurrent enrollment requests can both pass it, then both deduct coins and insert enrollment records inside their own transactions, resulting in a double coin deduction and duplicate enrollment rows. Move the existence check inside the transaction with `FOR UPDATE`. Add `UNIQUE(room_id, user_id)` to `classroom_enrolments` as a final safety net.

---

### 25. IMP-CURSOR-01 — Timestamp-only pagination cursors cause page gaps under concurrent writes

**FILES:**
- `apps/web/app/api/guilds/[guildId]/chat/route.ts` — cursor pagination
- Any other routes using `created_at` as the sole cursor value

**FIX:**
The guild chat endpoint uses `created_at` as the cursor: `WHERE gm.created_at < $cursor`. Multiple messages created within the same millisecond share a timestamp, causing pages to skip some messages or repeat others. Replace with a composite keyset cursor: encode `created_at + ':' + id` as base64 for the cursor value, and update the WHERE clause to `AND (created_at, id) < ($cursor_ts, $cursor_id)`. This uniquely identifies a position in the result set regardless of timestamp ties.

---

### 26. IMP-IDMP-01 — Council join endpoint has no transaction or idempotency guard

**FILES:**
- `apps/web/app/api/council/join/route.ts`

**FIX:**
The invitation check, existing-member check, `UPDATE` (close old seat), and `INSERT` (new seat) are all separate queries with no transaction. A race condition or a rapid double-tap can create duplicate council memberships. Fix: wrap all steps in a single transaction, add `SELECT ... FOR UPDATE` to the existing-member check, and add a `UNIQUE(user_id, cycle_month)` constraint to `platform_council_members`. The INSERT should use `ON CONFLICT (user_id, cycle_month) DO NOTHING RETURNING id` to gracefully handle the race.

---

### 27. IMP-IDMP-02 — Classroom quiz attempt has no unique constraint; concurrent submissions award double XP

**FILES:**
- `apps/web/app/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts`

**FIX:**
The "already attempted" check inside the transaction uses a plain SELECT without `FOR UPDATE`. At the default PostgreSQL READ COMMITTED isolation level, two concurrent transactions both read zero existing attempts and both proceed to insert and award XP. Add `UNIQUE(quiz_id, user_id)` to `classroom_quiz_attempts`. Replace the SELECT-then-INSERT pattern with `INSERT ... ON CONFLICT (quiz_id, user_id) DO NOTHING RETURNING id` and detect the conflict to throw a 409.

---

### 28. IMP-RATE-01 — Rate limiter returns 429 without a `Retry-After` header

**FILES:**
- `apps/web/lib/security/rateLimit.ts` — Lua script and enforcement middleware
- `apps/web/lib/api/errors.ts` — 429 response construction

**FIX:**
The sliding-window Lua script knows when the oldest entry in the window expires (the minimum score in the sorted set minus the window start equals the remaining TTL for the first slot). Return this value as an additional result from the script, then include `Retry-After: <seconds>` on all 429 responses. Both the Expo axios client and the web fetch layer can then implement correct exponential backoff instead of retrying immediately or using arbitrary sleep values.

---

### 29. IMP-SEC-05 — Session cookies use `SameSite=Lax`; `SameSite=Strict` is available

**FILES:**
- `apps/web/lib/auth/session.ts` — cookie options
- `apps/web/app/api/auth/logout/route.ts`

**FIX:**
`SameSite=Lax` allows cookies to be sent on top-level navigations from other origins (e.g. clicking a link from an email). `SameSite=Strict` prevents this, adding an additional CSRF isolation layer on top of the existing Origin-header check. Evaluate whether any production OAuth redirect flow requires the session cookie to be sent on a top-level cross-origin navigation. If not (cookies are only needed on same-site API calls after the redirect resolves), upgrade to `SameSite=Strict` on both the access-token and refresh-token cookies.

---

### 30. IMP-SCALE-01 — Monthly gift drop announcement loads all user IDs into memory with no LIMIT

**FILES:**
- `apps/web/lib/events/monthlyGiftDrop.ts` — `processPendingGiftDrops`

**FIX:**
The announcement section runs `SELECT id FROM users WHERE deleted_at IS NULL AND is_banned = false` with no LIMIT clause, loading every active user's ID into the Node.js process in one round-trip. At 1M+ users this is a multi-hundred-MB allocation and can exhaust the process heap or connection pool. Replace with a cursor-paginated batch loop: fetch 10,000 users at a time using a keyset cursor (`WHERE id > $lastId ORDER BY id LIMIT 10000`), pass each batch to `insertNotificationBatch`, and loop until all users are covered. This keeps memory flat and allows the function to run efficiently at any scale.

---

## Post-Fix Rating

Applying all 30 fixes delivers:

| State | Rating |
|-------|--------|
| Current (pre-fix) | **7.5 / 10** |
| After items 1–24 (bugs) | **9.2 / 10** |
| After items 1–30 (bugs + improvements) | **9.5 / 10** |

The remaining 0.5 points reflect inherent complexity trade-offs (dual offline sync engines, multi-provider realtime, mobile/web platform split) rather than fixable defects.

---

*Report generated: June 16, 2026 · 5:47 AM UTC*
