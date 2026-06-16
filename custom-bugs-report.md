# Zobia Social — Forensic Bug Report

**Generated:** Tuesday, June 16, 2026 · 11:17 AM UTC
**Scope:** Full codebase — `apps/web` (Next.js App Router + PWA), `apps/expo` (Android), `shared/`
**Method:** Independent, line-by-line forensic review of the economy/ledger layer, chat surfaces, business-tier payments, and offline sync. No reliance on any prior bug report. CRON-frequency concerns are explicitly excluded per instruction (an external CRON service compensates for Vercel Hobby plan scheduling limits).

This is the complete, final replacement for any earlier draft of this report. It contains only issues independently verified in this pass — **19 items total**, each with exact file/line evidence. Any previously-circulated report should be considered superseded and discarded.

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

---

## Code quality / security rating

**Current state: 7.5/10.** The codebase shows real engineering discipline in many places — Decimal.js everywhere money is touched, `SELECT ... FOR UPDATE` row locking, an actual dead-letter-queue for failed XP awards and payouts, server-side re-derivation of payment amounts to defeat metadata tampering, deadlock-avoidance via deterministic lock ordering, SSRF protection with DNS pinning, versioned field encryption, and HMAC webhook verification. What pulls the score down is a single narrow-but-wide-blast-radius mistake: a missing column in one unique index (`coin_ledger`) quietly breaks roughly ten otherwise well-built features (quests, guilds, seasons, rooms, merch, cosmetics) the moment a shared resource is touched a second time by anyone, plus one chat surface (group messages) that never received the validation/rate-limit/moderation hardening its DM and room siblings already have, and two narrow payment-webhook race/guard gaps. These are exactly the kind of defects that pass casual manual QA (single user, single pass) and fail immediately under concurrent real-world usage.

**Projected state after fixes: 9/10.** None of these 19 issues require a redesign. They resolve into one schema migration plus call-site updates (items 1–11, the dominant cluster), one new index for stars (12), one helper-function fix (13), a small hardening pass to bring one chat route in line with its siblings (14–17), and two narrow, well-scoped payment-webhook fixes (18–19). Once applied, every currency ledger in the system would follow the same safe, idempotent, user-scoped pattern, every chat surface would share the same security posture, and both payment webhooks would handle retries/duplicates safely. The remaining gap to a perfect score reflects that this pass focused on the economy/ledger, chat, and payment layers specifically — it does not constitute a guarantee that other subsystems (notifications, CRON dedup, encryption, admin tooling) are free of comparable issues, since they were out of scope for this particular review.

---

**Report generated:** Tuesday, June 16, 2026 · 11:17 AM UTC
**— End of report —**
