# Zobia Social — Bug Fix Plan (Final, Consolidated)

**Generated:** Tuesday, June 16, 2026 · 09:26 AM UTC
**Based on:** `custom-bugs-report.md` (Final, Consolidated) — 49 items (43 bugs + 6 quality improvements)

> **IMPORTANT: Do NOT begin any fix until the report and this plan have been reviewed and approved.**

This is the complete, final replacement for any earlier draft of this plan. It covers all 49 items from the consolidated report, including the 19 newly-confirmed coin-ledger/group-chat/business-tier/offline-sync issues plus the 30 previously-confirmed issues, all renumbered to match the report. Fixes are grouped by priority tier (P0 → P1 → P2 → Q), ordered by report item number within each tier. Each task is self-contained unless a dependency is noted.

---

## Priority Tiers

| Tier | Criteria |
|------|----------|
| **P0 — Critical** | Broken user-facing feature OR money correctness issue |
| **P1 — High** | Silent data corruption, money race, notification spam, security/abuse gap, or data loss |
| **P2 — Medium** | Security hardening, tech debt, deferred safety work |
| **Q — Quality** | Non-bug improvements required to reach 9.3 / 10 |

---

## P0 — Critical (Fix Immediately)

---

### TASK-01 · Add `user_id` to `coin_ledger`'s unique index (BUG SYS-CL-ROOT)

**Effort:** ~3 hours
**Files:** `apps/web/lib/db/schema.ts` (`uidx_coin_ledger_tx_type_ref`), `apps/web/lib/economy/coins.ts` (`writeLedgerEntry`)

This is the foundation for TASK-02 through TASK-11 and must land first. Migrate `uidx_coin_ledger_tx_type_ref` from `UNIQUE (transaction_type, reference_id) WHERE reference_id IS NOT NULL` to `UNIQUE (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL`, matching the existing correct pattern on `xp_ledger`'s `uidx_xp_ledger_source_ref`. Add `ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to `writeLedgerEntry` so legitimate retries become safe no-ops instead of throwing. Deploy this migration in the same release as TASK-02–TASK-11 (the call-site reference-key fixes), since the old index would otherwise still block the fixed call sites until the new one is live.

---

### TASK-02 · Fix daily quest coin reward shared reference (BUG SYS-CL-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/quests/questEngine.ts` (line 256)

Change `creditCoins(userId, coinsAwarded, "quest_reward", questId, ...)` to use a per-user, per-day key: `` `quest:${questId}:${userId}:${today}` ``, mirroring the pattern already used correctly for the XP award two lines above.

---

### TASK-03 · Fix room promotion purchase shared reference (BUG SYS-CL-02)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/rooms/[roomId]/promote/route.ts` (lines 139-146)

Insert the `room_promotions` row first inside the same transaction and use its own generated ID as the `debitCoins` reference instead of the bare `roomId`, so repeat/extended promotion purchases for the same room no longer collide.

---

### TASK-04 · Fix sticker pack unlock shared reference (BUG SYS-CL-03)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/stickers/route.ts` (lines 157-165)

Change `debitCoins(userId, pack.coin_price, "sticker_pack", packId, ...)` to use `` `sticker_pack:${packId}:${userId}` ``.

---

### TASK-05 · Fix guild treasury donation shared reference (BUG SYS-CL-04)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/guilds/[guildId]/treasury/route.ts` (lines 178-192)

Change the `coin_ledger` insert's `reference_id` from bare `guildId` to a per-donation key, e.g. `` `guild_donation:${guildId}:${userId}:${Date.now()}` ``, or route the debit through `debitCoins` with a freshly generated donation-transaction UUID.

---

### TASK-06 · Fix guild quest per-member reward loop reusing questId (BUG SYS-CL-05)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts` (lines 154-177)

The single most severe, 100%-reproducible bug in this review: the per-member coin credit loop calls `creditCoins(member.user_id, coinsPerMember, "quest_reward", questId, ...)` with the identical reference on every iteration, guaranteeing a full transaction rollback for any multi-member guild quest with a coin reward. Change the reference to `` `guild_quest_reward:${questId}:${member.user_id}` ``. Ship in the same release as TASK-01 and TASK-02 (both touch `quest_reward`-typed references) to avoid a window where this fix is live but the index migration isn't.

---

### TASK-07 · Fix season pass purchase shared reference (BUG SYS-CL-06)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/seasons/[seasonId]/pass/route.ts` (lines 163-174)

