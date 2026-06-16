# Zobia Social — Bug Fix Plan

**Generated:** Tuesday, June 16, 2026 · 11:17 AM UTC
**Based on:** `custom-bugs-report.md` — 19 items, all bugs

> **IMPORTANT: Do NOT begin any fix until the report and this plan have been reviewed and approved.**

This is the complete, final replacement for any earlier draft of this plan. It covers only the 19 independently-verified items in the current report. Fixes are grouped by priority tier (P0 → P1), ordered by report item number within each tier. Each task is self-contained unless a dependency is noted.

---

## Priority Tiers

| Tier | Criteria |
|------|----------|
| **P0 — Critical** | Broken user-facing feature OR money correctness issue, 100% reproducible |
| **P1 — High** | Missing idempotency/security hardening or a narrower-window race condition |

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

## P1 — High (Fix Within Sprint)

---

### TASK-14 · Add unique constraint to `star_ledger` (BUG STAR-NOIDEM)

**Effort:** ~2 hours
**Files:** `apps/web/lib/db/schema.ts` (`starLedger`), `apps/web/lib/economy/stars.ts` (`writeStarLedgerEntry`), call sites in `apps/web/app/api/economy/stars/gift/route.ts`, `apps/web/app/api/economy/cosmetics/route.ts`

Add a partial unique index `UNIQUE (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` to `star_ledger`, add matching `ON CONFLICT ... DO NOTHING` to `writeStarLedgerEntry`, and audit call sites to ensure each passes a meaningful per-transaction-unique `referenceId` rather than e.g. the counterparty's user ID.

---

### TASK-15 · Add input validation to group chat POST (BUG GROUP-NOVALIDATE)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (line 147, POST handler)

Add a Zod schema (content length cap, `messageType` enum, `idempotencyKey` optional — see TASK-17) and validate via `validateBody`, matching the DM and room-messages routes' `sendMessageSchema` pattern.

---

### TASK-16 · Add rate limiting to group chat POST (BUG GROUP-NORATELIMIT)

**Effort:** ~30 minutes
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)

Add `enforceRateLimit(userId, "user", RATE_LIMITS.<messageSend>)` at the top of the handler, matching the DM and room-messages routes.

---

### TASK-17 · Add auto-moderation to group chat POST (BUG GROUP-NOMODERATION)

**Effort:** ~45 minutes
**Files:** `apps/web/app/api/messages/group/[groupId]/route.ts` (POST handler)

Add the same `applyAutoModeration` call (profanity, duplicate-message, bot-velocity detection) used in the room-messages route, before persisting the message. Currently only contact-info/link stripping (`filterPublicContent`) runs.

---

### TASK-18 · Fix offline-queued room/group messages losing their idempotency key (BUG OFFLINE-IDEMP-GAP)

**Effort:** ~1 hour
**Files:** `apps/web/app/api/rooms/[roomId]/messages/route.ts` (schema, lines 49-60), `apps/web/app/api/messages/group/[groupId]/route.ts`, `apps/web/lib/api/middleware.ts` (lines 455, 471)

Add `idempotencyKey: z.string().max(128).optional()` to both the room and group message Zod schemas, and add the same existing-row idempotency check the DM route already performs (`apps/web/app/api/messages/dm/[conversationId]/route.ts` lines 304/450/495). Currently Zod's default `.parse()` silently strips the unknown field instead of erroring, so retried offline-queued messages have no server-side duplicate protection.

---

### TASK-19 · Fix DodoPayments subscription bonus missing duplicate-key guard (BUG DODO-SUB-BONUS)

**Effort:** ~20 minutes
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts` (lines 256-271)

Wrap the monthly subscription coin bonus `creditCoins` call in the same `.catch` pattern used by the Paystack handler (lines 493-533): check `err.code === '23505'`, log and continue, rather than letting the error propagate and roll back the entire transaction (including the already-applied plan upgrade).

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
| TASK-14 | STAR-NOIDEM | P1 | ~2 hrs |
| TASK-15 | GROUP-NOVALIDATE | P1 | ~1 hr |
| TASK-16 | GROUP-NORATELIMIT | P1 | ~30 min |
| TASK-17 | GROUP-NOMODERATION | P1 | ~45 min |
| TASK-18 | OFFLINE-IDEMP-GAP | P1 | ~1 hr |
| TASK-19 | DODO-SUB-BONUS | P1 | ~20 min |

**Total estimated effort:**
- P0 fixes: ~12 hours (~1.5 days) — note TASK-01, TASK-02, and TASK-06 should ship together (index migration + the two `quest_reward`-typed call sites)
- P1 fixes: ~5.5 hours (~1 day)
- **Grand total to reach 9/10: approximately 2.5 developer-days**

---

> **Reminder: do not begin implementation until the user has reviewed and approved both `custom-bugs-report.md` and this plan.**

**Plan generated:** Tuesday, June 16, 2026 · 11:17 AM UTC
**— End of plan —**
