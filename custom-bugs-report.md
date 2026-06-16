# Zobia Social — Forensic Bug Report

**Generated:** June 16, 2026 · 5:11 AM UTC  
**Scope:** Full codebase — `apps/web` (Next.js App Router + PWA) and `apps/expo` (Android)  
**Analyst:** Deep static analysis, no sub-agents  

---

## Current Code Rating

**Overall: 7.5 / 10**

The codebase is architecturally sound and shows a high level of security awareness: HttpOnly cookie sessions with JWT key rotation, nonce-based CSP, CSRF Origin validation, atomic Lua rate-limiting, SSRF protection with DNS pinning, HMAC-SHA512 webhook verification, `SELECT FOR UPDATE` coin transactions with Decimal.js, idempotency guards on XP awards, dead-letter queues for XP and payouts, and a comprehensive payout reconciliation loop. The bugs found are largely logic gaps, missing DB constraints, and a handful of auth/security edge cases rather than fundamental design flaws. Fixing them would lift the rating to approximately **9.2 / 10**.

---

## Quick Bug Index (all bugs, one line each)

1. **BUG-CSRF-01** — Expo deep-link POST to `/api/auth/mobile-token` uses raw `fetch()` with no `Origin` header, blocked by middleware with 403 CSRF_ORIGIN_MISMATCH; mobile login after OAuth deep-link redirect is completely broken.
2. **BUG-DB-01** — `guild_quests` table has no unique constraint; `ON CONFLICT DO NOTHING` in the Monday quest-reset CRON is inert, creating duplicate rows on every retry.
3. **BUG-DB-02** — `guild_tier_history` partial unique index only covers rows where `war_id IS NOT NULL`; non-war tier promotions/demotions can insert duplicate history rows on CRON retry.
4. **BUG-NOTIF-01** — Council invitation notifications are inserted without a `referenceId`; the partial unique index (`WHERE reference_id IS NOT NULL`) never fires, so each CRON run creates duplicate notifications.
5. **BUG-NOTIF-02** — Guild war final-hour notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
6. **BUG-NOTIF-03** — Guild tier-downgrade notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
7. **BUG-SYNC-01** — Web PWA offline sync never resets "sending" messages to "pending" on reconnect; any message stuck in "sending" after a browser crash is permanently stranded and never retried.
8. **BUG-AUTH-01** — `user.email` is `string | null` in the DB schema but passed directly to `signAccessToken` which expects `string`; null email produces a malformed JWT claim that breaks downstream email-based logic.
9. **BUG-SEC-01** — HTML sanitizer allows the `id` attribute on every element via `'*': ['class', 'id']`, enabling DOM-clobbering and CSS injection attacks.
10. **BUG-SEC-02** — Markdown link sanitizer only blocks `javascript:`, `vbscript:`, and `data:` URI schemes; other dangerous schemes (`blob:`, `file:`, custom protocols) and embedded HTML pass through unchecked.
11. **BUG-AUTH-02** — Pre-auth 2FA gate uses `endsWith('/2fa/verify')` to identify the 2FA endpoint; fragile match could permit unintended paths or be bypassed by path manipulation.
12. **BUG-DB-03** — `platform_events.name` carries a single-column `UNIQUE` constraint that silently breaks annual event recurrence cloning AND causes the Flash XP lifecycle's `platform_events` upsert to throw an unhandled constraint mismatch error (swallowed by `.catch`).
13. **BUG-PUSH-01** — `DeviceNotRegistered` receipt handling fetches all push tokens for the affected user and purges them all, instead of deleting only the one specific failed device token.
14. **BUG-SEC-03** — Expo MMKV offline store is intentionally left unencrypted ("Phase 2" deferred); sensitive data including message drafts sits in plaintext on the device.
15. **BUG-NOTIF-04** — Nemesis overtake `last_notified_at` UPDATE only stamps the overtaking user's assignment row; the nemesis's own row is not updated, causing repeated triumph notifications to the nemesis on subsequent CRON runs.
16. **BUG-FIN-01** — Weekly payout CRON applies a second 10% platform fee to `available_earnings_kobo`, which is already the net balance after the platform fee was deducted at earnings credit time; creators are paid 10% less than they are owed.
17. **BUG-DB-04** — Alliance war creation uses `ON CONFLICT DO NOTHING` but `alliance_wars` has no unique constraint on `(alliance_1_id, alliance_2_id, week)`; the conflict clause is inert and duplicate wars can be created on CRON retry.
18. **BUG-DB-05** — `users` table has two separate columns tracking the same concept (`login_streak` and `login_streak_days`); divergent writes will corrupt streak display and quest evaluation.
19. **BUG-SEC-04** — Legacy v1 field encryption derives the AES key with a single SHA-256 hash over the master key (no salt, no iterations); existing v1 ciphertext is vulnerable to offline brute-force if ever exposed.