Change the direct `coin_ledger` insert's `reference_id` from bare `seasonId` to `` `season_pass:${seasonId}:${userId}` ``.

---

### TASK-08 · Fix season pass gift shared reference (BUG SYS-CL-07)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/seasons/[seasonId]/pass/gift/route.ts` (lines 133-141)

Change `debitCoins(senderId, season.pass_price_coins, "season_pass_gift", seasonId, ...)` to `` `season_pass_gift:${seasonId}:${senderId}:${recipientUserId}` ``.

---

### TASK-09 · Fix season milestone claim reference omitting userId (BUG SYS-CL-08)

**Effort:** ~20 minutes
**Files:** `apps/web/app/api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim/route.ts` (lines 200-209)

Change `` `season_milestone:${milestoneId}` `` to `` `season_milestone:${milestoneId}:${userId}` ``.

---

### TASK-10 · Fix merch purchase buyer-side shared productId reference (BUG SYS-CL-09)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/merch/purchase/route.ts` (lines 184-198)

Insert the `merch_orders` row first inside the same transaction (matching what the creator-side credit at lines 250-266 already does correctly with `orderId`) and use that order's ID as the `debitCoins` reference instead of the bare `productId`.

---

### TASK-11 · Fix cosmetic purchase shared itemId reference (BUG SYS-CL-10)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/economy/cosmetics/route.ts` (lines 231-246)

Change both the coin-currency debit (line 240-246) and the star-currency debit (line 231-237) to use `` `cosmetic_purchase:${body.itemId}:${userId}` `` instead of bare `body.itemId`.

---

### TASK-12 · Fix group chat XP award un-deduplicated group-scoped reference (BUG XP-GROUP-01)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (lines 20-85, `maybeAwardGroupMessageXP`; call site line 184)

Replace the raw `INSERT INTO xp_ledger` (no `ON CONFLICT`, keyed on bare `groupId`) with a call into the shared `safeAwardXP` helper, using the new message's own UUID as the reference for both the sender's `group_message` award and the `group_message_member` loop — matching the room-messages route's correct pattern (`apps/web/app/api/rooms/[roomId]/messages/route.ts`, ~lines 575-577).

---

### TASK-13 · Fix business tier upgrade stale-reference race + false success notification (BUG BIZ-TIER-RACE)

**Effort:** ~2 hours
**Files:** `apps/web/app/api/business/tier/route.ts` (lines 117-123), `apps/web/lib/payments/paystackWebhookHandler.ts` (lines 167-202), `apps/web/lib/payments/dodoWebhookHandler.ts` (lines 137-177)

Two-part fix: (a) in `PATCH /api/business/tier`, reject a new upgrade request while a non-expired `pending_payment_ref` already exists on the account (return a 409 prompting the user to complete or cancel the existing payment first); (b) in both webhook handlers, check the activation `UPDATE`'s row count before sending the "Business Account Upgraded" notification, and raise a `system_alert`/log entry for manual reconciliation if it didn't match instead of silently doing nothing.

---

### TASK-14 · Fix Expo mobile OAuth login CSRF block (BUG CSRF-01)

**Effort:** ~1 hour
**Files:** `apps/expo/app/auth/login.tsx`

In `handleDeepLink`, add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the `headers` object of the raw `fetch()` call that POSTs to `/api/auth/mobile-token`. Optionally refactor to use the shared Axios client (which already sets Origin) to prevent recurrence. Verify with a full Google/Telegram OAuth login on a device or emulator.

---

### TASK-15 · Fix double platform-fee deduction on creator payouts (BUG FIN-01)

**Effort:** ~2 hours
**Files:** `apps/web/app/api/cron/daily/route.ts` (weekly payout aggregation section)

`available_earnings_kobo` is already net. Remove the secondary `platformFeeKobo = grossKobo * 0.10` calculation and set `netKobo = grossKobo` (and `platformFeeKobo = 0` in the payout INSERT). Audit existing `creator_payouts` rows for under-paid records (`net_kobo < gross_kobo`) and issue adjustment payouts or `available_earnings_kobo` credits for affected creators.

---

## P1 — High (Fix Within Sprint)

---

### TASK-16 · Add unique constraint to `star_ledger` (BUG STAR-NOIDEM)

**Effort:** ~2 hours
**Files:** `apps/web/lib/db/schema.ts` (`starLedger`), `apps/web/lib/economy/stars.ts` (`writeStarLedgerEntry`), call sites in `apps/web/app/api/economy/stars/gift/route.ts`, `apps/web/app/api/economy/cosmetics/route.ts`

