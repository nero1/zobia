# Zobia Social — Comprehensive Bug & Code Quality Report

**Generated:** June 14, 2026, 09:27 PM  
**Updated:** June 15, 2026 — All 53 bugs fixed and pushed to `claude/custom-bugs-fixes-246xkx`  
**Scope:** Full forensic analysis — `apps/web` (Next.js 14 App Router, all API routes, all lib/ modules)  
**Method:** Deep static analysis, three full sweeps of all files

---

## Completion Status

| # | Bug | Status |
|---|-----|--------|
| 1 | TOTP duplicated in 2FA verify route | ✅ Fixed |
| 2 | questEngine TRACK_COLUMN missing knowledge track | ✅ Fixed |
| 3 | referral_commissions missing tier column | ✅ Fixed |
| 4 | gift_items missing is_active column | ✅ Fixed |
| 5 | gifts FK column mismatch (gift_type_id vs gift_item_id) | ✅ Fixed |
| 6 | contentFilter queries FROM messages (wrong table) | ✅ Fixed |
| 7 | leaderboards/engine queries FROM messages (wrong table) | ✅ Fixed |
| 8 | monthlyGiftDrop notification INSERT wrong columns | ✅ Fixed |
| 9 | monthlyGiftDrop orphaned $1 parameter | ✅ Fixed |
| 10 | total_messages incremented for pending-approval messages | ✅ Fixed |
| 11 | Pin data stripped in rowToMessage() | ✅ Fixed |
| 12 | withAdminAuth skips geo-anomaly detection | ✅ Fixed |
| 13 | Pre-auth JWT token exposed in redirect URL | ✅ Fixed |
| 14 | seedSeasonPassMilestones ON CONFLICT missing target | ✅ Fixed |
| 15 | milestoneStickers ON CONFLICT missing target | ✅ Fixed |
| 16 | checkDeckCompletion bypasses safeAwardXP | ✅ Fixed |
| 17 | Payout velocity counts system retries | ✅ Fixed |
| 18 | Gift send has no room membership check | ✅ Fixed |
| 19 | debitCoins/creditCoins called with null referenceId | ✅ Fixed |
| 20 | isEmailTypeEnabledForUser queries by email not userId | ✅ Fixed |
| 21 | No per-user session limit enforced | ✅ Fixed |
| 22 | google.ts uses axios instead of native fetch | ✅ Fixed |
| 23 | generateOAuthState() duplicates generateCsrfToken() | ✅ Fixed |
| 24 | getReengagementPayload unnecessarily async | ✅ Fixed |
| 25 | user_badges dual timestamp columns (awardedAt/grantedAt) | ✅ Fixed |
| 26 | Two gift-type tables with overlapping purpose | ✅ Fixed |
| 27 | guildWarMembers ORM name mismatches war_contributions table | ✅ Fixed |
| 28 | Two UUID generator helpers (uuid_generate_v4 vs gen_random_uuid) | ✅ Fixed |
| 29 | Referral XP bypasses safeAwardXP | ✅ Fixed |
| 30 | recordWarContribution SQL injection via column interpolation | ✅ Fixed |
| 31 | Admin route reads process.env directly instead of validated env | ✅ Fixed |
| 32 | flashXP platform_events ON CONFLICT missing target | ✅ Fixed |
| 33 | National leaderboard hardcoded to country = 'NG' | ✅ Fixed |
| 34 | fieldEncryption uses CommonJS require('crypto') in ESM module | ✅ Fixed |
| 35 | Missing tables in Drizzle schema | ✅ Fixed |
| 36 | Mystery XP Drop TABLESAMPLE may return too few recipients | ✅ Fixed |
| 37 | AI classifier accepts unbounded system prompt override | ✅ Fixed |
| 38 | user_badges INSERT in milestoneStickers omits granted_at | ✅ Fixed |
| 39 | trackMilestones badge_type set to badge_key value | ✅ Fixed |
| 40 | Re-engagement 200-coin promise with no backing mechanism | ✅ Fixed |
| 41 | Hand-rolled HTML sanitizer bypassable via mXSS | ✅ Fixed |
| 42 | No JWT key rotation strategy | ✅ Fixed |
| 43 | No structured logging / request correlation IDs | ✅ Fixed |
| 44 | Rate limiting lacks endpoint-level global cap | ✅ Fixed |
| 45 | No read-path audit logging for admin data access | ✅ Fixed |
| 46 | No circuit breaker on database connections | ✅ Fixed |
| 47 | DLQ has no depth monitoring or alerting | ✅ Fixed |
| 48 | No graceful shutdown handler | ✅ Fixed |
| 49 | No health check endpoint | ✅ Fixed |
| 50 | TypeScript strict mode not fully enforced | ✅ Fixed |
| 51 | High-value lib functions hardcode db import | ✅ Fixed |
| 52 | feat() helper uses as never type lie | ✅ Fixed |
| 53 | No monitoring provider abstraction | ✅ Fixed |

