# Zobia Social — Forensic Bug Report (Final, Consolidated)

**Generated:** Tuesday, June 16, 2026 · 09:18 AM UTC
**Scope:** Full codebase — `apps/web` (Next.js App Router + PWA), `apps/expo` (Android), `shared/`
**Method:** Independent, line-by-line forensic review across the entire codebase, multiple passes, no reliance on prior bug reports. CRON-frequency concerns are explicitly excluded per instruction (an external CRON service compensates for Vercel Hobby plan scheduling limits).

This is the complete, final replacement for any earlier draft of this report. It consolidates every issue confirmed across the full review, **49 items total** (43 bugs + 6 quality improvements), each with exact file/line evidence.

---

## Complete issue index (one line each)

1: BUG SYS-CL-ROOT: `coin_ledger`'s unique index has no `user_id` column, so any (transaction_type, reference_id) pair can only ever be inserted once platform-wide — root cause of items 2–11.
2: BUG SYS-CL-01: Daily quest coin reward uses the bare quest ID as the ledger reference, breaking for every user after the first one to complete that quest on a given day.
3: BUG SYS-CL-02: Room promotion purchase uses the bare room ID as the ledger reference, breaking on the second-ever promotion purchase for that room.
4: BUG SYS-CL-03: Sticker pack unlock uses the bare pack ID as the ledger reference, breaking for every user after the first to unlock that pack.
5: BUG SYS-CL-04: Guild treasury donation uses the bare guild ID as the ledger reference, breaking for every donation after the guild's first.
6: BUG SYS-CL-05: Guild quest completion's per-member coin reward loop reuses the bare quest ID for every member, guaranteeing a full transaction rollback for any multi-member guild quest with a coin reward — the single most severe, 100%-reproducible bug found in this review.
7: BUG SYS-CL-06: Season pass purchase uses the bare season ID as the ledger reference, breaking for every user after the first to buy that season's pass.
8: BUG SYS-CL-07: Season pass gifting uses the bare season ID as the ledger reference, breaking for every sender after the first to gift that season's pass.
9: BUG SYS-CL-08: Season milestone coin reward uses a reference key that omits the user ID, breaking for every user after the first to claim that milestone.
10: BUG SYS-CL-09: Merch purchase debits the buyer using the bare product ID as the ledger reference, breaking on the second-ever purchase of that product (by any buyer).
11: BUG SYS-CL-10: Cosmetic item coin purchase uses the bare item ID as the ledger reference, breaking for every buyer after the first to purchase that cosmetic.
12: BUG STAR-NOIDEM: `star_ledger` has no unique constraint at all, so star debits/credits (gifts, cosmetic purchases, IAP) have zero protection against duplicate-request double-processing.
13: BUG XP-GROUP-01: Group chat XP awards bypass the safe XP helper and use a raw, un-deduplicated insert keyed on the bare group ID, breaking after a user's first message to any given group.
14: BUG GROUP-NOVALIDATE: Group chat message POST has no schema validation at all (unlike the DM and room message routes).
15: BUG GROUP-NORATELIMIT: Group chat message POST has no rate limiting, unlike DM and room message routes.
16: BUG GROUP-NOMODERATION: Group chat message POST never runs auto-moderation (profanity/duplicate/bot-velocity checks), only contact-info stripping.
17: BUG OFFLINE-IDEMP-GAP: Expo's offline sync sends an `idempotencyKey` for queued room and group messages, but only the DM endpoint actually consumes it — room/group endpoints silently drop the field.
18: BUG BIZ-TIER-RACE: Re-initiating a business tier upgrade overwrites the pending payment reference, so completing payment against a stale (first) reference silently fails to activate the tier while still sending a false "upgraded" notification, because neither webhook checks whether its `UPDATE` actually matched a row.
19: BUG DODO-SUB-BONUS: DodoPayments' subscription monthly coin bonus is not guarded against duplicate-key (23505) errors the way the Paystack equivalent is, so a collision rolls back the entire subscription-activation transaction, including the already-applied plan upgrade.
20: BUG CSRF-01: Expo deep-link POST to `/api/auth/mobile-token` uses raw `fetch()` with no `Origin` header, blocked by middleware with 403; OAuth login on mobile is fully broken.
21: BUG DB-01: `guild_quests` table has no unique constraint; `ON CONFLICT DO NOTHING` in the Monday quest-reset CRON is inert, creating duplicate rows on every retry.
22: BUG DB-02: `guild_tier_history` partial unique index only covers rows where `war_id IS NOT NULL`; non-war tier changes insert duplicate history rows on CRON retry.
23: BUG NOTIF-01: Council invitation notifications are inserted without a `referenceId`; the partial unique index (`WHERE reference_id IS NOT NULL`) never fires; each CRON run duplicates them.
24: BUG NOTIF-02: Guild war final-hour notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
25: BUG NOTIF-03: Guild tier-downgrade notifications are inserted without a `referenceId`, allowing duplicates on every CRON re-run.
26: BUG SYNC-01: Web PWA offline sync never resets "sending" messages to "pending" on reconnect; messages stuck in "sending" after a browser crash are permanently stranded.
27: BUG AUTH-01: `user.email` is `string | null` in the DB schema but passed directly to `signAccessToken` which expects `string`; a null email produces a malformed JWT claim.
28: BUG SEC-01: HTML sanitizer allows the `id` attribute on every element via `'*': ['class', 'id']`, enabling DOM-clobbering and CSS injection attacks.
29: BUG SEC-02: Markdown link sanitizer only blocks 3 URI schemes (`javascript:`, `vbscript:`, `data:`); `blob:`, `file:`, and custom protocols pass through unchecked.
30: BUG AUTH-02: Pre-auth 2FA gate uses fragile `endsWith('/2fa/verify')` path match instead of a strict exact-equality check.
31: BUG DB-03: `platform_events.name` single-column UNIQUE constraint silently breaks annual event recurrence AND causes the Flash XP `platform_events` upsert to throw and be swallowed by `.catch`.
32: BUG PUSH-01: `DeviceNotRegistered` push receipt handling fetches and purges all tokens for the user instead of only the one specific failed device token.
33: BUG SEC-03: Expo MMKV offline store is intentionally left unencrypted ("Phase 2" deferred); sensitive data including message drafts sits in plaintext on the device.
34: BUG NOTIF-04: Nemesis overtake `last_notified_at` UPDATE only stamps the overtaking user's assignment row; the nemesis's own row is not updated, causing repeated triumph notifications.
35: BUG FIN-01: Weekly payout CRON applies a second 10% platform fee to `available_earnings_kobo`, which is already net after the fee was deducted at credit time; creators are underpaid.
36: BUG DB-04: Alliance war creation uses `ON CONFLICT DO NOTHING` but `alliance_wars` has no unique constraint on the alliance pair + week; duplicate wars can be created on CRON retry.
37: BUG DB-05: `users` table has two separate columns for the same concept (`login_streak` and `login_streak_days`); divergent writes corrupt streak data.
38: BUG SEC-04: Legacy v1 field encryption derives the AES key with a single SHA-256 hash (no salt, no iterations); existing v1 ciphertext is vulnerable to offline brute-force.
39: BUG XP-01: Guild chat XP daily cap (`CHAT_XP_DAILY_CAP = 20`) counts xp_ledger rows, not messages; each message inserts 2 rows, so the cap fires after 10 messages instead of 20.
40: BUG WAR-01: `recordWarContribution` issues two DB queries without a transaction; a failure between them causes guild-level war points to diverge from member contributions.
41: BUG UI-01: Announcement modal serial-mode reads `user_modal_views` to find unviewed modals but never writes a view record; it always returns modal #1.
42: BUG RACE-01: `milestoneStickers.ts` sticker pack grant silently aborts when a concurrent INSERT triggers `ON CONFLICT DO NOTHING`; the user never receives their earned sticker pack.
43: BUG RACE-02: Classroom enrollment existence check runs outside the transaction; concurrent requests can both pass it, double-deduct coins, and create duplicate enrollment records.
44: IMP CURSOR-01: Guild chat (and other routes) uses raw `created_at` timestamps as pagination cursors; timestamp ties cause page gaps or duplicates under load.
45: IMP IDMP-01: Council join endpoint performs invitation check, membership check, and INSERT as independent queries; a race or double-tap creates duplicate council memberships.
46: IMP IDMP-02: Classroom quiz attempt uses SELECT-then-INSERT without `FOR UPDATE` or a unique constraint; concurrent submissions can both pass the duplicate check and award double XP.
47: IMP RATE-01: Rate limiter returns 429 without a `Retry-After` header; API clients cannot implement correct automatic backoff.
48: IMP SEC-05: Session cookies use `SameSite=Lax`; upgrading to `SameSite=Strict` (where OAuth flows permit) would add an additional CSRF isolation layer.
49: IMP SCALE-01: Monthly gift drop announcement fetches all user IDs with no LIMIT; at scale (1M+ users) this loads millions of UUIDs into Node.js memory in a single query.