Add a partial unique index `UNIQUE (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` to `star_ledger`, add matching `ON CONFLICT ... DO NOTHING` to `writeStarLedgerEntry`, and audit call sites to ensure each passes a meaningful per-transaction-unique `referenceId` rather than e.g. the counterparty's user ID.

---

### TASK-17 · Add input validation to group chat POST (BUG GROUP-NOVALIDATE)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (line 147, POST handler)

Add a Zod schema (content length cap, `messageType` enum, `idempotencyKey` optional — see TASK-21) and validate via `validateBody`, matching the DM and room-messages routes' `sendMessageSchema` pattern.

---

### TASK-18 · Add rate limiting to group chat POST (BUG GROUP-NORATELIMIT)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)

Add `enforceRateLimit(userId, "user", RATE_LIMITS.<messageSend>)` at the top of the handler, matching the DM and room-messages routes.

---

### TASK-19 · Add auto-moderation to group chat POST (BUG GROUP-NOMODERATION)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)

Add the same `applyAutoModeration` call (profanity, duplicate-message, bot-velocity detection) used in the room-messages route, before persisting the message. Currently only contact-info/link stripping (`filterPublicContent`) runs.

---

### TASK-20 · Fix DodoPayments subscription bonus missing duplicate-key guard (BUG DODO-SUB-BONUS)

**Effort:** ~20 minutes
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts` (lines 256-271)

Wrap the monthly subscription coin bonus `creditCoins` call in the same `.catch` pattern used by the Paystack handler (lines 493-533): check `err.code === '23505'`, log and continue, rather than letting the error propagate and roll back the entire transaction (including the already-applied plan upgrade).

---

### TASK-21 · Fix offline-queued room/group messages losing their idempotency key (BUG OFFLINE-IDEMP-GAP)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/rooms/[roomId]/messages/route.ts` (schema, lines 49-60), `apps/web/app/api/messages/group/[groupId]/route.ts`, `apps/web/lib/api/middleware.ts` (lines 455, 471)

Add `idempotencyKey: z.string().max(128).optional()` to both the room and group message Zod schemas, and add the same existing-row idempotency check the DM route already performs (`apps/web/app/api/messages/dm/[conversationId]/route.ts` lines 304/450/495). Currently Zod's default `.parse()` silently strips the unknown field instead of erroring, so retried offline-queued messages have no server-side duplicate protection.

---

### TASK-22 · Fix `guild_quests` missing unique constraint (BUG DB-01)

**Effort:** ~1 hour
**Files:** `apps/web/lib/db/schema.ts`, new migration

Delete duplicate rows (`DELETE FROM guild_quests WHERE id NOT IN (SELECT MIN(id) FROM guild_quests GROUP BY guild_id, quest_type, week_start)`), then add `UNIQUE (guild_id, quest_type, week_start)` to the schema and migration. Update the `ON CONFLICT` column list in the CRON section to match.

---

### TASK-23 · Fix `guild_tier_history` missing coverage for non-war tier changes (BUG DB-02)

**Effort:** ~45 minutes
**Files:** `apps/web/lib/db/schema.ts`, new migration

Add a partial index: `CREATE UNIQUE INDEX ON guild_tier_history (guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`. Update the non-war promotion/demotion CRON section to use this as the `ON CONFLICT` target.

---

### TASK-24 · Deduplicate council invitation notifications (BUG NOTIF-01)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/cron/daily/route.ts`

Add `reference_id = 'council_invite:<userId>:<YYYY-WW>'` to the council invitation notification INSERT so the existing partial unique index fires correctly.

---

### TASK-25 · Deduplicate guild war final-hour notifications (BUG NOTIF-02)

**Effort:** ~20 minutes
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'war_final_hour:<warId>'` to the final-hour notification INSERT.

---

### TASK-26 · Deduplicate guild tier-downgrade notifications (BUG NOTIF-03)

**Effort:** ~20 minutes
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'` to the downgrade notification INSERT.

---

### TASK-27 · Fix Web PWA "sending" messages stranded after crash (BUG SYNC-01)

**Effort:** ~1.5 hours
**Files:** `apps/web/lib/offline/messageQueue.ts`, `apps/web/lib/offline/useOfflineSync.ts`

Add a `resetSendingMessages()` function to `messageQueue.ts` that opens the `messages` IndexedDB object store and updates all `status === "sending"` rows back to `"pending"`. Call it at the start of the reconnect handler in `useOfflineSync.ts`, matching the Expo equivalent.