---

## Detailed Bug Entries

---

### 1. BUG-CSRF-01 — Expo mobile OAuth login blocked by CSRF check

**FILES:**
- `apps/expo/app/auth/login.tsx` — `handleDeepLink` function
- `apps/web/middleware.ts` — `isCsrfSafe`, `isAuthMutation` logic
- `apps/web/app/api/auth/mobile-token/route.ts` — the target endpoint

**FIX:**
The `handleDeepLink` function performs a raw `fetch()` POST to `/api/auth/mobile-token` to exchange an OAuth code for a session token. It does not include an `Origin` header. The web middleware classifies all POSTs to `/api/auth/*` as `isAuthMutation = true`, then calls `isCsrfSafe()`, which returns `false` when no `Origin` header is present, and responds with 403 `CSRF_ORIGIN_MISMATCH`. The shared Axios client used elsewhere in the Expo app already sets `Origin: env.API_BASE_URL` automatically, but this isolated `fetch()` call bypasses it. The fix is straightforward: add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the `headers` object in that `fetch()` call, or refactor the call to use the shared Axios instance so the header is always included.

---

### 2. BUG-DB-01 — `guild_quests` missing unique constraint makes deduplication impossible

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Monday quest-reset section
- `apps/web/lib/db/schema.ts` — `guildQuests` table definition

**FIX:**
The Monday quest-reset CRON inserts new quest rows per guild with `ON CONFLICT DO NOTHING`. For this clause to work, PostgreSQL requires a matching unique constraint on the conflict column set. The `guild_quests` table has no such constraint, so the `ON CONFLICT` is silently ignored — PostgreSQL accepts a duplicate insert every time the CRON runs. On each retry, users get extra quest rows, distorting quest progress and leaderboard metrics. Add a unique constraint such as `UNIQUE (guild_id, quest_type, week_start)` to the schema and update the `ON CONFLICT` column list to match it.

---

### 3. BUG-DB-02 — Non-war guild tier changes bypass the `guild_tier_history` deduplication index

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — guild tier promotion/demotion section
- `apps/web/lib/db/schema.ts` — `guildTierHistory` table

**FIX:**
`guild_tier_history` has a partial unique index that only covers rows where `war_id IS NOT NULL`. When a tier change occurs outside a war context (i.e., `war_id = NULL`), no matching unique constraint exists for those rows, so `ON CONFLICT DO NOTHING` is never triggered. Every CRON re-run inserts a fresh duplicate history row for non-war tier changes, polluting the tier history log. Add a second partial unique index covering the null-war case, for example `UNIQUE (guild_id, new_tier) WHERE war_id IS NULL` combined with a `changed_at::date` column to scope it per day, or simply use a full unique index on `(guild_id, new_tier, changed_at::date)`.

---

### 4. BUG-NOTIF-01 — Council invitation notifications duplicated on every CRON run

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — council invitation notification INSERT

**FIX:**
Council invitation notifications are inserted without setting `reference_id` (`NULL`). The `notifications` table has a partial unique index `ON (user_id, type, reference_id) WHERE reference_id IS NOT NULL`. Because `reference_id IS NULL`, the partial index's condition is false and `ON CONFLICT DO NOTHING` never fires. Every daily CRON run inserts a duplicate notification regardless of whether the user already received one. Assign a stable, deterministic `reference_id` such as `council_invite:<userId>:<YYYY-WW>` (week-scoped) and include it in the INSERT. This allows the partial unique index to enforce deduplication correctly.

---

### 5. BUG-NOTIF-02 — Guild war final-hour notifications duplicated on CRON re-runs

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts` — final-hour notification INSERT

**FIX:**
Same root cause as BUG-NOTIF-01. Final-hour war notifications are inserted without a `reference_id`, so the partial unique index never fires. Each CRON execution sends another "war ends in one hour" notification. Assign a `reference_id` such as `war_final_hour:<warId>` to deduplicate correctly.

---

### 6. BUG-NOTIF-03 — Guild tier-downgrade notifications duplicated on CRON re-runs

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts` — tier-downgrade notification INSERT