---

## Detailed findings

### 1: BUG SYS-CL-ROOT: `coin_ledger` unique index missing `user_id`
**FILES:** `apps/web/lib/db/schema.ts` (lines ~1899-1921, `uidx_coin_ledger_tx_type_ref`)
**FIX:** This is the root cause behind bugs #2–#11. The index is `UNIQUE (transaction_type, reference_id) WHERE reference_id IS NOT NULL` — note the absence of `user_id`. Since `reference_id` is frequently a shared resource ID (quest ID, room ID, season ID, etc.) rather than a per-user value, the index silently caps any given (type, reference_id) pair to a single row across the *entire platform*, for any user, forever. Add `user_id` to the index — `UNIQUE (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` — matching the (correct) pattern already used for `xp_ledger`'s `uidx_xp_ledger_source_ref`. Requires a migration plus auditing every call site, since some may need their `referenceId` argument adjusted in tandem (see #2–#11). Also add `ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to `writeLedgerEntry` in `lib/economy/coins.ts` so legitimate retries become safe no-ops instead of throwing.

### 2: BUG SYS-CL-01: Daily quest reward — shared questId reference
**FILES:** `apps/web/lib/quests/questEngine.ts` (line 256)
**FIX:** `creditCoins(userId, coinsAwarded, "quest_reward", questId, ...)` passes the bare `questId`. Change to a per-user, per-day key, e.g. `` `quest:${questId}:${userId}:${today}` `` — mirroring the pattern already used correctly for the XP award two lines above in the same function.