---

### TASK-28 · Fix null email passed as `string` to JWT signing (BUG AUTH-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`, `apps/web/lib/auth/jwt.ts`

Make `email` optional in `AccessTokenPayload` and omit the claim when `user.email` is null (preferred), or minimally guard with `email: user.email ?? ''`.

---

### TASK-29 · Fix `platform_events.name` constraint breaking annual recurrence and Flash XP upsert (BUG DB-03)

**Effort:** ~2 hours
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, `apps/web/lib/events/flashXP.ts`, new migration

Drop `UNIQUE(name)` from `platform_events`, replace with `UNIQUE(name, starts_at)`. Update the annual recurrence cloning `ON CONFLICT` clause to `(name, starts_at)`. Remove or demote the Flash XP upsert's `.catch(() => {})` to log errors instead of silently swallowing them. Test by inserting two events with the same name but different `starts_at` (both should succeed).

---

### TASK-30 · Fix `DeviceNotRegistered` push receipt purging all user tokens (BUG PUSH-01)

**Effort:** ~2 hours
**Files:** `apps/web/lib/notifications/push.ts`

Store a ticket-ID → device-token mapping at send time (e.g. Redis hash `push_ticket:<ticketId>` with 24h TTL, or a `push_tickets` table column). When processing a `DeviceNotRegistered` receipt, look up and delete only the specific token for that ticket ID.

---

### TASK-31 · Stamp nemesis's `last_notified_at` on overtake events (BUG NOTIF-04)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/cron/daily/route.ts`

Collect nemesis user IDs alongside the overtaking user IDs and extend the `UPDATE nemesis_assignments SET last_notified_at = NOW()` to cover both sets: `WHERE user_id = ANY(($userIds || $nemesisIds)::uuid[])`.

---

### TASK-32 · Fix alliance wars duplicate creation (BUG DB-04)

**Effort:** ~1 hour
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, new migration

Add `CREATE UNIQUE INDEX ON alliance_wars (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week)`. Update the `ON CONFLICT` clause in the CRON to match.

---

### TASK-33 · Consolidate duplicate login-streak columns (BUG DB-05)

**Effort:** ~1 hour
**Files:** `apps/web/lib/db/schema.ts`, all referencing files, new migration

Run a repo-wide search for `loginStreak`/`login_streak` to find all references. Select `login_streak_days` as canonical. Migration: `UPDATE users SET login_streak_days = GREATEST(login_streak, login_streak_days)`. Drop `login_streak`. Fix all references to use `login_streak_days`.

---

### TASK-34 · Fix guild chat XP daily cap firing at 10 messages instead of 20 (BUG XP-01)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/guilds/[guildId]/chat/route.ts`

The COUNT query counts all `xp_ledger` rows with `source = 'guild_chat'`; each message inserts 2 rows (social + competitor tracks), so `CHAT_XP_DAILY_CAP = 20` fires after 10 messages. Add `AND track = 'social'` to the COUNT query so it counts distinct messages.

---

### TASK-35 · Wrap `recordWarContribution` in a transaction (BUG WAR-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/guilds/recordWarContribution.ts`

Wrap the `war_contributions` upsert and the `guild_wars` points UPDATE in a single `db.transaction()` call so both succeed or both roll back together.

---

### TASK-36 · Fix announcement modal serial-mode view tracking (BUG UI-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/announcements/engine.ts`

At the end of `getActiveModalForUser`, after `selected` is determined, add an upsert into `user_modal_views` (`ON CONFLICT (user_id, modal_id) DO UPDATE SET viewed_at = NOW()`), mirroring what `getActiveBannerForUser` already does correctly.

---

### TASK-37 · Fix sticker pack grant silent abort on race condition (BUG RACE-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/stickers/milestoneStickers.ts` (`awardMilestoneStickers`)

When the `ON CONFLICT (name) DO NOTHING RETURNING id` insert returns no rows (concurrent insert), fall back to `SELECT id FROM sticker_packs WHERE name = $1` to resolve the existing pack ID instead of returning early, then continue to the `user_sticker_packs` INSERT.

---

### TASK-38 · Fix classroom enrollment TOCTOU race condition (BUG RACE-02)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/classroom/[roomId]/enroll/route.ts`, new migration

Move the existing-enrollment check inside the transaction with `FOR UPDATE`, after the `SELECT coin_balance FOR UPDATE`. Throw a conflict error if a row is found. Add `UNIQUE(room_id, user_id)` to `classroom_enrolments` as a final safety net.