**FIX:**
Same root cause as BUG-NOTIF-01 and BUG-NOTIF-02. Tier-downgrade notifications lack a `reference_id`. Use `guild_tier_downgrade:<guildId>:<warId>` or `<guildId>:<newTier>:<date::date>` as the deduplication key.

---

### 7. BUG-SYNC-01 — Web PWA offline sync permanently strands "sending" messages after crash

**FILES:**
- `apps/web/lib/offline/useOfflineSync.ts` — sync hook, reconnect handler
- `apps/web/lib/offline/messageQueue.ts` — `getPendingMessages` (IndexedDB query)

**FIX:**
When a message is picked up for delivery it transitions to `status = "sending"`. If the browser crashes or the tab is closed at that moment, the message remains in "sending" and is never recovered. `getPendingMessages()` uses `IDBKeyRange.only("pending")` and only returns `status === "pending"` rows, so "sending" messages are invisible to the retry loop forever. The Expo equivalent (`apps/expo/lib/offline/syncQueue.ts`) correctly calls `resetSendingMessages()` before the sync loop starts, moving "sending" back to "pending". Add the same step to the web PWA: implement a `resetSendingMessages()` function in `messageQueue.ts` that opens the IndexedDB store and updates all `status === "sending"` rows back to `"pending"`, then call it at the start of the sync hook's reconnect logic.

---

### 8. BUG-AUTH-01 — Null `user.email` passed as `string` to JWT signing

**FILES:**
- `apps/web/lib/auth/session.ts` — `createSession`, passes `email: user.email`
- `apps/web/app/api/auth/2fa/verify/route.ts` — calls `createSession` with nullable email
- `apps/web/lib/auth/jwt.ts` — `signAccessToken` type expects `string` for email

**FIX:**
The `users` table schema allows `email` to be `NULL` for accounts created via Telegram OAuth or phone-only registration. `createSession` passes `user.email` directly to `signAccessToken` without null-guarding. TypeScript accepts this because the `email` parameter type in `signAccessToken` is `string`, but at runtime a `null` value is passed, producing `"email": null` in the signed JWT. Downstream code that trusts the JWT email claim as a guaranteed string will encounter a runtime `null`. Fix: guard the value before passing — use `email: user.email ?? ''` if an empty string is acceptable downstream, or remove the `email` claim from the JWT entirely and have downstream code fetch it from the DB when needed.

---

### 9. BUG-SEC-01 — HTML sanitizer allows `id` attribute, enabling DOM-clobbering

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `SANITIZE_OPTIONS` allowlist

**FIX:**
The DOMPurify allowlist contains `'*': ['class', 'id']`, permitting the `id` attribute on any HTML element in user-generated content. `id` attributes on user-controlled elements create DOM-clobbering opportunities: an attacker can inject `<a id="getElementById">` or similar elements that shadow built-in DOM APIs and browser-native properties, potentially bypassing script-level security checks. This is especially dangerous alongside the strict-dynamic CSP and nonce-based script loading. Remove `'id'` from the wildcard allowlist. If specific semantic elements genuinely need IDs for in-page anchor navigation, allowlist them narrowly on only those elements (e.g. add `'h2': ['id']`).

---

### 10. BUG-SEC-02 — Markdown link sanitizer uses a deny-list of only 3 dangerous URI schemes

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `sanitizeMarkdown` link-href sanitizer

**FIX:**
The markdown sanitizer strips `javascript:`, `vbscript:`, and `data:` from link `href` values but uses a deny-list approach rather than an allow-list. Deny-lists are inherently incomplete: `blob:`, `file:`, `ms-appx:`, `mxf:`, and custom app-scheme URIs (e.g. `zobia://`) all pass through. Additionally, markdown parsers can render fenced HTML blocks and raw `<img onerror="...">` tags that bypass the link-only check. Switch to an allow-list: accept only `https:`, `http:`, and optionally `mailto:` in link and image hrefs; reject all other schemes. Then pipe the full rendered markdown HTML through the same DOMPurify instance used by `sanitizeHtml` for defense-in-depth.

---

### 11. BUG-AUTH-02 — Pre-auth 2FA gate uses fragile `endsWith` path match

**FILES:**
- `apps/web/lib/api/middleware.ts` — `withAuth` HOC pre-auth bypass

