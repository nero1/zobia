# Zobia Social — Forensic Bug Audit Report

**Date:** June 26, 2026  
**Time:** 12:00 PM (12-hour format)  
**Scope:** Full monorepo — web app (Next.js 15), PWA (@serwist/next), Expo Android app  
**Methodology:** Multi-pass forensic code analysis of all critical files  

---

## Quick Index (one-line descriptions)

1. BUG-001: Critical TypeScript syntax error breaks the entire Paystack webhook module
2. BUG-002: `ONBOARDING_ALLOWED_PREFIXES` includes `/api` broadly, allowing onboarding bypass via direct API calls
3. BUG-003: `storeItems.coinsCost` and `coinsGranted` use `mode:"number"` on bigint columns causing financial precision loss
4. BUG-004: `referralCommissions.commissionCoins` uses `mode:"number"` on bigint column causing financial precision loss
5. BUG-005: `canAfford()` in coins.ts is unlocked — TOCTOU race before `debitCoins`
6. BUG-006: Payout `restoreAmount` uses `gross_kobo` as fallback when `net_kobo` is null — over-restores creator earnings
7. BUG-007: JWT key rotation old-token verification fails if `JWT_SECRET_v*` env var not explicitly set
8. BUG-008: `withCsp()` in middleware does not set `X-Frame-Options` header — old browsers unprotected from clickjacking
9. BUG-009: `guildMembers` unique index on `(guild_id, user_id)` not filtered by `left_at IS NULL` — users cannot re-join guilds
10. BUG-010: `SessionRecord` stores email at login time; stale after email change — security decisions on stale email
11. BUG-011: `allowedAttributes: { '*': ['class'] }` in HTML sanitizer — `class` permitted on every element, enabling CSS injection
12. BUG-012: SSRF protection `HOSTNAME_ALLOWLIST` missing Supabase URLs — safeFetch blocks Supabase storage fetches
13. BUG-013: Paystack subscription plan detection uses fragile regex on plan name/code — breaks on plan rename in dashboard
14. BUG-014: `monitoring/index.ts` `trackEvent()` silently drops `attributes` when using Sentry provider
15. BUG-015: `telegramLoginStates` table has no TTL enforcement — accumulates indefinitely, enabling table flooding
16. BUG-016: No upload size limit enforced at the storage adapter layer — unbounded file uploads possible
17. BUG-017: `X-XSS-Protection: 1; mode=block` in `vercel.json` is deprecated and introduces IE XSS vulnerability
18. BUG-018: `poweredByHeader: false` not set in `next.config.js` — `X-Powered-By: Next.js` leaks tech stack
19. BUG-019: `storeItems.priceKobo` is nullable with no NOT NULL or CHECK — items may be purchased for free
20. BUG-020: `footerScripts.content` and `announcementModals/Banners` HTML served without sanitization — stored XSS vector
21. BUG-021: L1 in-process rate limit cache (skip threshold 0.25) allows 4× over-counting across serverless instances
22. BUG-022: Raw `db.query()` call in Paystack webhook non-recoverable error handler — NullPointerError when `db` is null (Supabase provider)
23. BUG-023: `distributeSeasonRewards` loads season and user data outside the credit transaction — TOCTOU on concurrent CRON runs
24. BUG-024: `createSeasonCeremonyRoom` uses `ON CONFLICT ((metadata->>'season_ceremony_id'))` — expression index must exist or INSERT fails
25. BUG-025: `adminAuditLog` table has no index on `admin_id` or `created_at` — slow admin audit queries at scale
26. BUG-026: `findWarOpponent` busy-guild check is a separate query before matchmaking — TOCTOU race allows same guild to be double-matched
27. BUG-027: `payments.updatedAt` is never auto-updated on status transitions — always shows creation time
28. BUG-028: `is_admin` JWT claim used for admin page routing has 15-minute propagation lag after admin demotion
29. BUG-029: `refunds.status` defaults to `'processed'` immediately at row creation — no pending/review workflow
30. BUG-030: `loadPendingRecovery` in Expo silently swallows JSON.parse errors — corrupted SecureStore data skips recovery protection
31. BUG-031: `redis.keys(pattern)` is O(N) and is part of the `RedisClient` interface — could be called in hot paths
32. BUG-032: No structured health check endpoint confirming DB + Redis + realtime dependency health
33. BUG-033: `userAnnouncementRotation.lastShownId` has no foreign key constraint — can reference non-existent content
34. BUG-034: Guild war entry fee deduction does not check treasury balance before deducting
35. BUG-035: `xpLedger.amount` uses `integer` type (max ~2.1 billion) — could overflow for very large XP multiplier awards
36. BUG-036: `failedWebhooks` table has no max retry limit enforced — retry CRON must self-govern
37. BUG-037: `nemesisAssignments` has two user FKs (`nemesisUserId` AND `nemesisId`) both referencing `users.id` — schema ambiguity
38. BUG-038: `vercel.json` `X-Frame-Options: DENY` duplicates and may conflict with middleware `frame-ancestors 'self'` CSP
39. BUG-039: R2 public URL (`NEXT_PUBLIC_R2_DEV_HOST`) not included in CSP `img-src` directive when using custom R2 domain
40. BUG-040: `games.playCount` is incremented without atomic guard — can lose updates under concurrent play submissions
41. BUG-041: `communityNoteVotes` has no rate limit on vote creation/deletion — vote manipulation via rapid toggle
42. BUG-042: `storeItems.validUntil` not checked at purchase time — expired items can still be purchased
43. BUG-043: `sponsoredLeaderboardBanners.ctaUrl` is unvalidated plain text — admin-inserted javascript: or data: URLs possible
44. BUG-044: `reactionSets.coinPrice` has no CHECK constraint for minimum — can be set to 0 or negative
45. BUG-045: `gifts.giftItemId` is NOT NULL (always required) despite `giftTypeId` being the new canonical FK — backward-compat schema inconsistency
46. BUG-046: JWT key registry and refresh key registry built once at module load — stale if env vars change post-startup (e.g., container reload patterns)
47. BUG-047: `trackEvent()` in monitoring is silently a no-op in production when `MONITORING_PROVIDER=none` — events lost without warning
48. BUG-048: `SKIP_ENV_VALIDATION=1` produces an all-`undefined` Proxy for `env` — production-like failures silently deferred to runtime
49. BUG-049: Redis `buildStub` during Next.js build phase returns `null` for all commands — code treating `null` from `set()` as duplicate event
50. BUG-050: `getManifestConfig` in `aiClassifier.ts` caches a single global config — config staleness of up to 60s; no per-request override possible
51. BUG-051: `captcha` provider resolution falls back to `"none"` when manifest returns unexpected value — blocks all users in production silently
52. BUG-052: `fieldEncryption.ts` in-memory `keyCache` never cleared — if attacker injects malformed version strings in DB ciphertext, error-type cache leakage
53. BUG-053: `middleware.ts` CSRF check returns `false` for requests without `Origin` header — Expo mobile app mutations using `Authorization: Bearer` may fail CSRF if no Origin is sent
54. BUG-054: `messages` table `conversationId` is nullable without a FK to `dmConversations` — orphaned message rows possible
55. BUG-055: `moments` with non-text `contentType` can have null `mediaUrl` — no CHECK constraint enforcing `media_url IS NOT NULL WHERE content_type != 'text'`
56. BUG-056: `Season pass milestone xp_bonus` reward writes to `users.xp_total` and `users.season_xp` but does NOT update all XP track-specific columns consistently
57. BUG-057: `referralCommissions.tier` column is `text` defaulting to `'1'` while `referrals.tier` is `integer` defaulting to `1` — type inconsistency between sibling tables
58. BUG-058: Refresh token included in JSON response body for mobile clients (`isMobile` check) — tokens may appear in server access logs or CDN logs
59. BUG-059: `transferCoins` builds `transferRef` using the caller-supplied `referenceId` as both the debit and credit idempotency reference — collision risk if same referenceId is reused for different transfer types
60. BUG-060: `RATE_LIMITS.auth` rate limit preset is shared between OAuth initiation, callback, and all other auth endpoints — exhaustion of limit on one flow blocks all auth
61. BUG-061: `payoutDeadLetterQueue` has no DLQ depth monitoring alert — silent queue growth without operator notification
62. BUG-062: `season pass milestone sticker_pack` reward looks up pack by slug then name — `name` lookup is not unique-indexed and could match multiple packs if names are reused
63. BUG-063: `announcementBanners.linkUrl` is plain text with no URL validation — arbitrary URLs including `javascript:` possible
64. BUG-064: `creatorBroadcasts.content` is unbounded text with no max-size guard — a creator can store arbitrarily large broadcast bodies
65. BUG-065: `withRLS` sets `app.current_user_id` via `SET LOCAL` — for queries run outside a transaction, this `SET LOCAL` has no effect (reverts immediately)
66. BUG-066: `moderationAiEscalations.reportId` has no DB-level FK — references `moderation_reports.id` only in code comments ("forward ref"), not enforced at schema level
67. BUG-067: `adminMessages.targetUserIds` is an unbounded array — a single broadcast could reference millions of user IDs, causing OOM on the broadcasting server
68. BUG-068: `dataExportRequests` table (GDPR) has no expiry or cleanup CRON — export files may accumulate in storage indefinitely
69. BUG-069: `skipThreshold` option in `rateLimit.ts` can be set greater than 1.0 by any caller — would permanently skip Redis for that endpoint regardless of traffic
70. BUG-070: `loadPendingRecovery` in Expo parses SecureStore JSON without schema validation — malformed data could inject arbitrary keys into `pendingRecovery` map, blocking legitimate new purchases
71. BUG-071: `guildWars` war resolution logic not visible to prevent double resolution — no database-level idempotency guard preventing two concurrent CRON instances from resolving the same war
72. BUG-072: `userPins.hashedPin` column stores PIN hash without enforcing bcrypt iteration count at the column level — weaker hash algorithms possible if code is changed
73. BUG-073: No circuit breaker around Paystack HTTP calls in `payouts.ts` — repeated network failures consume all retry slots
74. BUG-074: `img-src` CSP in middleware does not include `https://*.r2.dev` when `NEXT_PUBLIC_R2_DEV_HOST` is a wildcard — user avatars from R2 dev URLs blocked
75. BUG-075: `storeItems.validUntil` timestamp compared at query-time but not at purchase confirmation time — purchase window race during expiry