---

## P2 — Medium (Fix Before Next Release)

---

### TASK-39 · Remove `id` attribute from HTML sanitizer allowlist (BUG SEC-01)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Remove `'id'` from `'*': ['class', 'id']`. If heading anchors need IDs, allowlist them only on specific elements (e.g. `'h2': ['id']`). Add a test asserting `<div id="foo">` is sanitized to `<div>`.

---

### TASK-40 · Harden markdown link sanitizer with an allow-list (BUG SEC-02)

**Effort:** ~1 hour
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Replace the 3-scheme deny-list with DOMPurify configured with `ALLOWED_URI_REGEXP: /^(https?|mailto):/` applied to the rendered markdown HTML. Add tests for `blob:`, `file:`, and custom-scheme URIs.

---

### TASK-41 · Tighten pre-auth 2FA path guard to exact match (BUG AUTH-02)

**Effort:** ~15 minutes
**Files:** `apps/web/lib/api/middleware.ts`

Change `pathname.endsWith('/2fa/verify')` to `pathname === '/api/auth/2fa/verify'`.

---

### TASK-42 · Encrypt Expo MMKV offline store (BUG SEC-03)

**Effort:** ~1 day
**Files:** `apps/expo/lib/offline/store.ts`, new `apps/expo/lib/storage/mmkvKey.ts`

Generate a random 256-bit key at first launch, store it via `expo-secure-store`/Android Keystore, and pass it as `encryptionKey` to the MMKV constructor. Migrate existing unencrypted data on first encrypted run (read all values, delete old store, create encrypted store, write values back), gated on a persisted boolean flag.

---

### TASK-43 · Migrate legacy v1 field-encryption ciphertext to v2 (BUG SEC-04)

**Effort:** ~1 day
**Files:** `apps/web/lib/security/fieldEncryption.ts`, new migration script

Write a one-shot job that selects all rows with `v1:`-prefixed ciphertext, decrypts with v1, re-encrypts with v2 (scrypt + random salt), and updates in a transaction. After 0 v1 rows remain, remove the v1 code path and confirm the master key lives in a hardware-backed secret store.

---

## Q — Quality Improvements to reach 9.3 / 10

---

### TASK-44 · Opaque cursor-based pagination (IMP CURSOR-01)

**Effort:** ~2 hours
**Files:** `apps/web/app/api/guilds/[guildId]/chat/route.ts`, other paginated routes

Replace `created_at`-only cursors with composite keyset cursors encoded as `base64(created_at + ':' + id)`. The WHERE clause becomes `AND (created_at, id) < ($cursor_ts, $cursor_id)`.

---

### TASK-45 · Council join transaction + idempotency guard (IMP IDMP-01)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/council/join/route.ts`, new migration

Wrap the invitation check, existing-member check, UPDATE, and INSERT in a single transaction with `FOR UPDATE` on the existing-member check. Add `UNIQUE(user_id, cycle_month)` on `platform_council_members`; use `ON CONFLICT DO NOTHING RETURNING id`.

---

### TASK-46 · Classroom quiz attempt idempotency guard (IMP IDMP-02)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts`, new migration

Add `UNIQUE(quiz_id, user_id)` to `classroom_quiz_attempts`. Replace the SELECT-then-INSERT "already attempted" check with `INSERT ... ON CONFLICT (quiz_id, user_id) DO NOTHING RETURNING id`, throwing a 409 on conflict.

---

### TASK-47 · Add `Retry-After` header to rate-limited responses (IMP RATE-01)

**Effort:** ~1 hour
**Files:** `apps/web/lib/security/rateLimit.ts`, `apps/web/lib/api/errors.ts`

Return the remaining window time from the Lua script as a fourth return value; add `Retry-After: <seconds>` to 429 responses.

---

### TASK-48 · Upgrade session cookies to `SameSite=Strict` (IMP SEC-05)