### 3: BUG SYS-CL-02: Room promotion — shared roomId reference
**FILES:** `apps/web/app/api/rooms/[roomId]/promote/route.ts` (lines 139-146)
**FIX:** `debitCoins(auth.user.sub, coinCost, "room_promotion", roomId, ...)` uses the bare `roomId`. Since `room_promotions` supports repeat/extended promotions via `ON CONFLICT (room_id) DO UPDATE`, any second promotion purchase for the same room — even by the same creator — collides and the whole transaction rolls back. Scope per-purchase, e.g. insert the promotion row first inside the same transaction and use its own ID as the reference.

### 4: BUG SYS-CL-03: Sticker pack unlock — shared packId reference
**FILES:** `apps/web/app/api/stickers/route.ts` (lines 157-165)
**FIX:** `debitCoins(userId, pack.coin_price, "sticker_pack", packId, ...)` uses the bare `packId`. The first user to unlock any given paid pack succeeds; every subsequent user fails outright. Scope per-user: `` `sticker_pack:${packId}:${userId}` ``.

### 5: BUG SYS-CL-04: Guild treasury donation — shared guildId reference
**FILES:** `apps/web/app/api/guilds/[guildId]/treasury/route.ts` (lines 178-192)
**FIX:** The `donate` action debits the user via a direct balance UPDATE, then inserts into `coin_ledger` with `transaction_type='guild_donation'` and bare `reference_id=guildId`. Only the guild's first-ever donation succeeds; every later donation by any member fails and rolls back (undoing the treasury credit too). Scope per-donation, e.g. `` `guild_donation:${guildId}:${userId}:${Date.now()}` ``, or route through `debitCoins` with a generated donation-transaction UUID.

### 6: BUG SYS-CL-05: Guild quest contribution — per-member loop reuses questId (most severe instance)
**FILES:** `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts` (lines 154-177)
**FIX:** When a guild quest with `reward_coins > 0` completes, the code loops over every guild member and calls `creditCoins(member.user_id, coinsPerMember, "quest_reward", questId, ...)` for each — reusing the identical `(quest_reward, questId)` pair every iteration. The second member's credit collides with the first's already-inserted row and throws *inside the single transaction wrapping the entire contribute operation*, rolling back the quest-completion flag, the guild XP award, and every member's coin credit. Any multi-member guild quest with a coin reward will deterministically fail every time. Scope per-member: `` `guild_quest_reward:${questId}:${member.user_id}` ``.

### 7: BUG SYS-CL-06: Season pass purchase — shared seasonId reference
**FILES:** `apps/web/app/api/seasons/[seasonId]/pass/route.ts` (lines 163-174)
**FIX:** The POST handler inserts directly into `coin_ledger` with `transaction_type='season_pass_purchase'` and bare `reference_id=seasonId`. Only the first buyer of that season's pass succeeds. Scope per-user: `` `season_pass:${seasonId}:${userId}` ``.

### 8: BUG SYS-CL-07: Season pass gift — shared seasonId reference
**FILES:** `apps/web/app/api/seasons/[seasonId]/pass/gift/route.ts` (lines 133-141)
**FIX:** `debitCoins(senderId, season.pass_price_coins, "season_pass_gift", seasonId, ...)` debits the *sender* using the bare `seasonId`. Only the first sender to ever gift a pass for that season succeeds. Scope per-sender-per-recipient: `` `season_pass_gift:${seasonId}:${senderId}:${recipientUserId}` ``.