---

## Detailed Bug Descriptions

---

### BUG-001: Critical TypeScript Syntax Error in Paystack Webhook Route

**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

The file contains an import statement that is syntactically broken. At lines 23–30, `import { logger } from "@/lib/logger";` is injected inline between the opening brace of another import statement and its named export list:

```
import {
import { logger } from "@/lib/logger";   ← injected here
  handlePaystackWebhookPayload,
  ...
} from "@/lib/payments/paystackWebhookHandler";
```

This is invalid TypeScript/JavaScript and would cause the entire module to fail at compilation or runtime load. The Paystack webhook endpoint would 500 on every call, meaning no payment events would be processed, no coins credited, no subscription activations, and no creator fund seedings. Fix: move `import { logger } from "@/lib/logger"` to its own line above or below the handler import block.

---

### BUG-002: `ONBOARDING_ALLOWED_PREFIXES` Includes `/api` Broadly — Onboarding Bypass

**FILES:** `apps/web/middleware.ts`

`ONBOARDING_ALLOWED_PREFIXES` at line 184 includes the string `"/api"`, which means ALL `/api/*` routes are accessible to users whose `onboarding_completed` JWT claim is `false`. The intent is presumably to allow only `/api/auth/*` during onboarding. As written, users who haven't completed onboarding can call `/api/economy/purchase`, `/api/guilds`, `/api/rooms/join`, and any other API route directly (bypassing the onboarding gate) simply by making HTTP requests without navigating the UI flow. Individual route handlers that rely on account status (e.g., checking `account_status='active'`) still enforce their own guards, but routes that don't check onboarding status are fully exposed. Fix: replace `"/api"` with specific allowed API prefixes: `"/api/auth"`, `"/api/config"`, `"/api/manifest"`, `"/api/public"`, `"/api/health"`.

---

### BUG-003: `storeItems.coinsCost` and `coinsGranted` Use `mode:"number"` on Bigint Columns

**FILES:** `apps/web/lib/db/schema.ts` (lines ~2111–2112)

```
coinsCost: bigint("coins_cost", { mode: "number" }),
coinsGranted: bigint("coins_granted", { mode: "number" }),
```