**Effort:** ~30 minutes
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/logout/route.ts`

Evaluate whether any OAuth redirect flow requires cookies on top-level navigations from an external origin (Google/Telegram). If not, upgrade from `SameSite=Lax` to `SameSite=Strict` for defense-in-depth alongside the existing Origin-header CSRF check.

---

### TASK-49 · Stream monthly gift drop notifications to avoid memory spike (IMP SCALE-01)

**Effort:** ~2 hours
**Files:** `apps/web/lib/events/monthlyGiftDrop.ts`

Replace the unbounded `SELECT id FROM users ...` with a cursor-paginated loop processing 10,000 users at a time (`WHERE id > $lastId ORDER BY id LIMIT 10000`), feeding each batch to `insertNotificationBatch`.

---

## Summary Table

| Task | Bug/Item | Priority | Effort |
|------|----------|----------|--------|
| TASK-01 | SYS-CL-ROOT | P0 | ~3 hrs |
| TASK-02 | SYS-CL-01 | P0 | ~30 min |
| TASK-03 | SYS-CL-02 | P0 | ~45 min |
| TASK-04 | SYS-CL-03 | P0 | ~30 min |
| TASK-05 | SYS-CL-04 | P0 | ~45 min |
| TASK-06 | SYS-CL-05 | P0 | ~45 min |
| TASK-07 | SYS-CL-06 | P0 | ~30 min |
| TASK-08 | SYS-CL-07 | P0 | ~30 min |
| TASK-09 | SYS-CL-08 | P0 | ~20 min |
| TASK-10 | SYS-CL-09 | P0 | ~45 min |
| TASK-11 | SYS-CL-10 | P0 | ~30 min |
| TASK-12 | XP-GROUP-01 | P0 | ~1 hr |
| TASK-13 | BIZ-TIER-RACE | P0 | ~2 hrs |
| TASK-14 | CSRF-01 | P0 | ~1 hr |
| TASK-15 | FIN-01 | P0 | ~2 hrs |
| TASK-16 | STAR-NOIDEM | P1 | ~2 hrs |
| TASK-17 | GROUP-NOVALIDATE | P1 | ~1 hr |
| TASK-18 | GROUP-NORATELIMIT | P1 | ~30 min |
| TASK-19 | GROUP-NOMODERATION | P1 | ~45 min |
| TASK-20 | DODO-SUB-BONUS | P1 | ~20 min |
| TASK-21 | OFFLINE-IDEMP-GAP | P1 | ~1 hr |
| TASK-22 | DB-01 | P1 | ~1 hr |
| TASK-23 | DB-02 | P1 | ~45 min |
| TASK-24 | NOTIF-01 | P1 | ~30 min |
| TASK-25 | NOTIF-02 | P1 | ~20 min |
| TASK-26 | NOTIF-03 | P1 | ~20 min |
| TASK-27 | SYNC-01 | P1 | ~1.5 hrs |
| TASK-28 | AUTH-01 | P1 | ~30 min |
| TASK-29 | DB-03 | P1 | ~2 hrs |
| TASK-30 | PUSH-01 | P1 | ~2 hrs |
| TASK-31 | NOTIF-04 | P1 | ~30 min |
| TASK-32 | DB-04 | P1 | ~1 hr |
| TASK-33 | DB-05 | P1 | ~1 hr |
| TASK-34 | XP-01 | P1 | ~30 min |
| TASK-35 | WAR-01 | P1 | ~30 min |
| TASK-36 | UI-01 | P1 | ~30 min |
| TASK-37 | RACE-01 | P1 | ~30 min |
| TASK-38 | RACE-02 | P1 | ~1 hr |
| TASK-39 | SEC-01 | P2 | ~30 min |
| TASK-40 | SEC-02 | P2 | ~1 hr |
| TASK-41 | AUTH-02 | P2 | ~15 min |
| TASK-42 | SEC-03 | P2 | ~1 day |
| TASK-43 | SEC-04 | P2 | ~1 day |
| TASK-44 | IMP-CURSOR-01 | Q | ~2 hrs |
| TASK-45 | IMP-IDMP-01 | Q | ~45 min |
| TASK-46 | IMP-IDMP-02 | Q | ~45 min |
| TASK-47 | IMP-RATE-01 | Q | ~1 hr |
| TASK-48 | IMP-SEC-05 | Q | ~30 min |
| TASK-49 | IMP-SCALE-01 | Q | ~2 hrs |

**Total estimated effort:**
- P0 fixes: ~15 hours (~2 days) — note TASK-01, TASK-02, and TASK-06 should ship together (index migration + the two `quest_reward`-typed call sites)
- P1 fixes: ~19 hours (~2.5 days)
- P2 fixes: ~2.5 days
- Q quality items: ~7 hours (~1 day)
- **Grand total to reach 9.3/10: approximately 8–9 developer-days**

---

> **Reminder: do not begin implementation until the user has reviewed and approved both `custom-bugs-report.md` and this plan.**

**Plan generated:** Tuesday, June 16, 2026 · 09:26 AM UTC
**— End of plan —**