### 9: BUG SYS-CL-08: Season milestone claim — reference key omits userId
**FILES:** `apps/web/app/api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim/route.ts` (lines 200-209)
**FIX:** `creditCoins(userId, reward.coins, "season_milestone", \`season_milestone:${milestoneId}\`, ...)` builds a reference that looks scoped but contains only `milestoneId`. A separate DB check (`user_season_milestone_claims`) prevents one user double-claiming, but does nothing for *different* users claiming the *same* milestone — only the first claimant platform-wide succeeds. Add the user ID: `` `season_milestone:${milestoneId}:${userId}` ``.

### 10: BUG SYS-CL-09: Merch purchase — buyer debit uses shared productId reference
**FILES:** `apps/web/app/api/merch/purchase/route.ts` (lines 184-198)
**FIX:** `debitCoins(buyerId, coinCost, "merch_purchase", body.productId, ...)` uses the bare `productId` for the buyer-side debit. (The creator-side credit later in the same handler, lines 250-266, correctly uses the newly-created `orderId` and is safe.) Only the first purchase of any given product succeeds. Scope the buyer-side reference to the order created in the same transaction (insert `merch_orders` first, use its ID), matching what the credit side already does.

### 11: BUG SYS-CL-10: Cosmetic purchase — shared itemId reference
**FILES:** `apps/web/app/api/economy/cosmetics/route.ts` (lines 240-246)
**FIX:** `debitCoins(userId, item.coins_cost!, "cosmetic_purchase", body.itemId, ...)` uses the bare `itemId`. Only the first buyer of any given cosmetic succeeds. Scope per-user: `` `cosmetic_purchase:${body.itemId}:${userId}` ``. (The star-currency branch at lines 231-237 uses the same bare `itemId` — see #12.)

### 12: BUG STAR-NOIDEM: `star_ledger` has no unique constraint at all
**FILES:** `apps/web/lib/db/schema.ts` (`starLedger` table, ~lines 1924-1943); `apps/web/lib/economy/stars.ts`; e.g. `apps/web/app/api/economy/stars/gift/route.ts` (lines 81-96), `apps/web/app/api/economy/cosmetics/route.ts` (lines 231-237)
**FIX:** Unlike `coin_ledger`/`xp_ledger`, `star_ledger` has no unique index on `(user_id, transaction_type, reference_id)`. This is the inverse problem from #2–#11: zero protection against double-processing — a duplicated request (double-click, retried call, replayed webhook) debits/credits stars twice with no DB-level guard. Add a partial unique index `UNIQUE (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL`, add matching `ON CONFLICT ... DO NOTHING` to `writeStarLedgerEntry`, and audit call sites to ensure they pass a meaningful per-transaction-unique `referenceId` (some currently pass the counterparty's user ID rather than a transaction-specific key, which would under-protect even after the index lands).

### 13: BUG XP-GROUP-01: Group chat XP award uses an un-deduplicated, group-scoped reference
**FILES:** `apps/web/app/api/messages/group/[groupId]/route.ts` (lines 20-85, `maybeAwardGroupMessageXP`; call site line 184)
**FIX:** This function bypasses the shared `safeAwardXP` helper and does a raw `INSERT INTO xp_ledger` with **no `ON CONFLICT`**, using bare `groupId` as `reference_id` for both the sender's own XP (`group_message`) and the "award other members" loop (`group_message_member`). Since `xp_ledger`'s index is `(user_id, source, reference_id)`, a user's first message to a group succeeds, but their second message to that *same* group collides on `(user_id, 'group_message', groupId)` and throws — caught by the caller's outer try/catch and logged "non-fatal," but XP is never awarded again for that pair. Compare with the room-messages route (`apps/web/app/api/rooms/[roomId]/messages/route.ts`, ~lines 575-577), which correctly uses the new message's own UUID as the reference — apply the same pattern here.

### 14: BUG GROUP-NOVALIDATE: Group chat POST has no input validation
**FILES:** `apps/web/app/api/messages/group/[groupId]/route.ts` (line 147, POST handler)
**FIX:** `const body = await req.json();` is used directly with no Zod schema, unlike the DM and room-messages routes (`sendMessageSchema` via `validateBody`). Add a Zod schema (content length cap, `messageType` enum, `idempotencyKey` optional) and validate via `validateBody` — this also resolves part of #17.

### 15: BUG GROUP-NORATELIMIT: Group chat POST has no rate limiting
**FILES:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)
**FIX:** Neither `enforceRateLimit` nor any throttle is called anywhere in this handler, unlike the DM and room-messages routes. Add `enforceRateLimit(userId, "user", RATE_LIMITS.<messageSend>)` at the top of the handler.