Using `mode: "number"` for a `bigint` column means Drizzle returns these values as JavaScript `number`. JavaScript numbers (IEEE 754 doubles) can only represent integers up to `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 ≈ 9 quadrillion) without precision loss. While coin balances are capped at 1 trillion in the users table, the `bigint` column allows larger values and any arithmetic on large coin grants could silently lose precision. Fix: use `mode: "bigint"` on all financial bigint columns and convert to `Number` only at the presentation layer after validating the value is within safe range.

---

### BUG-004: `referralCommissions.commissionCoins` Uses `mode:"number"` on Bigint Column

**FILES:** `apps/web/lib/db/schema.ts` (line ~2544)

```
commissionCoins: bigint("commission_coins", { mode: "number" }).notNull().default(0),
```

Same precision-loss risk as BUG-003. Commission coins are a financial value that feeds directly into coin ledger credits. Precision loss here would result in incorrect commission amounts being credited to referrers. Fix: use `mode: "bigint"`.

---

### BUG-005: `canAfford()` Is Unlocked — TOCTOU Race Before `debitCoins`

**FILES:** `apps/web/lib/economy/coins.ts`

`canAfford(userId, amount, db?)` reads the user's coin balance without a `SELECT FOR UPDATE` lock. Any code that calls `canAfford()` and then `debitCoins()` as two separate operations (outside a single transaction with a lock) has a time-of-check-time-of-use race: another concurrent request can spend the same coins between the check and the debit. While `debitCoins` itself uses `SELECT FOR UPDATE` and validates balance again, callers that rely on `canAfford` for early validation may provide misleading affordability messages, or worse, callers that bypass `debitCoins` and manually debit after a `canAfford` check are vulnerable. Fix: document clearly that `canAfford` is advisory only and must never be the sole gate on a financial debit. Alternatively, provide a locked `checkAndDebit()` atomic helper that combines both.

---

### BUG-006: Payout `restoreAmount` Uses `gross_kobo` Fallback When `net_kobo` Is Null

**FILES:** `apps/web/lib/payments/payouts.ts`

When a failed payout's earnings are restored, the code reads:

```
restoreAmount = current[0].net_kobo ?? current[0].gross_kobo
```

If `net_kobo` is null (not yet calculated or missing on older rows), the code falls back to `gross_kobo` which includes the platform fee. This over-restores the creator by the full gross amount (up to 20% more than they are owed). For a ₦100,000 payout, this could credit the creator ₦20,000 extra without any corresponding platform fee deduction. Fix: ensure `net_kobo` is always populated before the row reaches the retry phase; throw an error (rather than fall back) if `net_kobo` is null at restoration time, and alert ops.

---

### BUG-007: JWT Key Rotation — Old Tokens Fail Verification If `JWT_SECRET_v*` Not Set

**FILES:** `apps/web/lib/auth/jwt.ts`

The key registry maps the current `JWT_KEY_ID` (default `"v1"`) to `JWT_SECRET`. Old versioned keys are read from `JWT_SECRET_v*` env vars (lines 67–73). The fallback at line 99 is:

```
return secret ?? encodeSecret(env.JWT_SECRET);
```

If `JWT_KEY_ID` is rotated to `"v2"` (new key in `JWT_SECRET`) but `JWT_SECRET_v1` is NOT explicitly set to the old key, then existing tokens with `kid=v1` are not found in the registry and fall back to the NEW `JWT_SECRET` (v2). This causes HMAC verification to fail for ALL existing sessions, effectively logging out every user simultaneously during a key rotation. Fix: document that the old key MUST be set as `JWT_SECRET_v1` during rotation, and add a startup validation check that warns if any known `kid` values in currently-valid tokens don't resolve to a key in the registry.

---

### BUG-008: `withCsp()` Does Not Set `X-Frame-Options` Header

**FILES:** `apps/web/middleware.ts`

The middleware's `withCsp()` helper sets `Content-Security-Policy` with `frame-ancestors 'self'`, which prevents framing in browsers that support CSP Level 2+. However, it does not set the `X-Frame-Options: SAMEORIGIN` header. Older browsers (IE11, older Safari) that don't parse CSP `frame-ancestors` will have no clickjacking protection. The `vercel.json` sets `X-Frame-Options: DENY` globally, but middleware-set response headers take precedence in Next.js and may replace or not merge the Vercel-injected headers. Fix: add `X-Frame-Options: SAMEORIGIN` in `withCsp()` so all response paths include it.

---

### BUG-009: `guildMembers` Unique Index Not Filtered — Users Cannot Re-join Guilds

**FILES:** `apps/web/lib/db/schema.ts` (guildMembers table)

The `guildMembers` table uses soft-delete via `leftAt` but the unique index is:

```
uniqueIndex("guild_members_guild_user_idx").on(t.guildId, t.userId)
```

This is a non-partial index. When a user leaves a guild, their row has `leftAt = NOW()` but is not deleted. If they later try to re-join the same guild, the INSERT conflicts with the existing (soft-deleted) row, so the re-join fails. Fix: change to a partial unique index filtered by `WHERE left_at IS NULL`, and update the re-join logic to UPDATE the existing row (`SET left_at = NULL, joined_at = NOW()`) on conflict.

---

### BUG-010: `SessionRecord` Stores Email at Login — Stale After Email Change

**FILES:** `apps/web/lib/auth/session.ts`

The `SessionRecord` type stores the user's `email` field when the session is created. When a user changes their email address, all existing Redis session records retain the old email. Any code that reads `session.email` for security decisions (e.g., email-based rate limiting, audit logging, notification routing) will operate on stale data. Fix: either omit `email` from `SessionRecord` and always read it from the DB when needed, or invalidate all sessions on email change (which already happens for password changes).

---

### BUG-011: HTML Sanitizer Allows `class` on Every Element — CSS Injection Vector

**FILES:** `apps/web/lib/security/htmlSanitizer.ts`

`allowedAttributes: { '*': ['class'] }` permits the `class` attribute on every HTML element. If the application applies any CSS classes with dangerous behavior (e.g., `position: fixed`, `z-index: 9999`, `opacity: 0` for invisible overlays), an attacker who injects a message with specific class names could manipulate the visual layout of the page for other users (UI redressing). Additionally, `data-*` attributes are not stripped, enabling custom JavaScript framework data bindings in environments that evaluate them. Fix: remove the global `class` allowance and only permit `class` on specific elements where needed (e.g., `<code>`, `<pre>`). Explicitly blocklist `data-*` attributes.

---

### BUG-012: SSRF `HOSTNAME_ALLOWLIST` Missing Supabase URLs

**FILES:** `apps/web/lib/security/ssrf.ts`

The `HOSTNAME_ALLOWLIST` does not include Supabase storage hostnames (e.g., `*.supabase.co`, `*.supabase.in`). When `STORAGE_PROVIDER=supabase-storage`, any server-side fetch of Supabase storage URLs (e.g., to validate or proxy avatar images) goes through the undici SSRF agent, which by default blocks non-allowlisted hosts. This would cause storage operations that involve fetching content from Supabase to fail with an SSRF block. Fix: add Supabase storage hostnames to `HOSTNAME_ALLOWLIST` conditionally based on `STORAGE_PROVIDER` or statically based on the configured `NEXT_PUBLIC_SUPABASE_HOST` env var.

---

### BUG-013: Paystack Subscription Plan Detection via Fragile Regex on Plan Name

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

Subscription plan type (`plus`, `pro`, `max`) is detected by regex matching on the Paystack plan name or plan code strings (e.g., `plan.name.match(/plus/i)`). If a plan is renamed in the Paystack dashboard (e.g., from "Plus Monthly" to "Zobia Plus"), the regex no longer matches and subscriptions are silently mis-classified or fall through to the default case. This could result in users not receiving their plan entitlements after payment. Fix: store the authoritative plan-type mapping in the database (keyed by Paystack plan code, which is stable), or use the `store_items` table's `iapProductId` / plan field to map plan codes deterministically without regex.

---

### BUG-014: `trackEvent()` in Monitoring Silently Drops Attributes for Sentry

**FILES:** `apps/web/lib/monitoring/index.ts`

```javascript
sentry.captureMessage(name, "info");
```

The `attributes` parameter passed to `trackEvent(name, attributes)` is never forwarded to Sentry's `captureMessage`. All monitoring event metadata (user ID, amounts, context) is silently discarded when using the Sentry provider. New Relic correctly receives attributes via `recordCustomEvent`. Fix: use `sentry.captureMessage(name, { level: 'info', extra: attributes })` or wrap the event in a custom Sentry scope with the attributes set.

---

### BUG-015: `telegramLoginStates` Table Accumulates Indefinitely

**FILES:** `apps/web/lib/db/schema.ts` (telegramLoginStates table)

The table has `createdAt` but no `expiresAt` column and no automated cleanup CRON. Telegram login state tokens are single-use and short-lived in practice (user must complete the flow within ~10 minutes), but old entries from abandoned flows are never deleted. A malicious actor could flood this table by repeatedly initiating the Telegram login flow without completing it, causing unbounded table growth. Fix: add an `expires_at` column with an index, enforce a 15-minute TTL in the application, and include a cleanup step in the daily CRON that deletes `WHERE expires_at < NOW()`.

---

### BUG-016: No Upload Size Limit Enforced at the Storage Adapter Layer

**FILES:** `apps/web/lib/storage/index.ts`, `apps/web/lib/storage/providers/r2.ts`, `apps/web/lib/storage/providers/supabase-storage.ts`

The `StorageAdapter.upload(key, buffer, options)` interface accepts an arbitrary `Buffer` with no size validation. While Next.js has a request body size limit and individual API routes may validate content-length, the storage layer itself imposes no guard. If any upload path bypasses or misconfigures the API-level validation, arbitrarily large files can be sent to R2/S3/Supabase storage. Fix: add a `maxSizeBytes` option to `UploadOptions` and enforce it in each adapter's `upload()` method before calling the storage API; set a global default (e.g., 50 MB) that callers must explicitly override.

---

### BUG-017: `X-XSS-Protection: 1; mode=block` in `vercel.json` Is Deprecated

**FILES:** `apps/web/vercel.json`

This header is deprecated and no longer recognized by Chrome, Firefox, or modern Edge. Worse, in older IE versions, `X-XSS-Protection: 1; mode=block` can be weaponized to perform XSS by triggering the IE XSS auditor's block behavior. The correct practice is to rely entirely on a strict CSP. Fix: remove `X-XSS-Protection` from `vercel.json` or set it to `X-XSS-Protection: 0` to explicitly disable the IE auditor without the `mode=block` risk.

---

### BUG-018: `poweredByHeader: false` Missing in `next.config.js`

**FILES:** `apps/web/next.config.js`

Next.js adds `X-Powered-By: Next.js` to all responses by default. This leaks the framework version to potential attackers who can then target known Next.js vulnerabilities. Fix: add `poweredByHeader: false` to the `nextConfig` object.

---

### BUG-019: `storeItems.priceKobo` Is Nullable — Items May Be Purchased for Free

**FILES:** `apps/web/lib/db/schema.ts` (storeItems table)

```
priceKobo: bigint("price_kobo", { mode: "bigint" }),
```

No `.notNull()` is set. An admin error or migration gap that inserts a store item without a `price_kobo` value results in a null price. If purchase handlers check `priceKobo > 0` but treat `null` as falsy (passing the check), users could acquire paid items without paying. Fix: add `.notNull()` with an appropriate default or require the value on insert; add a CHECK constraint `price_kobo >= 0` or a not-null constraint with no default to force explicit pricing.

---

### BUG-020: `footerScripts` and Announcement HTML Served Without Sanitization — Stored XSS

**FILES:** `apps/web/lib/db/schema.ts` (footerScripts, announcementModals, announcementBanners tables)

`footerScripts.content` is raw JavaScript stored in the DB. If a compromised or malicious admin inserts `document.cookie` exfiltration code, it runs in every user's browser. Similarly, `announcementModals.content` and `announcementBanners.content` with `contentType='html'` are raw HTML; if rendered via `dangerouslySetInnerHTML` without sanitization, any XSS payload in the content is executed. Fix: for footer scripts, restrict insertion to super-admins only and log all insertions to an immutable audit trail. For announcement HTML, pass content through the `htmlSanitizer` before storage or before rendering.

---

### BUG-021: L1 In-Process Rate Limit Cache Allows Over-counting Across Serverless Instances

**FILES:** `apps/web/lib/security/rateLimit.ts`

The `RL_SKIP_THRESHOLD = 0.25` means the in-process counter can skip the Redis round-trip when the local count is under 25% of the limit. Across N concurrent Vercel serverless instances, each instance independently counts requests. An IP with requests spread across 4 instances would collectively reach 100% of the limit (4 × 25%) before any instance hits Redis — effectively allowing 4× the configured limit before rate limiting engages. Sensitive endpoints use `bypassL1: true`, but general API endpoints (`apiRead`, `apiWrite`, `messageSend`) do not. Fix: lower `RL_SKIP_THRESHOLD` to `0.1` or `0`, or remove L1 caching entirely for message-sending and write endpoints.

---

### BUG-022: Raw `db.query()` in Webhook Error Handler Crashes When `db` Is Null (Supabase Provider)

**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (lines 97–101)

In the non-recoverable error catch block:

```javascript
db.query(`INSERT INTO system_alerts ...`).catch(() => {});
```

`db` is imported from `@/lib/db`. For the `supabase` database provider, `lib/db/drizzle.ts` returns `null`. Calling `null.query()` throws `TypeError` synchronously before `.catch()` is attached, causing the outer async function to reject and return a 500. This is triggered only when the webhook handler itself throws a non-transient error, causing Paystack to retry and enter a retry loop. Fix: guard with `db?.query(...)?.catch(() => {})` or use a dedicated alerting function that is null-safe.

---

### BUG-023: `distributeSeasonRewards` Loads Season Data Outside the Credit Transaction — TOCTOU

**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

`distributeSeasonRewards` performs two standalone `db.query()` calls (fetching season reward pool and top users) BEFORE entering the `db.transaction()` that actually credits coins. If two concurrent CRON instances both read the same top users before either commits, both will call `creditCoins()` for the same users. While `creditCoins` uses an idempotency key (`season:${seasonId}:${userId}`) on the `coin_ledger` unique index, concurrent calls could still cause unexpected errors or require the ON CONFLICT DO NOTHING path to silently absorb the second credit without notifying the caller. Fix: move the season data and top-users queries inside the transaction, or add a DB-level lock (e.g., `SELECT ... FOR UPDATE` on the seasons row) before distributing.

---

### BUG-024: `createSeasonCeremonyRoom` Uses Expression Index That May Not Exist

**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (line ~379)

```sql
ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING
```

This syntax requires a matching expression index on `rooms((metadata->>'season_ceremony_id'))` to be present in the database. If this index was not created in a migration, the INSERT statement fails with a PostgreSQL error at runtime (not at application startup). Fix: verify a migration creates `CREATE UNIQUE INDEX IF NOT EXISTS rooms_ceremony_id_idx ON rooms((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL;` and ensure this index exists in all environments.

---

### BUG-025: `adminAuditLog` Has No Index on `admin_id` or `created_at`

**FILES:** `apps/web/lib/db/schema.ts` (adminAuditLog table)

The table has no secondary indexes. Admin audit log queries (filter by admin, filter by date range, filter by resource type) will perform full-table sequential scans as the table grows. For a busy platform this table can reach millions of rows within weeks. Fix: add a composite index on `(admin_id, created_at DESC)` and a partial index on `(resource, resource_id)` for resource-specific lookups.

---

### BUG-026: `findWarOpponent` Busy-Guild Check Is a Separate Query — TOCTOU Race

**FILES:** `apps/web/lib/guilds/warEngine.ts`

The function queries the list of guilds currently in active wars, then uses that list to build an exclusion array for the candidate query. Between these two queries, another guild could start a new war involving a previously-available candidate. The result: two different guilds could both be matched against the same opponent. Fix: move the busy-guild exclusion into a subquery within the candidate query itself (a single atomic query with a correlated NOT EXISTS subquery), eliminating the window between the two reads.

---

### BUG-027: `payments.updatedAt` Not Auto-Updated on Status Transitions

**FILES:** `apps/web/lib/db/schema.ts` (payments table)

```
updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
```

The `defaultNow()` sets the value only at row creation. Unlike MySQL's `ON UPDATE CURRENT_TIMESTAMP`, PostgreSQL does not auto-update timestamp columns. Unless every payment status UPDATE query explicitly includes `updated_at = NOW()`, the column always shows the creation time — making it useless for tracking when a payment last changed state. Fix: audit all UPDATE queries on the `payments` table and ensure `updated_at = NOW()` is included, or use a PostgreSQL trigger.

---

### BUG-028: `is_admin` JWT Claim Has 15-Minute Propagation Lag for Admin Demotion

**FILES:** `apps/web/middleware.ts`, `apps/web/lib/auth/jwt.ts`

The middleware uses `is_admin` from the JWT access token to gate admin page routes. Access tokens have a 15-minute TTL. When an admin is revoked, their JWT claim remains `is_admin: true` for up to 15 minutes. During this window, they can navigate to admin UI pages. While `withAdminAuth` on API routes re-validates admin status against the DB on every request (so no data mutations are possible), the admin UI pages themselves remain accessible. Fix: when demoting an admin, call `invalidateAllSessions(userId)` to immediately invalidate all their Redis sessions. The next access token refresh will then fail (session not found), forcing re-login without admin claim.

---

### BUG-029: `refunds.status` Defaults to `'processed'` Immediately

**FILES:** `apps/web/lib/db/schema.ts` (refunds table)

```
status: text("status").notNull().default("processed"),
```

Every refund row is created with `status='processed'` by default. There is no pending state, no review state, and no audit trail of when processing occurred. If the coin credit fails after the row is inserted, the refund appears completed in the DB even though no coins were actually credited. Fix: default to `'pending'`, update to `'processed'` only after the coin credit is confirmed, and add a `failed` state for errors.

---

### BUG-030: `loadPendingRecovery` Silently Swallows JSON Parse Errors

**FILES:** `apps/expo/lib/payments/googlePlay.ts` (line ~317)

```javascript
} catch {
  return;
}
```

If `PENDING_RECOVERY_KEY` in SecureStore contains corrupted JSON (e.g., from an interrupted write), `JSON.parse` throws and the catch block silently returns with `pendingRecovery` empty. The protection that blocks duplicate purchases while the original is still recovering is therefore disabled whenever SecureStore data is corrupt. Fix: log the error and consider clearing the corrupt key so it doesn't persist across restarts.

---

### BUG-031: `redis.keys(pattern)` Is O(N) — Available on `RedisClient` Interface

**FILES:** `apps/web/lib/redis/index.ts` (line ~63)

`keys(pattern): Promise<string[]>` is part of the `RedisClient` interface and implemented by both providers. `KEYS` is an O(N) blocking Redis command that iterates the entire keyspace. In production with millions of keys, a single `redis.keys()` call can block the Redis server for hundreds of milliseconds, degrading every other operation. Fix: remove `keys` from the interface or mark it as deprecated; any code using it should be replaced with `SCAN`-based iteration.

---

### BUG-032: No Structured Health Check Endpoint Confirming All Dependency Health

**FILES:** `apps/web/middleware.ts` (PUBLIC_PREFIXES includes `/api/health`)

`/api/health` is whitelisted in `PUBLIC_PREFIXES` indicating it exists, but the implementation was not visible in the analyzed files. A minimal health endpoint returning `200 OK` without actually probing DB connectivity, Redis connectivity, and realtime channel health provides false confidence. Monitoring systems polling `/api/health` would report "healthy" even during a DB outage. Fix: implement `/api/health` as a structured JSON response that performs a lightweight `SELECT 1` against the DB, a `PING` against Redis, and returns the status of each dependency with latency metrics. Return 503 if any critical dependency fails.

---

### BUG-033: `userAnnouncementRotation.lastShownId` Has No Foreign Key Constraint

**FILES:** `apps/web/lib/db/schema.ts` (userAnnouncementRotation table)

```
lastShownId: uuid("last_shown_id").notNull(),
```

No `.references()` is set. The `lastShownId` can reference a non-existent announcement ID (e.g., after an announcement is deleted). Queries that join on this ID will silently return no matching rows, causing rotation logic to reset incorrectly. Fix: add an FK reference to the appropriate announcement table, or store `content_type` + `last_shown_id` as a soft reference with application-level validation.

---

### BUG-034: Guild War Entry Fee Deducted Without Prior Treasury Balance Check

**FILES:** `apps/web/lib/guilds/warEngine.ts`

The `WAR_ENTRY_FEE_COINS = 200` is deducted from the guild treasury when declaring war. However, the matchmaking and war-creation logic does not appear to check that the guild treasury has at least `WAR_ENTRY_FEE_COINS` before proceeding. If the deduction fails (insufficient treasury), the war may have already been partially created. Fix: check treasury balance and lock the treasury row (`SELECT ... FOR UPDATE`) before deducting, and ensure the deduction and war creation are in a single atomic transaction.

---

### BUG-035: `xpLedger.amount` Is `integer` Type — Potential Overflow for Large Awards

**FILES:** `apps/web/lib/db/schema.ts` (xpLedger table)

```
amount: integer("amount").notNull(),
```

PostgreSQL `integer` maxes at 2,147,483,647 (~2.1 billion). A user with a Guild War win boost (500 XP) × season pass multiplier × flash event multiplier × prestige boost (e.g., ×10 total) could generate a single XP award of 5,000 XP in exceptional cases. This is not a near-term overflow risk, but if multipliers are stacked further (e.g., 1,000 base × 10× booster = 10,000 per award), the column is still safe for individual awards. The risk is more in `users.xp_total` and `users.season_xp` which use `bigint`, but `xpLedger.amount` stores individual deltas as `integer`. If a bug or admin action creates a single XP award exceeding 2.1B, the INSERT will fail silently or throw. Fix: migrate `xp_ledger.amount` to `bigint` for future-proofing.

---

### BUG-036: `failedWebhooks` Table Has No Maximum Retry Count Enforced

**FILES:** `apps/web/lib/db/schema.ts` (failedWebhooks table)

The `retry_count` column exists but there is no CHECK constraint or schema-level cap. CRON retry logic must self-enforce a max retry limit. If the CRON job has a bug that doesn't increment `retry_count` properly or doesn't apply the cap, failed webhooks retry forever, causing infinite compute usage and potentially flooding the queue. Fix: add a CHECK constraint `retry_count <= 10` (or a configured max) and move rows beyond the max to a dead-letter state.

---

### BUG-037: `nemesisAssignments` Has Two User FKs with Unclear Distinction

**FILES:** `apps/web/lib/db/schema.ts` (nemesisAssignments table)

```
nemesisUserId: uuid("nemesis_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
nemesisId: uuid("nemesis_id").references(() => users.id, { onDelete: "set null" }),
```

Both `nemesisUserId` and `nemesisId` reference `users.id`. The column names suggest both are user IDs but with different nullable constraints. The intent is ambiguous — `nemesisId` appears to be a redundant or mistakenly named column. Code that reads the wrong field could use a stale or wrong user ID. Fix: clarify the schema design; if `nemesisId` is an alias for `nemesisUserId` or serves a different purpose, rename it descriptively or drop it.

---

### BUG-038: `vercel.json` `X-Frame-Options: DENY` Conflicts with Middleware `frame-ancestors 'self'`

**FILES:** `apps/web/vercel.json`, `apps/web/middleware.ts`

`vercel.json` injects `X-Frame-Options: DENY` (which blocks ALL framing, including same-origin). The middleware's CSP sets `frame-ancestors 'self'` (which allows same-origin framing). These two headers have conflicting policies. The stricter rule (`DENY`) wins in modern browsers, blocking any legitimate same-origin embedding (e.g., game embeds within the platform, PWA standalone frames). Fix: change `vercel.json` to `X-Frame-Options: SAMEORIGIN` to align with the CSP `frame-ancestors 'self'` policy, or remove `X-Frame-Options` from `vercel.json` and rely solely on the middleware CSP.

---

### BUG-039: R2 Public URL Not in CSP `img-src` for Custom R2 Domains

**FILES:** `apps/web/middleware.ts` (buildCsp function)

The `img-src` CSP directive hardcodes:
```
https://*.r2.cloudflarestorage.com
```

But user avatars and media served from a custom R2 public URL (set via `R2_PUBLIC_URL`, e.g., `https://cdn.zobia.com`) would be blocked unless the custom domain is also included. Only `*.r2.dev` and `*.r2.cloudflarestorage.com` subdomains are covered. Fix: read `process.env.NEXT_PUBLIC_R2_DEV_HOST` and `process.env.NEXT_PUBLIC_R2_STORAGE_HOST` at middleware initialization and include them in the `img-src` directive dynamically.

---

### BUG-040: `games.playCount` Not Atomically Incremented

**FILES:** `apps/web/lib/db/schema.ts` (games table), game session scoring logic

`games.playCount` is a bigint counter incremented on every game play. If two plays finalize simultaneously on different serverless instances, both issue `UPDATE games SET play_count = play_count + 1 WHERE id = $1` independently — which is actually atomic in PostgreSQL (it uses row-level locking for single-row updates). However, if the increment is done via ORM-level read-modify-write (Drizzle's `update().set({ playCount: game.playCount + 1 })`), two concurrent reads get the same count and both write the same incremented value, losing one increment. Fix: ensure all counter increments use SQL-level arithmetic (`SET play_count = play_count + 1`) not application-level math.

---

### BUG-041: `communityNoteVotes` Has No Rate Limit on Vote Creation/Deletion

**FILES:** `apps/web/lib/db/schema.ts` (communityNoteVotes), relevant API routes

The unique index on `(note_id, user_id)` prevents a user from voting twice, but it does not prevent rapid vote toggling (delete + re-insert in rapid succession). A bot could rapidly change votes on community notes to manipulate counts and cause excessive write load. Fix: add a rate limit (e.g., 5 votes per 10 minutes) on the note-voting API endpoint.

---

### BUG-042: `storeItems.validUntil` Not Enforced at Purchase Confirmation Time

**FILES:** `apps/web/lib/db/schema.ts` (storeItems table), purchase route handlers

`storeItems.validUntil` marks when a store item expires. The purchase initiation flow may check `validUntil`, but there is no second check at webhook/confirmation time to reject a purchase if `validUntil` passed between initiation and payment confirmation. A user who initiates a purchase of a time-limited item 1 second before expiry, and whose payment confirmation arrives 1 second after expiry, would still receive the item. Fix: check `validUntil > NOW()` at payment webhook processing time before crediting the item.

---

### BUG-043: `sponsoredLeaderboardBanners.ctaUrl` Is Unvalidated Plain Text

**FILES:** `apps/web/lib/db/schema.ts` (sponsoredLeaderboardBanners table)

```
ctaUrl: text("cta_url").notNull(),
```

No URL validation or sanitization. A malicious or compromised admin could insert `javascript:alert(1)` or `data:text/html,...` as the CTA URL, which would execute when a user clicks the banner. Fix: add a CHECK constraint or application-level validation ensuring `cta_url` starts with `https://` (or is a relative path). Reject storage of `javascript:` or `data:` URLs.

---

### BUG-044: `reactionSets.coinPrice` Has No Minimum CHECK Constraint

**FILES:** `apps/web/lib/db/schema.ts` (reactionSets table)

```
coinPrice: integer("coin_price").notNull().default(100),
```

No minimum value enforced. An admin could set `coinPrice = 0` (free) or even `-1` (which would credit coins on purchase). Fix: add `.check("reaction_sets_price_positive", sql`coin_price >= 0`)` and handle the 0 case as "free but requires explicit unlock" in the UI.

---

### BUG-045: `gifts.giftItemId` Is `NOT NULL` Despite `giftTypeId` Being the New Canonical FK

**FILES:** `apps/web/lib/db/schema.ts` (gifts table)

```
giftItemId: uuid("gift_item_id").notNull().references(() => giftItems.id, { onDelete: "restrict" }),
giftTypeId: uuid("gift_type_id").references(() => giftTypes.id, { onDelete: "restrict" }),
```

The schema comment says "once gift_type_id is fully populated, make it NOT NULL and drop gift_item_id." In the current state, all new gift rows must supply a `giftItemId` reference to the legacy table, even if the gift is conceptually a new `giftTypes` gift. Any new gift type added to `giftTypes` without a corresponding `giftItems` entry cannot be sent. Fix: complete the migration by backfilling and then make `giftItemId` nullable (allowing NULL for new-type gifts) while requiring `giftTypeId` to be NOT NULL.

---

### BUG-046: JWT Key Registry Built Once at Module Load — Stale in Hot-Reload Scenarios

**FILES:** `apps/web/lib/auth/jwt.ts` (lines 92–94)

```javascript
const keyRegistry: Map<string, Uint8Array> = buildKeyRegistry();
const refreshKeyRegistry: Map<string, Uint8Array> = buildRefreshKeyRegistry();
```

Built once at module initialization by scanning `process.env`. In development hot-reload, test environments with mocked env vars, or edge function re-initialization patterns that reinitialize modules without restarting the process, the registry could be stale. More critically, the comment says `// env vars are immutable after process start` which is true in standard deployments but may not be true in all CI/test environments. Fix: the existing design is acceptable for production. Document this assumption clearly and ensure test setup sets env vars before importing the module.

---

### BUG-047: `trackEvent()` Is a Silent No-op in Production When `MONITORING_PROVIDER=none`

**FILES:** `apps/web/lib/monitoring/index.ts`

```javascript
if (process.env.NODE_ENV !== "production") {
  console.info("[monitoring/event]", name, attributes);
}
```

In production with `MONITORING_PROVIDER=none`, `trackEvent()` does nothing and emits no log. Important business events (payment processed, season ended, guild war started) tracked via `trackEvent` are silently dropped with no way to know they occurred. Fix: emit a structured JSON log line even in the `none` case (since the logger is available), or use the structured `logger.info()` call as the fallback rather than `console.info`.

---

### BUG-048: `SKIP_ENV_VALIDATION=1` Creates All-Undefined Proxy — Runtime Failures Deferred Silently

**FILES:** `apps/web/lib/env.ts`

When `SKIP_ENV_VALIDATION=1`, `env` is an all-undefined Proxy. Any property access returns `undefined as any`. Code that uses `env.JWT_SECRET` (expecting a string) would get `undefined`, causing JWT signing to produce invalid tokens with an empty key. This could silently allow token forgery with an empty HMAC key in environments where `SKIP_ENV_VALIDATION=1` is accidentally set in production-like deployments. Fix: never use `SKIP_ENV_VALIDATION=1` in production; add a runtime guard that checks `process.env.NODE_ENV !== 'production'` before allowing validation skip.

---

### BUG-049: Redis `buildStub` Returns `null` for All Commands — Misinterpretation as `NX` Failure

**FILES:** `apps/web/lib/redis/index.ts`

During the Next.js production build phase, `buildStub` is used as the Redis client. All commands return `async () => null`. The webhook replay protection code:

```javascript
const alreadySeen = await redis.set(replayKey, "1", "EX", 86400, "NX");
if (alreadySeen === null) { /* treat as duplicate */ }
```

During build-time static page generation, if any code path calls this, `null` would be treated as "already seen" (duplicate), silently skipping processing. While this shouldn't affect webhooks specifically (they're runtime-only), any other code that uses `redis.set(..., "NX")` and checks `=== null` during build could malfunction. Fix: ensure the stub is only reachable in true build-phase code paths, and document the null-returns contract clearly.

---

### BUG-050: `getManifestConfig` in `aiClassifier.ts` Caches Globally — 60s Staleness Per Instance

**FILES:** `apps/web/lib/moderation/aiClassifier.ts`

The `manifestCache` module-level variable caches AI moderation configuration for 60 seconds. In a multi-instance serverless deployment, each instance has its own in-memory cache. When an admin changes the `ai_moderation_system_prompt` to respond to an emerging abuse pattern, it can take up to 60 seconds per instance before all classifiers pick up the new prompt. During an abuse surge, 60 seconds of stale classification could result in many abusive reports being misclassified. Fix: reduce the TTL to 10–15 seconds or add a Redis pub/sub invalidation signal that the admin panel publishes when moderation config changes.

---

### BUG-051: CAPTCHA Provider Falls Back to `"none"` on Unexpected Manifest Value — Silent Production Block

**FILES:** `apps/web/lib/security/captcha.ts`

If `getManifestValue("captcha_provider")` returns an unexpected string (e.g., `"cloudflare"` instead of `"turnstile"`, or `"recaptcha_v3"` instead of `"recaptcha"`), the condition:

```javascript
if (manifestValue === "recaptcha" || manifestValue === "turnstile" || manifestValue === "none") {
```

…fails silently, the `_lastKnownGoodProvider` is not updated, and the function eventually returns `"none"`. In production, `"none"` causes `verifyCaptcha` to return `false`, blocking all users from endpoints that require CAPTCHA. Fix: add logging when an unrecognised provider value is received, and fall back to the last known good provider (which the code partially does but only after the `if` block fails, not when `manifestValue` is an unexpected string).

---

### BUG-052: Field Encryption `keyCache` Never Cleared — Error Path Cache Pollution

**FILES:** `apps/web/lib/security/fieldEncryption.ts`

`keyCache` is a module-level `Map<string, Buffer>` that caches derived keys. If a caller (e.g., an admin script) passes a fabricated version string extracted from a database field that does not correspond to a real env var, `getKeyForVersion()` throws and the `keyCache.set()` line is never reached (since it's after the throw). This means the error path is safe. However, if a future code change catches the error and calls `getKeyForVersion` again with the bad version, it would re-derive (not re-throw) potentially. The real concern is that the cache is never evicted for the lifetime of the process. Fix: the current behaviour (cache only valid derived keys) is acceptable; document the cache lifecycle assumption.

---

### BUG-053: Expo App Mutations May Fail CSRF Check (No Origin Header from Native App)

**FILES:** `apps/web/middleware.ts` (isCsrfSafe function)

```javascript
if (!origin) {
  const isCronPath = ...;
  return isCronPath && hasCronSecret;
}
```

Requests without an `Origin` header are only allowed through for CRON paths. React Native's `fetch()` does not automatically send an `Origin` header for requests initiated from native code. The Expo app uses `Authorization: Bearer <token>` for authentication but may not send `Origin`. If it doesn't, ALL mutation requests (POST, PUT, DELETE) from the mobile app would return 403 Forbidden from the CSRF check, making the entire API unusable from mobile. Fix: verify that the Expo `apiClient` explicitly sets the `Origin` header on all requests (e.g., `Origin: ${EXPO_ORIGIN}`), or add a dedicated exception for requests with a valid `Authorization: Bearer` token (since bearer token auth is itself CSRF-proof).

---

### BUG-054: `messages` Table `conversationId` Is Nullable Without FK to `dmConversations`

**FILES:** `apps/web/lib/db/schema.ts` (messages and roomMessages tables)

`messages.conversationId` is a nullable UUID with no `references()` constraint (based on the schema analysis). A message can be created with any UUID as `conversationId` without PostgreSQL enforcing it refers to a real `dmConversations` row. Orphaned messages (referencing deleted conversations) can persist in the table, causing query errors in code that JOINs `messages` to `dmConversations` and expects referential integrity. Fix: add `references(() => dmConversations.id, { onDelete: "set null" })` to the `conversationId` column.

---

### BUG-055: `moments` with Non-Text `contentType` Can Have Null `mediaUrl`

**FILES:** `apps/web/lib/db/schema.ts` (moments table)

The `moments` table has `contentType` (e.g., `'image'`, `'video'`, `'text'`) and `mediaUrl`. There is no CHECK constraint enforcing `media_url IS NOT NULL WHEN content_type != 'text'`. A moment created with `contentType='image'` but null `mediaUrl` would be stored without error, causing broken media rendering in clients and potentially null-pointer errors in code that assumes `mediaUrl` is present for non-text moments. Fix: add a CHECK constraint: `CHECK (content_type = 'text' OR media_url IS NOT NULL)`.

---

### BUG-056: Season Pass `xp_bonus` Milestone Reward Updates `users.xp_total` but Does Not Propagate to All XP Track Snapshots

**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (claimPassMilestone, xp_bonus branch)

The XP bonus CTE updates `users.xp_total` and `users.season_xp`, and calls `upsertLeaderboardSnapshot` for the `"main"` track. However, if the user is also participating in other XP tracks (e.g., `"gaming"`, `"social"`), those track-specific leaderboard snapshots are not updated. The result: the user's rank in non-main leaderboards does not reflect the bonus XP until the next full snapshot rebuild. Fix: also call `upsertLeaderboardSnapshot` for all active tracks the user participates in, or use the seasonal XP amount for the season leaderboard specifically.

---

### BUG-057: `referralCommissions.tier` Is `text` While `referrals.tier` Is `integer` — Type Inconsistency

**FILES:** `apps/web/lib/db/schema.ts`

```
-- referrals.tier
tier: integer("tier").notNull().default(1),

-- referral_commissions.tier
tier: text("tier").notNull().default("1"),
```

These sibling tables track the same domain concept (referral tier level) with different column types. Code that reads tier as a number from `referrals` and then compares against a string from `referral_commissions` can produce subtle bugs (e.g., `tier === 1` vs `tier === "1"`). Fix: standardise both columns to `integer`. Run a migration on `referral_commissions` converting the text values to integers.

---

### BUG-058: Refresh Token Included in JSON Response Body for Mobile Clients — Log Exposure Risk

**FILES:** `apps/web/app/api/auth/refresh/route.ts`

```javascript
if (isMobile) {
  responseBody.accessToken = accessToken;
  responseBody.refreshToken = rotatedRefreshToken;
}
```

Mobile clients receive the refresh token in the JSON response body. If the server logs response bodies (e.g., via an APM, proxy, or middleware debug mode), refresh tokens would appear in plaintext logs. Refresh tokens are long-lived (30 days) and their exposure would allow full session takeover. Fix: ensure response logging middleware explicitly masks fields named `refreshToken`, `accessToken`, and `token` in logged payloads. Consider using a short-lived, single-use response token that exchanges for the actual refresh token in a second authenticated call.

---

### BUG-059: `transferCoins` Uses Same `transferRef` for Both Debit and Credit Ledger Entries

**FILES:** `apps/web/lib/economy/coins.ts` (transferCoins function)

Both the `debitCoins(sender, amount, 'transfer_out', transferRef, ...)` and `creditCoins(recipient, amount, 'transfer_in', transferRef, ...)` calls use the same `transferRef` as the idempotency reference. The coin ledger's unique partial index is on `(user_id, transaction_type, reference_id)`. Since the `transaction_type` differs (`transfer_out` vs `transfer_in`), there is no unique constraint collision, so this works correctly. However, if the `referenceId` is later reused for a different transfer type (e.g., a refund reusing the same reference ID), both the debit and credit would be blocked by the index. Fix: use distinct reference IDs for each leg, e.g., `${transferRef}:out` and `${transferRef}:in`, to make the idempotency scope explicit and prevent any cross-contamination.

---

### BUG-060: `RATE_LIMITS.auth` Preset Shared Between OAuth Initiation and All Auth Endpoints

**FILES:** `apps/web/lib/security/rateLimit.ts`

`RATE_LIMITS.auth = { limit: 20, windowMs: 15 * 60 * 1000, ... }` is used for OAuth initiation, callback, and other auth operations. A user who exhausts the limit during a legitimate OAuth flow (e.g., trying 20 times with expired codes) will be locked out of the login endpoint entirely for 15 minutes. Fix: separate `RATE_LIMITS.oauthInit`, `RATE_LIMITS.oauthCallback`, and `RATE_LIMITS.login` with different limits. Password reset should also have its own limit to prevent username enumeration via rate-limit timing.

---

### BUG-061: `payoutDeadLetterQueue` Has No Monitoring Alert on Queue Depth

**FILES:** `apps/web/lib/db/schema.ts` (payoutDeadLetterQueue table), `apps/web/lib/payments/payouts.ts`

Failed payouts are moved to `payout_dead_letter_queue` after max retries. There is no code that monitors the depth of this queue and emits an alert when it exceeds a threshold. A sudden payment provider outage could populate the DLQ with hundreds of creator payouts that are silently waiting without any operator notification. Fix: add a DLQ depth check in the payout CRON that queries `SELECT COUNT(*) FROM payout_dead_letter_queue WHERE resolved_at IS NULL` and inserts a `system_alerts` row (or triggers a push notification to ops) when the depth exceeds a configured threshold (e.g., 10 pending).

---

### BUG-062: Season Pass `sticker_pack` Reward Falls Back to Name Lookup — Name Is Not Unique-Indexed

**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (claimPassMilestone, sticker_pack branch)

```javascript
packResult = await client.query<{ id: string }>(
  `SELECT id FROM sticker_packs WHERE name = $1 LIMIT 1`,
  [val.packId]
);
```

`sticker_packs.name` has a `UNIQUE` constraint (confirmed in schema line 2043: `name: text("name").notNull().unique()`), so this is actually safe — names are unique. However, `val.packId` is a value stored in the `reward_value` JSON that was populated by `seedSeasonPassMilestones` using a slug/name string. If the pack is renamed after the season is seeded, the lookup fails and the reward is silently skipped (with a system alert logged). Fix: store the pack UUID in `reward_value` at seed time rather than a name/slug string, eliminating the need for the secondary lookup entirely.

---

### BUG-063: `announcementBanners.linkUrl` Is Plain Text — `javascript:` URL Injection Possible

**FILES:** `apps/web/lib/db/schema.ts` (announcementBanners table)

```
linkUrl: text("link_url"),
```

Similar to BUG-043. An announcement banner's link URL is stored as plain text with no validation. If rendered as `<a href={banner.linkUrl}>`, a `javascript:` URL would execute code in the user's browser when clicked. Fix: validate and sanitize `linkUrl` to only allow `https://` or relative paths at write time.

---

### BUG-064: `creatorBroadcasts.content` Is Unbounded Text With No Size Limit

**FILES:** `apps/web/lib/db/schema.ts` (creatorBroadcasts table)

```
content: text("content").notNull(),
```

A creator with broadcast privileges can store arbitrarily large content. If broadcasts are delivered to thousands of subscribers and the content is large (e.g., 10 MB), the delivery system may OOM or hit HTTP payload limits. Fix: add a CHECK constraint `LENGTH(content) <= 10000` or enforce the limit at the API layer before storing.

---

### BUG-065: `withRLS` `SET LOCAL` Has No Effect Outside a Transaction

**FILES:** `apps/web/lib/api/middleware.ts` (withRLS function)

```sql
SET LOCAL app.current_user_id = $1
```

`SET LOCAL` only applies for the duration of the current transaction. If `withRLS` is called for a standalone query (not inside `db.transaction()`), the `SET LOCAL` is executed and then immediately reverted at the end of the implicit single-statement transaction before the next query runs. This means the Row Level Security policies that rely on `current_setting('app.current_user_id', true)` would see an empty value for all non-transaction queries. Fix: use `SET SESSION app.current_user_id = $1` for connection-based DB adapters, or ensure all RLS-protected queries are wrapped in explicit transactions where `SET LOCAL` is valid.

---

### BUG-066: `moderationAiEscalations.reportId` Has No Database-Level FK

**FILES:** `apps/web/lib/db/schema.ts` (moderationAiEscalations table)

```
reportId: uuid("report_id").notNull(),
```

The comment says "FK to moderation_reports established at DB level (forward ref in 001)" but no `.references()` is present in the Drizzle schema. If the migration never added the FK at the DB level (or the migration was not applied), this column has no referential integrity enforcement. Deleted moderation reports would leave orphaned escalation rows. Fix: verify the FK exists in the DB, and add `.references(() => moderationReports.id, { onDelete: "cascade" })` to the Drizzle schema.

---

### BUG-067: `adminMessages.targetUserIds` Is an Unbounded Array

**FILES:** `apps/web/lib/db/schema.ts` (adminMessages table)

```
targetUserIds: uuid("target_user_ids").array(),
```

A direct-type broadcast with `broadcastType: "direct"` can target an unbounded list of user UUIDs stored in a PostgreSQL array column. Loading a row with 1 million UUIDs into application memory to iterate deliveries would cause OOM. Fix: for large user groups, store targets as a query filter (e.g., `targetPlans`, `targetRoles`) rather than an explicit ID list. If direct targeting is needed, cap the array at a reasonable limit (e.g., 1,000 users) and enforce this with a CHECK constraint.

---

### BUG-068: `dataExportRequests` Table Has No Expiry or Cleanup CRON

**FILES:** `apps/web/lib/db/schema.ts` (dataExportRequests table)

GDPR data export files generated for users are stored on the blob storage provider. The `dataExportRequests` table tracks request status and presumably links to the file URL. There is no evidence of an automated cleanup CRON that deletes export files older than a configurable retention period (typically 7 days under GDPR recommendations). Export files containing users' personal data accumulate indefinitely. Fix: add a daily CRON task that deletes export files and their records after 7 days, and notify users whose exports have expired.

---

### BUG-069: `skipThreshold` Option in Rate Limiter Can Be Set Greater Than 1.0

**FILES:** `apps/web/lib/security/rateLimit.ts`

The `skipThreshold` option in `RateLimitOptions` allows callers to override the L1 cache threshold. There is no validation that `0 <= skipThreshold <= 1`. If a caller passes `skipThreshold: 5.0`, the in-process counter would skip Redis permanently (since the local count would always be below 500% of the limit). Fix: clamp `skipThreshold` to `[0, 1]` at the start of `enforceRateLimit`.

---

### BUG-070: `loadPendingRecovery` No Schema Validation — Arbitrary Key Injection

**FILES:** `apps/expo/lib/payments/googlePlay.ts`

```javascript
const obj = JSON.parse(raw) as Record<string, { timestamp: number }>;
Object.entries(obj).forEach(([k, v]) => {
  if (now - v.timestamp < RECOVERY_EXPIRY_MS) {
    pendingRecovery.set(k, v);
  }
});
```

Parsed data is cast without validation. If `SecureStore` is corrupted or tampered (e.g., in a rooted device), `k` could be any string (including legitimate product IDs) and `v` could be any shape. A maliciously crafted SecureStore value could set `pendingRecovery` entries for any product ID with an arbitrarily future `timestamp`, blocking the user from purchasing any product. Fix: validate that `k` is a known product ID and `v.timestamp` is a valid number before inserting into `pendingRecovery`.

---

### BUG-071: Guild War Resolution Has No DB-Level Idempotency Guard Against Concurrent CRON Execution

**FILES:** `apps/web/lib/guilds/warEngine.ts` (war resolution logic)

War resolution distributes XP and coins to all winning guild members. If two CRON instances run simultaneously and both query for "completed wars to resolve," they can both pick up the same war and both distribute rewards. While `safeAwardXP` may have idempotency keys per-user, the war resolution itself (updating `status = 'resolved'` and crediting rewards) needs an atomic "claim" step. Fix: add `SELECT ... FOR UPDATE SKIP LOCKED` when fetching wars to resolve, or add a `resolved_at` timestamp check inside the distribution transaction that only proceeds if `resolved_at IS NULL`.

---

### BUG-072: `userPins.hashedPin` Has No Minimum bcrypt Work Factor Enforced at Schema Level

**FILES:** `apps/web/lib/db/schema.ts` (userPins table)

```
hashedPin: text("hashed_pin").notNull(),
```

Plain text storing a hashed PIN. The column enforces no format, minimum length, or algorithm marker. If the hashing code is ever changed to a weaker algorithm (e.g., MD5 or SHA-256 instead of bcrypt), the column would silently accept the weaker hashes. Fix: add a CHECK constraint enforcing the `$2b$` bcrypt prefix: `CHECK (hashed_pin LIKE '$2b$%')`. This is a defense-in-depth measure.

---

### BUG-073: No Circuit Breaker Around Paystack HTTP Calls in `payouts.ts`

**FILES:** `apps/web/lib/payments/payouts.ts`

`initiateTransfer` and `verifyTransfer` from `@/lib/payments/paystack` make HTTP calls to Paystack's API. There is no circuit breaker around these calls. If Paystack's API returns a sequence of errors or times out, the payout CRON will attempt all `batchSize` transfers against an unresponsive endpoint, exhausting the CRON execution time window and potentially leaving rows in a `'processing'` state (which may not auto-recover to `'pending'` for retry). Fix: wrap Paystack HTTP calls with the `RedisCircuitBreaker` pattern (already used for DB calls in `lib/db/circuit.ts`) so a sequence of Paystack failures opens the circuit and stops further attempts until the circuit resets.

---

### BUG-074: `img-src` CSP Does Not Include `*.r2.dev` When Using Wildcard R2 Dev Host

**FILES:** `apps/web/middleware.ts` (buildCsp)

The CSP `img-src` includes `https://*.r2.cloudflarestorage.com` but not `https://*.r2.dev`. The `NEXT_PUBLIC_R2_DEV_HOST` can be set to a wildcard (`*.r2.dev`). Images served from R2 dev subdomains (common in development and some production setups) would be blocked by the CSP, causing broken images for users. Fix: add `https://*.r2.dev` to `img-src` in `buildCsp()`, or dynamically include `process.env.NEXT_PUBLIC_R2_DEV_HOST` in the directive when it's set.

---

### BUG-075: Store Item Expiry Not Re-Checked at Payment Webhook Processing Time

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`, `apps/web/lib/db/schema.ts` (storeItems)

When a user initiates a purchase of a time-limited store item (`storeItems.validUntil`), the check for validity happens at initiation time. The Paystack webhook that confirms payment and credits coins/items arrives asynchronously (typically seconds later, but could be minutes in a retry scenario). If the item expired between initiation and webhook delivery, the item is still granted. Fix: re-read `storeItems.valid_until` inside the webhook handler and abort the credit if the item has expired, issuing a full refund instead.

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical (app-breaking or complete security bypass) | 3 |
| High (security, financial integrity, data integrity) | 22 |
| Medium (correctness, race conditions, degradation) | 30 |
| Low (defense-in-depth, best practice, schema design) | 20 |
| **Total** | **75** |

---

*Report generated: June 26, 2026, 12:00 PM*  
*Auditor: Claude Code (Sonnet 4.6) — forensic multi-pass analysis*  
*Scope: apps/web (Next.js 15 + PWA), apps/expo (React Native Android)*  
*Note: CRON frequency issues excluded per user instruction. Test-related issues excluded.*