**FIX:**
The `withAuth` middleware grants access to `pre_auth` JWT holders only when `request.nextUrl.pathname.endsWith('/2fa/verify')`. This is fragile in two ways: (1) a future route whose path happens to end with that suffix would unintentionally receive pre-auth access, and (2) path traversal tricks (e.g. double-encoded slashes on some reverse proxies) could match unintended paths. Replace with a strict exact-match check: `pathname === '/api/auth/2fa/verify'`.

---

### 12. BUG-DB-03 — `platform_events.name` single-column UNIQUE breaks recurrence AND Flash XP upsert

**FILES:**
- `apps/web/lib/db/schema.ts` — `platformEvents` table (`name: text("name").notNull().unique()`)
- `apps/web/app/api/cron/daily/route.ts` — Section 27, annual event recurrence cloning
- `apps/web/lib/events/flashXP.ts` — `advanceFlashXPLifecycle`, `platform_events` upsert

**FIX:**
The `platform_events` table enforces `UNIQUE(name)` — a single-column unique constraint on the event name alone. This breaks two independent features:

**A — Annual recurrence (daily CRON Section 27):** The cloning logic inserts a copy of the recurring event for the next year, keeping the same `name` but advancing `starts_at` and `ends_at`. The insert collides with the existing name unique constraint and the conflict is swallowed by `ON CONFLICT DO NOTHING`. The next-year event is silently never created. Annual recurring events disappear after their first occurrence.

**B — Flash XP lifecycle upsert (`flashXP.ts`):** When a Flash XP event fires, the code attempts to record it in `platform_events` using `ON CONFLICT (name, starts_at) DO NOTHING`. No composite unique index on `(name, starts_at)` exists — only the single-column `UNIQUE(name)` does. PostgreSQL raises "there is no unique or exclusion constraint matching the ON CONFLICT specification", which is swallowed by `.catch(() => {})`. Flash XP events are silently never added to the `platform_events` calendar.

The fix is to drop the `UNIQUE(name)` constraint and replace it with a composite unique constraint on `(name, starts_at)`. Update the annual recurrence `ON CONFLICT` to use `(name, starts_at)`, and the Flash XP upsert then works automatically. Consider also adding a CHECK to prevent identical `(name, starts_at)` duplicates that differ only by case.

---

### 13. BUG-PUSH-01 — `DeviceNotRegistered` push receipt purges all tokens for the user

**FILES:**
- `apps/web/lib/notifications/push.ts` — receipt polling, `DeviceNotRegistered` branch

**FIX:**
When an Expo push receipt returns `DeviceNotRegistered`, the code does:
```
SELECT token FROM user_push_tokens WHERE user_id = $1
```
This fetches **all** tokens belonging to the user and adds them all to the stale-token purge set. A single dead token (e.g. the user uninstalled the app on one device) silently invalidates every push token the user has across all their devices, stopping all push notifications for that user. The correct behaviour is to remove only the specific token that failed. Store the token alongside the ticket ID when the push batch is sent (e.g. a `ticket_id → token` Redis mapping with a short TTL), then look up only that single token when processing the receipt, or join on `ticket_id` if it is stored in the push tokens table.

---

### 14. BUG-SEC-03 — Expo MMKV offline store stores sensitive data in plaintext

**FILES:**
- `apps/expo/lib/offline/store.ts`

**FIX:**
The MMKV instance is initialised without an `encryptionKey`; the inline comment says "For Phase 1 we leave it unencrypted; encryption will be added in Phase 2". The store persists message drafts and other user state to device storage in plaintext. On a rooted device or via ADB backup on an unlocked device, an attacker can read all MMKV data trivially. Implement encryption: at first launch, generate a random 256-bit key, persist it in the Android Keystore via `react-native-keychain` (or `expo-secure-store`), and pass it to the MMKV constructor as `encryptionKey`. This is a one-line change to MMKV initialisation plus a small secure storage wrapper, and should not be deferred further.

---

### 15. BUG-NOTIF-04 — Nemesis overtake `last_notified_at` misses the nemesis's assignment row

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — nemesis overtake notification section

**FIX:**
After sending overtake triumph notifications, the CRON updates:
```sql
UPDATE nemesis_assignments SET last_notified_at = NOW() WHERE user_id = ANY($1::uuid[])
```
`$1` contains the IDs of the users who just overtook their rivals. The nemesis relationship is stored in `nemesis_assignments` for both parties; the nemesis's own row (`user_id = <nemesis_id>`) also needs `last_notified_at` stamped to prevent repeated notifications. Because only the overtaking users' rows are updated, the nemesis's row retains a stale `last_notified_at` and the next CRON run sends them another triumph notification. Collect the nemesis IDs alongside the user IDs and update both sets in the same statement, or issue a second UPDATE for `WHERE user_id = ANY($nemesisIds)`.