### 16: BUG GROUP-NOMODERATION: Group chat POST never runs auto-moderation
**FILES:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)
**FIX:** Only `filterPublicContent` (contact-info/link stripping) runs; `applyAutoModeration` (profanity, duplicate-message, bot-velocity detection — used by both DM and room routes) is never called here. Add the same `applyAutoModeration` call used in the room-messages route before persisting.

### 17: BUG OFFLINE-IDEMP-GAP: Offline-queued room/group messages lose their idempotency key
**FILES:** `apps/expo/lib/offline/syncQueue.ts`; `apps/web/app/api/rooms/[roomId]/messages/route.ts` (schema, lines 49-60); `apps/web/app/api/messages/group/[groupId]/route.ts`; `apps/web/lib/api/middleware.ts` (lines 455, 471, `schema.parse`)
**FIX:** Expo's offline sync posts `{ content, messageType, idempotencyKey }` uniformly to room, group, and DM endpoints when flushing after reconnect. The DM route declares and checks `idempotencyKey` (confirmed at `apps/web/app/api/messages/dm/[conversationId]/route.ts` lines 304/450/495), but neither the room nor group schema declares it, and Zod's default `.parse()` silently strips unknown keys instead of erroring — the field is dropped with no warning. An offline-queued room/group message that gets retried therefore has no server-side duplicate-message protection. Add `idempotencyKey: z.string().max(128).optional()` to both schemas and the same existing-row check used in the DM route.