**Result: 53/53 bugs fixed ✅ (100%)**

---

## Commits

All fixes are on branch `claude/custom-bugs-fixes-246xkx`:

1. `b73c09a` — fix: Groups A-E bug fixes — schema, auth, economy, rooms, notifications (BUG-01 to BUG-40)
2. `3d7ed16` — fix: Groups B-F remaining fixes — leaderboard, quests, security, quality (BUG-02 to BUG-40)  
3. `812dfc5` — fix: Group G quality ceiling bugs (BUG-41 to BUG-53)

## ESLint Result

```
✖ 5 problems (0 errors, 5 warnings)
```

All 5 warnings are pre-existing `<img>` tag and useEffect dependency warnings in UI pages, unrelated to any of the 53 bug fixes.

---

## Quick Reference: All Issues (One-Line Descriptions)

1. ✅ TOTP implementation duplicated inline in the 2FA verify route instead of importing the shared module
2. ✅ `questEngine.ts` TRACK_COLUMN map missing the `knowledge` track — knowledge-track XP never credited
3. ✅ `referral_commissions` GROUP BY `tier` column that does not exist in schema or INSERT — runtime SQL crash
4. ✅ Gift send route checks `gift_items.is_active` but the `giftItems` schema table has no `is_active` column
5. ✅ Gift send route INSERTs `gift_item_id` into `gifts` table but schema defines the FK column as `giftTypeId`
6. ✅ `contentFilter.ts` queries `FROM messages` table which does not exist in the Drizzle schema
7. ✅ `leaderboards/engine.ts` queries `FROM messages` table in two functions — same wrong table reference
8. ✅ `monthlyGiftDrop.ts` notification INSERT uses `title`, `body`, `metadata` columns absent from the notifications schema (which uses `payload`)
9. ✅ `monthlyGiftDrop.ts` passes `drop.id` as `$1` but the SQL text never references `$1` — unused parameter
10. ✅ `total_messages` counter incremented even for messages awaiting moderation approval
11. ✅ Pin data (`is_pinned`, `pin_expires_at`) queried in `rowToMessage()` but stripped before returning — pin state never delivered to clients
12. ✅ `withAdminAuth` skips geo-anomaly detection that `withAuth` applies — admin sessions have weaker anomaly protection
13. ✅ Pre-auth 2FA token placed directly in the web redirect URL (browser history / server logs exposure)
14. ✅ `seedSeasonPassMilestones` uses `ON CONFLICT DO NOTHING` without specifying a conflict target
15. ✅ `user_sticker_packs` INSERT in `milestoneStickers.ts` uses `ON CONFLICT DO NOTHING` without a conflict target
16. ✅ `checkDeckCompletion` awards 500 XP with raw SQL, bypassing `safeAwardXP` and the dead-letter queue
17. ✅ Payout velocity fraud check counts system retries as user requests — legitimate creators falsely flagged
18. ✅ Gift send route performs no room membership check when a `roomId` context is provided
19. ✅ `debitCoins`/`creditCoins` called with `referenceId = null` in gift send — no DB-level idempotency for retries
20. ✅ `isEmailTypeEnabledForUser` queries by email address instead of user ID — ambiguous across soft-deleted accounts
21. ✅ No per-user session limit enforced — unlimited concurrent sessions allowed
22. ✅ `lib/auth/google.ts` uses `axios` for HTTP while the rest of the codebase uses native `fetch`
23. ✅ `generateOAuthState()` in `google.ts` exactly duplicates `generateCsrfToken()` from `lib/security/csrf.ts`
24. ✅ `getReengagementPayload()` declared `async` with no `await` — unnecessary async wrapper
25. ✅ `user_badges` has both `awardedAt` and `grantedAt` columns; inserts across the codebase populate them inconsistently
26. ✅ Two separate gift-type tables (`gift_types` and `gift_items`) with overlapping purpose — root cause of BUG-04 and BUG-05
27. ✅ `guildWarMembers` Drizzle ORM name maps to `war_contributions` DB table — naming mismatch
28. ✅ Two UUID generator helpers in schema.ts: `uuidPk()` uses `uuid_generate_v4()`, `uuidPkGen()` uses `gen_random_uuid()`
29. ✅ Referral first-purchase XP awarded with raw SQL, bypassing `safeAwardXP` and the dead-letter queue
30. ✅ `recordWarContribution.ts` interpolates a column name directly into SQL without parameterization
31. ✅ Admin actions route uses `process.env.NEXT_PUBLIC_APP_URL` directly instead of the validated `env` import
32. ✅ Flash XP `platform_events` upsert uses `ON CONFLICT DO NOTHING` without a conflict target
33. ✅ National leaderboard scope hardcoded to `country = 'NG'`
34. ✅ v1 field encryption uses CommonJS `require('crypto')` inside an ESM module function body
35. ✅ `room_subscriptions`, `creator_earnings`, `store_items`, `user_subscriptions` tables used in webhook but absent from Drizzle schema
36. ✅ Mystery XP Drop uses `TABLESAMPLE BERNOULLI(5)` which may return far fewer than `batchSize` recipients on small tables
37. ✅ AI classifier accepts an unbounded admin-controlled system prompt override with no length or content validation
38. ✅ `user_badges` INSERT in `milestoneStickers.ts` omits `granted_at`, while `trackMilestones.ts` sets both redundant columns
39. ✅ `trackMilestones.ts` sets `badge_type = badge_key` — `badge_type` should be a semantic category string, not the full key
40. ✅ Re-engagement "200 Coins reserved" notification body has no backing coin-reservation mechanism
41. ✅ Custom hand-rolled HTML sanitizer is bypassable via mXSS and malformed-tag vectors — no library used
42. ✅ No JWT key rotation strategy — a leaked secret permanently compromises all sessions
43. ✅ No structured logging and no request correlation IDs — production errors are untraceable
44. ✅ Rate limiting is per-IP or per-user only — distributed attacks from many IPs bypass it entirely
45. ✅ No read-path audit logging for admin data access — KYC views and financial reads are untracked
46. ✅ No circuit breaker on database connections — a DB overload cascades to all requests with no fallback
47. ✅ Dead-letter queue has no depth monitoring or alerting — silent XP loss goes undetected indefinitely
48. ✅ No graceful shutdown handler — in-flight DB transactions are interrupted on serverless cold-start termination
49. ✅ No health check endpoint — load balancers and uptime monitors have no way to verify DB and Redis connectivity
50. ✅ TypeScript strict mode not fully enforced — `any` casts, `as never` type lies, and inexact optional types exist throughout
51. ✅ Inconsistent DB access pattern — high-value lib functions accept an injected adapter but many modules hardcode the `db` import, making them untestable and environment-inflexible
52. ✅ `feat()` helper in `manifest/index.ts` uses `as never` to index into `DEFAULT_MANIFEST.features` — a type lie that silently returns wrong values for unmatched keys
53. ✅ No monitoring provider abstraction — no Sentry, New Relic, or equivalent; errors and transactions are invisible in production