---

### 16. BUG-FIN-01 — Weekly payout CRON applies platform fee twice on creator earnings

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 33, weekly payout aggregation

**FIX:**
The payout aggregation section reads `available_earnings_kobo` from each creator's account, then computes:
```
platformFeeKobo = grossKobo * 0.10
netKobo         = grossKobo - platformFeeKobo
```
`available_earnings_kobo` is the **net** balance — the platform fee (15% or 20% depending on creator tier, per `lib/payments/payouts.ts`) was already deducted when the earnings were credited. Treating the net balance as gross extracts a second 10% platform fee, producing an understated `net_kobo` in the payout record and — critically — an understated Paystack transfer amount if `net_kobo` is used as the transfer value. Fix: use `grossKobo` directly as `netKobo` (no second fee deduction), or, if a separate weekly processing fee is intended by the PRD, document it clearly, apply the correct tier-based rate from `getCreatorFeeRate`, and update the earnings credit step to explain the fee lifecycle.

---

### 17. BUG-DB-04 — Alliance war `ON CONFLICT DO NOTHING` is inert (no matching unique constraint)

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — Section 32b, next-week alliance war creation
- `apps/web/lib/db/schema.ts` — `allianceWars` table

**FIX:**
The next-week war INSERT uses `ON CONFLICT DO NOTHING`. The `alliance_wars` table has no unique constraint on `(alliance_1_id, alliance_2_id)` or `(alliance_1_id, alliance_2_id, scheduled_week)`. Without a matching constraint, PostgreSQL ignores the `ON CONFLICT` clause entirely and inserts a new duplicate war row on every CRON retry. Add a unique constraint — for example `UNIQUE (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week)` to normalise pair ordering — and update the `ON CONFLICT` clause to reference it.

---

### 18. BUG-DB-05 — Duplicate login-streak columns (`login_streak` and `login_streak_days`)

**FILES:**
- `apps/web/lib/db/schema.ts` — `users` table

**FIX:**
The `users` table defines two separate integer columns — `loginStreak` and `loginStreakDays` — that model the same concept (consecutive daily login count). Different CRON sections and user-event handlers likely update one or the other (or both), causing them to drift out of sync. A user whose streak is shown from `loginStreakDays` may see a different value than one computed from `loginStreak`, breaking streak milestones, quest triggers, and UI display. Audit all read/write sites for both columns, select the canonical one (recommend `login_streak_days` as the more descriptive name), write a migration to consolidate values and drop the redundant column, then fix all references.

---

### 19. BUG-SEC-04 — Legacy v1 field encryption uses bare SHA-256 as the KDF

**FILES:**
- `apps/web/lib/security/fieldEncryption.ts` — v1 key derivation path

**FIX:**
Version 1 of the field-encryption scheme derives the AES-256 key by computing a single SHA-256 hash of the master key material — no salt, no iteration count, no memory hardening. This makes it trivially fast for an attacker who obtains ciphertext to brute-force the key offline. Version 2 correctly uses scrypt with a per-ciphertext random salt. While v1 is kept only for decrypting existing ciphertext and all new writes use v2, there is an unknown volume of v1-encrypted data at risk. Schedule a background migration job that: (1) SELECT all rows with a `v1:` ciphertext prefix, (2) decrypt with v1, (3) re-encrypt with v2, (4) UPDATE in a transaction, (5) after full migration, remove the v1 decryption path from code. Until migration is complete, ensure the master encryption key is stored in a hardware-backed secret store (e.g. Doppler, AWS Secrets Manager) to raise the bar for obtaining the key.

---

## Post-Fix Rating

Applying all 19 fixes would raise the overall rating to approximately **9.2 / 10**. The financial double-fee bug (BUG-FIN-01) and the CSRF login break (BUG-CSRF-01) should be treated as P0 — they are active money and auth correctness issues. The notification deduplication bugs (BUG-NOTIF-01 through BUG-NOTIF-04) are P1 as they directly degrade user experience at scale. All database constraint bugs (BUG-DB-01 through BUG-DB-05) are P1 as they can silently corrupt data under retry conditions. Security hardening bugs (BUG-SEC-01 through BUG-SEC-04) are P2 but should not be deferred indefinitely.

---

*Report generated: June 16, 2026 · 5:11 AM UTC*