### 18: BUG BIZ-TIER-RACE: Business tier upgrade — stale pending reference race with false success notification
**FILES:** `apps/web/app/api/business/tier/route.ts` (lines 117-123); `apps/web/lib/payments/paystackWebhookHandler.ts` (lines 167-202); `apps/web/lib/payments/dodoWebhookHandler.ts` (lines 137-177)
**FIX:** Every call to `PATCH /api/business/tier` unconditionally overwrites `business_accounts.pending_tier`/`pending_payment_ref` with a fresh reference, with no check for an already-pending upgrade. If a user triggers the endpoint twice (double-click, two tabs, back-button resubmit) and completes payment against the *first*, now-stale reference, the webhook's `UPDATE business_accounts ... WHERE id = $2 AND pending_payment_ref = $3` matches zero rows (since `pending_payment_ref` was overwritten by the second attempt) — the tier is silently never activated. The subsequent notification insert runs unconditionally regardless of whether the `UPDATE` matched, so the user still receives a "Business Account Upgraded" notification despite paying and getting nothing. Fix by (a) rejecting a new upgrade PATCH while a non-expired `pending_payment_ref` already exists, and (b) checking the `UPDATE`'s row count before sending the notification (raising a `system_alert` for manual reconciliation if it didn't match), in both webhook handlers.

### 19: BUG DODO-SUB-BONUS: Dodo subscription monthly bonus lacks the duplicate-key guard the Paystack path has
**FILES:** `apps/web/lib/payments/dodoWebhookHandler.ts` (lines 256-271); compare `apps/web/lib/payments/paystackWebhookHandler.ts` (lines 493-533)
**FIX:** In the Paystack handler, the monthly subscription coin bonus `creditCoins` call is wrapped so a `23505` (duplicate key) — e.g. because the daily CRON's `monthly_plan_bonus` step already credited the same `plan:{userId}:{YYYY-MM}` key — is caught and treated as benign. The Dodo handler's equivalent call (inside `processPaymentSucceeded`'s single `db.transaction`) has no such guard: a collision propagates uncaught and rolls back the entire transaction, undoing the subscription upsert and `users.plan` update that already succeeded earlier in the same transaction. Add the same `.catch` pattern (check `err.code === '23505'`, log and continue).

### 20: BUG CSRF-01 — Expo mobile OAuth login blocked by CSRF check
**FILES:** `apps/expo/app/auth/login.tsx` (`handleDeepLink`); `apps/web/middleware.ts` (`isCsrfSafe`, `isAuthMutation`)
**FIX:** `handleDeepLink` performs a raw `fetch()` POST to `/api/auth/mobile-token` without an `Origin` header. Middleware classifies all POSTs to `/api/auth/*` as `isAuthMutation = true`, then `isCsrfSafe()` returns `false` with no Origin header, returning 403. The shared Axios client elsewhere in the Expo app already sets `Origin` but this isolated `fetch()` bypasses it. Add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the headers, or refactor to use the shared Axios instance.

### 21: BUG DB-01 — `guild_quests` missing unique constraint makes deduplication impossible
**FILES:** `apps/web/app/api/cron/daily/route.ts` (Monday quest-reset section); `apps/web/lib/db/schema.ts` (`guildQuests`)
**FIX:** `ON CONFLICT DO NOTHING` requires a matching unique constraint to be effective in PostgreSQL; `guild_quests` has none, so duplicate rows accumulate on every CRON retry. Add `UNIQUE (guild_id, quest_type, week_start)` and match the `ON CONFLICT` column list. Delete existing duplicates before migrating.

### 22: BUG DB-02 — Non-war guild tier changes bypass the `guild_tier_history` unique index
**FILES:** `apps/web/app/api/cron/daily/route.ts` (tier promotion/demotion section); `apps/web/lib/db/schema.ts` (`guildTierHistory`)
**FIX:** The partial unique index only covers rows where `war_id IS NOT NULL`. Add a second partial index: `UNIQUE (guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`.

### 23: BUG NOTIF-01 — Council invitation notifications duplicated on every CRON run
**FILES:** `apps/web/app/api/cron/daily/route.ts` (council invitation INSERT)
**FIX:** Inserted with `reference_id = NULL`, so the partial unique index (`WHERE reference_id IS NOT NULL`) never fires. Assign a deterministic `reference_id` such as `council_invite:<userId>:<YYYY-WW>`.

### 24: BUG NOTIF-02 — Guild war final-hour notifications duplicated on CRON re-runs
**FILES:** `apps/web/app/api/cron/guild-wars/route.ts` (final-hour notification INSERT)
**FIX:** Same root cause as #23. Assign `reference_id = 'war_final_hour:<warId>'`.

### 25: BUG NOTIF-03 — Guild tier-downgrade notifications duplicated on CRON re-runs
**FILES:** `apps/web/app/api/cron/guild-wars/route.ts` (tier-downgrade notification INSERT)
**FIX:** Same root cause as #23. Use `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'`.

### 26: BUG SYNC-01 — Web PWA offline sync permanently strands "sending" messages after crash
**FILES:** `apps/web/lib/offline/useOfflineSync.ts`; `apps/web/lib/offline/messageQueue.ts` (`getPendingMessages`)
**FIX:** `getPendingMessages()` uses `IDBKeyRange.only("pending")` — messages in "sending" state are invisible to the retry loop. The Expo equivalent correctly calls `resetSendingMessages()` first. Add the same function to `messageQueue.ts` and call it at the start of the reconnect handler.

### 27: BUG AUTH-01 — Null `user.email` passed as `string` to JWT signing
**FILES:** `apps/web/lib/auth/session.ts` (`createSession`); `apps/web/app/api/auth/2fa/verify/route.ts`; `apps/web/lib/auth/jwt.ts` (`AccessTokenPayload.email`)
**FIX:** `user.email` is `string | null` for Telegram/phone-only accounts. Make `email` optional in `AccessTokenPayload` and omit the claim when null (preferred), or minimally guard with `email: user.email ?? ''`.

### 28: BUG SEC-01 — HTML sanitizer allows `id` attribute, enabling DOM-clobbering
**FILES:** `apps/web/lib/security/htmlSanitizer.ts` (`SANITIZE_OPTIONS`)
**FIX:** `'*': ['class', 'id']` permits `id` on any user-controlled element. Remove `'id'` from the wildcard allowlist; allowlist it only on specific elements that need anchor navigation.

### 29: BUG SEC-02 — Markdown link sanitizer uses a deny-list of only 3 URI schemes
**FILES:** `apps/web/lib/security/htmlSanitizer.ts` (`sanitizeMarkdown`)
**FIX:** Replace the deny-list with a DOMPurify allow-list (`ALLOWED_URI_REGEXP: /^(https?|mailto):/`) applied to the rendered markdown HTML, blocking `blob:`, `file:`, and unknown custom schemes by default.

### 30: BUG AUTH-02 — Pre-auth 2FA gate uses fragile `endsWith` path match
**FILES:** `apps/web/lib/api/middleware.ts` (`withAuth` pre-auth bypass)
**FIX:** Replace `pathname.endsWith('/2fa/verify')` with `pathname === '/api/auth/2fa/verify'`.

### 31: BUG DB-03 — `platform_events.name` UNIQUE breaks annual recurrence AND Flash XP upsert
**FILES:** `apps/web/lib/db/schema.ts` (`platformEvents`); `apps/web/app/api/cron/daily/route.ts` (annual recurrence cloning); `apps/web/lib/events/flashXP.ts` (`advanceFlashXPLifecycle`)
**FIX:** The single-column `UNIQUE(name)` causes two silent failures: annual event cloning is swallowed by `ON CONFLICT DO NOTHING`, so next-year events are never created; and the Flash XP upsert references a non-existent composite index, throwing an error swallowed by `.catch`. Drop `UNIQUE(name)`, replace with `UNIQUE(name, starts_at)`, update all `ON CONFLICT` clauses accordingly.

### 32: BUG PUSH-01 — `DeviceNotRegistered` push receipt purges all tokens for the user
**FILES:** `apps/web/lib/notifications/push.ts` (receipt polling, `DeviceNotRegistered` branch)
**FIX:** On `DeviceNotRegistered`, the code marks every token for the user stale instead of just the failing one. Store a ticket-ID → token mapping at send time (Redis hash with 24h TTL, or a DB column); on receipt processing, delete only that specific token.

### 33: BUG SEC-03 — Expo MMKV offline store stores sensitive data in plaintext
**FILES:** `apps/expo/lib/offline/store.ts`
**FIX:** Generate a random 256-bit key at first launch, store it via `expo-secure-store`/Android Keystore, pass it as `encryptionKey` to MMKV. Migrate existing unencrypted data on first run.

### 34: BUG NOTIF-04 — Nemesis overtake `last_notified_at` misses the nemesis's own row
**FILES:** `apps/web/app/api/cron/daily/route.ts` (nemesis overtake notification section)
**FIX:** The UPDATE only stamps the overtaking users. Collect nemesis IDs separately and extend the UPDATE to cover both sets.

### 35: BUG FIN-01 — Weekly payout CRON double-charges platform fee on creator earnings
**FILES:** `apps/web/app/api/cron/daily/route.ts` (weekly payout aggregation section)
**FIX:** `available_earnings_kobo` is already net of the platform fee deducted at credit time. Remove the secondary fee calculation; set `netKobo = grossKobo`. Audit existing payout records for underpayment and issue corrections.

### 36: BUG DB-04 — Alliance war `ON CONFLICT DO NOTHING` is inert (no matching unique constraint)
**FILES:** `apps/web/app/api/cron/daily/route.ts`; `apps/web/lib/db/schema.ts` (`allianceWars`)
**FIX:** Add a unique index normalizing pair order: `CREATE UNIQUE INDEX ON alliance_wars (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week)`; update the `ON CONFLICT` clause to match.

### 37: BUG DB-05 — Duplicate login-streak columns (`login_streak` and `login_streak_days`)
**FILES:** `apps/web/lib/db/schema.ts` (`users`)
**FIX:** Audit all read/write sites, select `login_streak_days` as canonical, migrate with `GREATEST(login_streak, login_streak_days)`, drop `login_streak`, update all references.

### 38: BUG SEC-04 — Legacy v1 field encryption uses bare SHA-256 as the KDF
**FILES:** `apps/web/lib/security/fieldEncryption.ts` (v1 key derivation path)
**FIX:** Run a background job to decrypt all v1-prefixed ciphertext and re-encrypt with v2 (scrypt + random salt). Remove the v1 code path once 0 v1 rows remain; ensure the master key lives in a hardware-backed secret store.

### 39: BUG XP-01 — Guild chat XP daily cap fires at 10 messages instead of intended 20
**FILES:** `apps/web/app/api/guilds/[guildId]/chat/route.ts` (XP award section)
**FIX:** `CHAT_XP_DAILY_CAP = 20` is compared against a COUNT of all `xp_ledger` rows with `source = 'guild_chat'`; each message inserts 2 rows (social + competitor tracks), so the count hits 20 after 10 messages. Add `AND track = 'social'` to the COUNT query.

### 40: BUG WAR-01 — `recordWarContribution` lacks a transaction; guild war points can diverge
**FILES:** `apps/web/lib/guilds/recordWarContribution.ts`
**FIX:** Two sequential queries (upsert `war_contributions`, then UPDATE `guild_wars` points) run outside a transaction. Wrap both in `db.transaction()`.

### 41: BUG UI-01 — Announcement modal serial-mode never writes views; always shows modal #1
**FILES:** `apps/web/lib/announcements/engine.ts` (`getActiveModalForUser`)
**FIX:** Add an upsert into `user_modal_views` after a modal is selected, mirroring what `getActiveBannerForUser` already does correctly.

### 42: BUG RACE-01 — Milestone sticker pack grant silently aborts on concurrent inserts
**FILES:** `apps/web/lib/stickers/milestoneStickers.ts` (`awardMilestoneStickers`)
**FIX:** When a concurrent `INSERT ... ON CONFLICT (name) DO NOTHING RETURNING id` returns no rows, the function exits early without granting anything. Fall back to `SELECT id FROM sticker_packs WHERE name = $1` to resolve the existing pack ID, then proceed with the `user_sticker_packs` INSERT.

### 43: BUG RACE-02 — Classroom enrollment existence check outside transaction enables coin double-spend
**FILES:** `apps/web/app/api/classroom/[roomId]/enroll/route.ts`
**FIX:** Move the existing-enrollment check inside the transaction with `FOR UPDATE`. Add `UNIQUE(room_id, user_id)` to `classroom_enrolments` as a final safety net.

### 44: IMP CURSOR-01 — Timestamp-only pagination cursors cause page gaps under concurrent writes
**FILES:** `apps/web/app/api/guilds/[guildId]/chat/route.ts` and any other route using `created_at` as the sole cursor
**FIX:** Replace with a composite keyset cursor (`base64(created_at + ':' + id)`); WHERE clause becomes `(created_at, id) < ($cursor_ts, $cursor_id)`.

### 45: IMP IDMP-01 — Council join endpoint has no transaction or idempotency guard
**FILES:** `apps/web/app/api/council/join/route.ts`
**FIX:** Wrap invitation check, membership check, UPDATE, and INSERT in one transaction with `FOR UPDATE`; add `UNIQUE(user_id, cycle_month)` on `platform_council_members`; use `ON CONFLICT DO NOTHING RETURNING id`.

### 46: IMP IDMP-02 — Classroom quiz attempt has no unique constraint; concurrent submissions award double XP
**FILES:** `apps/web/app/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts`
**FIX:** Add `UNIQUE(quiz_id, user_id)`; replace SELECT-then-INSERT with `INSERT ... ON CONFLICT (quiz_id, user_id) DO NOTHING RETURNING id` and detect conflict to throw 409.

### 47: IMP RATE-01 — Rate limiter returns 429 without a `Retry-After` header
**FILES:** `apps/web/lib/security/rateLimit.ts`; `apps/web/lib/api/errors.ts`
**FIX:** Return the remaining window time from the Lua script and include it as `Retry-After` on 429 responses.

### 48: IMP SEC-05 — Session cookies use `SameSite=Lax`; `SameSite=Strict` is available
**FILES:** `apps/web/lib/auth/session.ts`; `apps/web/app/api/auth/logout/route.ts`
**FIX:** If no OAuth redirect flow requires the cookie on a top-level cross-origin navigation, upgrade both access and refresh cookies to `SameSite=Strict`.

### 49: IMP SCALE-01 — Monthly gift drop announcement loads all user IDs into memory with no LIMIT
**FILES:** `apps/web/lib/events/monthlyGiftDrop.ts` (`processPendingGiftDrops`)
**FIX:** Replace the unbounded `SELECT id FROM users ...` with a cursor-paginated batch loop (`WHERE id > $lastId ORDER BY id LIMIT 10000`), feeding each batch to `insertNotificationBatch`.

---

## Code quality / security rating

**Current state: 7/10.** The codebase shows real engineering discipline in many places — Decimal.js everywhere money is touched, `SELECT ... FOR UPDATE` row locking, an actual dead-letter-queue for failed XP awards and payouts, server-side re-derivation of payment amounts to defeat metadata tampering, deadlock-avoidance via deterministic lock ordering, SSRF protection with DNS pinning, versioned field encryption, HMAC webhook verification, and a long trail of "BUG-NN" comments showing the team has iterated and fixed real issues before. What pulls the score down is a cluster of narrow-but-wide-blast-radius mistakes rather than weak fundamentals: a single missing column in one unique index (`coin_ledger`) quietly breaks roughly ten otherwise well-built features (quests, guilds, seasons, rooms, merch, cosmetics) the moment a shared resource is touched a second time by anyone; one chat surface (group messages) never received the validation/rate-limit/moderation hardening its DM and room siblings already have; and a handful of CRON-driven notification/dedup paths use `ON CONFLICT` against indexes or reference IDs that don't actually cover the case being deduplicated. These are exactly the kind of defects that pass casual manual QA (single user, single pass) and fail immediately under concurrent real-world usage — and that is consistent with what was found here.

**Projected state after fixes: 9.3/10.** None of the 49 issues require a redesign. They resolve into: one schema migration plus call-site updates (items 1–11, the dominant cluster), one new index for stars (12), one helper-function fix (13), a small hardening pass to bring one chat route in line with its siblings (14–17), two narrow payment-webhook fixes (18–19), and a long tail of well-scoped, independent fixes for CRON dedup, notification keys, encryption hardening, race conditions, and quality-of-life improvements (20–49). Once applied, every currency ledger in the system would follow the same safe, idempotent, user-scoped pattern; every chat surface would share the same security posture; and the CRON/notification layer would be fully idempotent under retries. The remaining gap to a perfect score is held back only by the inherent complexity of the platform's scope (three offline-sync engines, two payment providers, dual realtime providers, web+mobile split) and by the fact that even an exhaustive manual review cannot constitute formal proof of completeness in lower-traffic areas (admin tooling, classroom/quiz flows) that received comparatively less call-site density in this pass.

---

**Report generated:** Tuesday, June 16, 2026 · 09:18 AM UTC
**— End of report —**
