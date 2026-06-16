# Zobia Social — Bug Fix Plan (Rev 3)

**Generated:** June 16, 2026 · 5:47 AM UTC  
**Based on:** `custom-bugs-report.md` Rev 3 — 30 items (24 bugs + 6 quality improvements)

> **IMPORTANT: Do NOT begin any fix until the report has been reviewed and approved.**

Fixes are grouped by priority tier (P0 → P2 → Q) then by theme. Each task is self-contained unless a dependency is noted.

---

## Priority Tiers

| Tier | Criteria |
|------|----------|
| **P0 — Critical** | Broken user-facing feature OR money correctness issue |
| **P1 — High** | Silent data corruption, money race, notification spam, or data loss |
| **P2 — Medium** | Security hardening, tech debt, deferred safety work |
| **Q — Quality** | Non-bug improvements required to reach 9.5 / 10 |

---

## P0 — Critical (Fix Immediately)

---

### TASK-01 · Fix Expo mobile OAuth login CSRF block (BUG-CSRF-01)

**Effort:** ~1 hour  
**Files:** `apps/expo/app/auth/login.tsx`

In `handleDeepLink`, add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the `headers` object of the raw `fetch()` call that POSTs to `/api/auth/mobile-token`. Optionally, refactor to use the shared Axios client (which already sets Origin) to prevent recurrence. Verify with a full Google/Telegram OAuth login on a device or emulator.

---

### TASK-02 · Fix double platform-fee deduction on creator payouts (BUG-FIN-01)

**Effort:** ~2 hours  
**Files:** `apps/web/app/api/cron/daily/route.ts` (Section 33)

`available_earnings_kobo` is already net. Remove the `platformFeeKobo = grossKobo * 0.10` line and set `netKobo = grossKobo`. Set `platformFeeKobo = 0` in the payout INSERT. Then audit existing `creator_payouts` rows for under-paid records (where `net_kobo < gross_kobo`) and issue adjustment payouts or `available_earnings_kobo` credits for affected creators. Add a test asserting `net_kobo === gross_kobo` when no secondary fee is intended.

---

## P1 — High (Fix Within Sprint)

---

### TASK-03 · Deduplicate council invitation notifications (BUG-NOTIF-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/app/api/cron/daily/route.ts`

Add `reference_id = 'council_invite:<userId>:<YYYY-WW>'` to the council invitation notification INSERT. The existing partial unique index will then fire correctly.

---

### TASK-04 · Deduplicate guild war final-hour notifications (BUG-NOTIF-02)

**Effort:** ~20 minutes  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'war_final_hour:<warId>'` to the final-hour notification INSERT.

---

### TASK-05 · Deduplicate guild tier-downgrade notifications (BUG-NOTIF-03)

**Effort:** ~20 minutes  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'` to the downgrade notification INSERT.

---

### TASK-06 · Stamp nemesis's `last_notified_at` on overtake events (BUG-NOTIF-04)

**Effort:** ~30 minutes  
**Files:** `apps/web/app/api/cron/daily/route.ts`

Collect nemesis user IDs alongside the overtaking user IDs and extend the `UPDATE nemesis_assignments SET last_notified_at = NOW()` to cover both sets: `WHERE user_id = ANY(($userIds || $nemesisIds)::uuid[])`.

---

### TASK-07 · Fix `guild_quests` missing unique constraint (BUG-DB-01)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/db/schema.ts`, new migration

Delete duplicate rows (`DELETE FROM guild_quests WHERE id NOT IN (SELECT MIN(id) FROM guild_quests GROUP BY guild_id, quest_type, week_start)`), then add `UNIQUE (guild_id, quest_type, week_start)` to the schema and migration. Update the `ON CONFLICT` column list in the CRON section to match.

---

### TASK-08 · Fix `guild_tier_history` missing coverage for non-war tier changes (BUG-DB-02)

**Effort:** ~45 minutes  
**Files:** `apps/web/lib/db/schema.ts`, new migration

Add a partial index: `CREATE UNIQUE INDEX ON guild_tier_history (guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`. Update the non-war promotion/demotion CRON section to use this as the `ON CONFLICT` target.

---

### TASK-09 · Fix `platform_events.name` constraint (BUG-DB-03)

**Effort:** ~2 hours  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, `apps/web/lib/events/flashXP.ts`, new migration

Drop `UNIQUE(name)` from `platform_events` and replace with `UNIQUE(name, starts_at)`. Update the annual recurrence cloning `ON CONFLICT` clause to `(name, starts_at)`. The Flash XP upsert then works automatically; remove or demote the `.catch(() => {})` to log errors rather than silently swallow. Test by inserting two events with the same name but different `starts_at` (both should succeed).

---

### TASK-10 · Fix alliance wars duplicate creation (BUG-DB-04)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, new migration

Add:
```sql
CREATE UNIQUE INDEX ON alliance_wars
  (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week);
```
Update the `ON CONFLICT` clause in the CRON to use `(LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week)`.

---

### TASK-11 · Fix Web PWA "sending" messages stranded after crash (BUG-SYNC-01)

**Effort:** ~1.5 hours  
**Files:** `apps/web/lib/offline/messageQueue.ts`, `apps/web/lib/offline/useOfflineSync.ts`

Add `resetSendingMessages()` to `messageQueue.ts` that opens the `messages` IndexedDB object store and updates all `status === "sending"` rows back to `"pending"`. Call it at the start of the reconnect handler in `useOfflineSync.ts`.

---

### TASK-12 · Fix DeviceNotRegistered push receipt purging all user tokens (BUG-PUSH-01)

**Effort:** ~2 hours  
**Files:** `apps/web/lib/notifications/push.ts`

Store a ticket-ID → device-token mapping at send time (e.g. Redis hash `push_ticket:<ticketId>` with 24h TTL, or a `push_tickets` table column). When processing a `DeviceNotRegistered` receipt, look up only the specific token for that ticket ID and delete only that `user_push_tokens` row.

---

### TASK-13 · Consolidate duplicate login-streak columns (BUG-DB-05)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/db/schema.ts`, all referencing files, new migration

Run `grep -r "loginStreak\|login_streak" apps/` to find all references. Select `login_streak_days` as canonical. Migration: `UPDATE users SET login_streak_days = GREATEST(login_streak, login_streak_days)`. Drop `login_streak`. Fix all references to use `login_streak_days`.

---

### TASK-14 · Fix null email in JWT signing (BUG-AUTH-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`, `apps/web/lib/auth/jwt.ts`

Option A (minimal): guard `email: user.email ?? ''`.
Option B (correct): make `email` optional in `AccessTokenPayload`, omit the claim when null, and update downstream consumers to handle an absent email claim. Option B is recommended to correctly model account types without email.

---

### TASK-15 · Fix guild chat XP daily cap counting rows instead of messages (BUG-XP-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/app/api/guilds/[guildId]/chat/route.ts`

The COUNT query counts all `xp_ledger` rows with `source = 'guild_chat'`. Each message inserts 2 rows (social + competitor tracks), so `CHAT_XP_DAILY_CAP = 20` fires after 10 messages. Fix: add `AND track = 'social'` to the COUNT query so it counts distinct messages (each contributes one social-track row), keeping `CHAT_XP_DAILY_CAP = 20` as the intended 20-message cap.

---

### TASK-16 · Wrap `recordWarContribution` in a transaction (BUG-WAR-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/guilds/recordWarContribution.ts`

Wrap the `war_contributions` upsert and the `guild_wars` points UPDATE in a single `db.transaction()` call. This ensures both succeed or both roll back, keeping member contribution totals in sync with guild-level war points.

---

### TASK-17 · Fix announcement modal serial-mode view tracking (BUG-UI-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/announcements/engine.ts`

At the end of `getActiveModalForUser`, after `selected` is determined, add:
```sql
INSERT INTO user_modal_views (user_id, modal_id, viewed_at)
VALUES ($userId, $selected.id, NOW())
ON CONFLICT (user_id, modal_id) DO UPDATE SET viewed_at = NOW()
```
This mirrors what `getActiveBannerForUser` already does correctly.

---

### TASK-18 · Fix sticker pack grant silent abort on race condition (BUG-RACE-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/stickers/milestoneStickers.ts`

After the `ON CONFLICT DO NOTHING` returns no rows (concurrent insert), fetch the existing pack ID with a follow-up SELECT instead of returning early:
```typescript
// When newPack[0] is undefined (conflict), resolve the existing ID
const existingPack = await db.query(`SELECT id FROM sticker_packs WHERE name = $1`, [grant.packName]);
packId = existingPack.rows[0]?.id;
if (!packId) return []; // genuinely missing — skip
```
Then continue to the `user_sticker_packs` INSERT as normal.

---

### TASK-19 · Fix classroom enrollment TOCTOU race condition (BUG-RACE-02)

**Effort:** ~1 hour  
**Files:** `apps/web/app/api/classroom/[roomId]/enroll/route.ts`, new migration

Move the existing-enrollment check inside the transaction. After the transaction's `SELECT coin_balance FOR UPDATE`, add:
```sql
SELECT id FROM classroom_enrolments WHERE room_id = $1 AND user_id = $2 FOR UPDATE
```
And throw `conflict()` if a row is found. Also add a migration to create `UNIQUE(room_id, user_id)` on `classroom_enrolments` as a final safety net.

---

## P2 — Medium (Fix Before Next Release)

---

### TASK-20 · Encrypt Expo MMKV offline store (BUG-SEC-03)

**Effort:** ~1 day  
**Files:** `apps/expo/lib/offline/store.ts`, new `apps/expo/lib/storage/mmkvKey.ts`

Generate a random 256-bit key at first launch using `crypto.getRandomValues`, store it in the Android Keystore via `react-native-keychain` or `expo-secure-store`, and pass it as `encryptionKey` to the MMKV constructor. Migrate existing unencrypted data on first encrypted run (read all values, delete old store, create encrypted store, write values back). Gate migration on a persisted boolean flag.

---

### TASK-21 · Remove `id` attribute from HTML sanitizer allowlist (BUG-SEC-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Remove `'id'` from `'*': ['class', 'id']`. If heading anchors need IDs, add `'h2': ['id']` etc. Add a test asserting `<div id="foo">` is sanitized to `<div>`.

---

### TASK-22 · Harden markdown link sanitizer with an allow-list (BUG-SEC-02)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Replace the deny-list scheme filter with DOMPurify configured with `ALLOWED_URI_REGEXP: /^(https?|mailto):/` on the rendered markdown HTML. Add tests for `blob:`, `file:`, and custom-scheme URIs.

---

### TASK-23 · Tighten pre-auth 2FA path guard to exact match (BUG-AUTH-02)

**Effort:** ~15 minutes  
**Files:** `apps/web/lib/api/middleware.ts`

Change `pathname.endsWith('/2fa/verify')` to `pathname === '/api/auth/2fa/verify'`.

---

### TASK-24 · Migrate legacy v1 field-encryption ciphertext to v2 (BUG-SEC-04)

**Effort:** ~1 day  
**Files:** `apps/web/lib/security/fieldEncryption.ts`, new migration script

Write a one-shot job that selects all rows with `v1:` prefixed ciphertext, decrypts with v1, re-encrypts with v2, and updates in a transaction. After 0 v1 rows remain, remove the v1 code path and confirm the master key is in a hardware-backed secret store (not in `.env`).

---

## Q — Quality Improvements to reach 9.5 / 10

---

### TASK-25 · Opaque cursor-based pagination (IMP-CURSOR-01)

**Effort:** ~2 hours  
**Files:** `apps/web/app/api/guilds/[guildId]/chat/route.ts`, other paginated routes

Replace `created_at`-only cursors with composite keyset cursors encoded as `base64(created_at + ':' + id)`. The WHERE clause becomes `AND (created_at, id) < ($cursor_ts, $cursor_id)`. This eliminates missing/duplicate pages when multiple messages share a millisecond timestamp.

---

### TASK-26 · Council join transaction + idempotency guard (IMP-IDMP-01)

**Effort:** ~45 minutes  
**Files:** `apps/web/app/api/council/join/route.ts`, new migration

Wrap the invitation check, existing-member check, UPDATE (close old seat), and INSERT (new seat) in a single transaction. Add `SELECT ... FOR UPDATE` to the existing-member check. Add migration: `ALTER TABLE platform_council_members ADD CONSTRAINT council_member_user_cycle_unique UNIQUE (user_id, cycle_month)`.

---

### TASK-27 · Classroom quiz attempt idempotency guard (IMP-IDMP-02)

**Effort:** ~45 minutes  
**Files:** `apps/web/app/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts`, new migration

Add `UNIQUE(quiz_id, user_id)` constraint to `classroom_quiz_attempts`. Change the "already attempted" check inside the transaction to use `INSERT ... ON CONFLICT (quiz_id, user_id) DO NOTHING RETURNING id` and detect the conflict to throw a 409. This replaces the racy SELECT-then-INSERT pattern.

---

### TASK-28 · Add `Retry-After` header to rate-limited responses (IMP-RATE-01)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/security/rateLimit.ts`, `apps/web/lib/api/errors.ts`

Return the remaining window time from the Lua script as a fourth return value. In the rate-limit enforcement middleware, add `Retry-After: <seconds>` to 429 responses. Expo clients and web fetch can then implement automatic exponential backoff.

---

### TASK-29 · Upgrade session cookies to `SameSite=Strict` (IMP-SEC-05)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/logout/route.ts`

Evaluate whether any OAuth redirect flow requires cookies to be sent on top-level navigations from an external origin (Google / Telegram). If not (cookies are only read on same-site requests), upgrade from `SameSite=Lax` to `SameSite=Strict` for defense-in-depth complementing the existing Origin-header CSRF check.

---

### TASK-30 · Stream monthly gift drop notifications to avoid memory spike (IMP-SCALE-01)

**Effort:** ~2 hours  
**Files:** `apps/web/lib/events/monthlyGiftDrop.ts`

Replace the unbounded `SELECT id FROM users WHERE ...` (loads all user IDs into memory) with a cursor-paginated loop that processes 10,000 users at a time using a keyset cursor (`WHERE id > $lastId ORDER BY id LIMIT 10000`). Pass each batch directly to `insertNotificationBatch`. This keeps memory flat at scale.

---

## Summary Table

| Task | Bug/Item | Priority | Effort |
|------|----------|----------|--------|
| TASK-01 | BUG-CSRF-01 | P0 | ~1 hr |
| TASK-02 | BUG-FIN-01 | P0 | ~2 hrs |
| TASK-03 | BUG-NOTIF-01 | P1 | ~30 min |
| TASK-04 | BUG-NOTIF-02 | P1 | ~20 min |
| TASK-05 | BUG-NOTIF-03 | P1 | ~20 min |
| TASK-06 | BUG-NOTIF-04 | P1 | ~30 min |
| TASK-07 | BUG-DB-01 | P1 | ~1 hr |
| TASK-08 | BUG-DB-02 | P1 | ~45 min |
| TASK-09 | BUG-DB-03 | P1 | ~2 hrs |
| TASK-10 | BUG-DB-04 | P1 | ~1 hr |
| TASK-11 | BUG-SYNC-01 | P1 | ~1.5 hrs |
| TASK-12 | BUG-PUSH-01 | P1 | ~2 hrs |
| TASK-13 | BUG-DB-05 | P1 | ~1 hr |
| TASK-14 | BUG-AUTH-01 | P1 | ~30 min |
| TASK-15 | BUG-XP-01 | P1 | ~30 min |
| TASK-16 | BUG-WAR-01 | P1 | ~30 min |
| TASK-17 | BUG-UI-01 | P1 | ~30 min |
| TASK-18 | BUG-RACE-01 | P1 | ~30 min |
| TASK-19 | BUG-RACE-02 | P1 | ~1 hr |
| TASK-20 | BUG-SEC-03 | P2 | ~1 day |
| TASK-21 | BUG-SEC-01 | P2 | ~30 min |
| TASK-22 | BUG-SEC-02 | P2 | ~1 hr |
| TASK-23 | BUG-AUTH-02 | P2 | ~15 min |
| TASK-24 | BUG-SEC-04 | P2 | ~1 day |
| TASK-25 | IMP-CURSOR-01 | Q | ~2 hrs |
| TASK-26 | IMP-IDMP-01 | Q | ~45 min |
| TASK-27 | IMP-IDMP-02 | Q | ~45 min |
| TASK-28 | IMP-RATE-01 | Q | ~1 hr |
| TASK-29 | IMP-SEC-05 | Q | ~30 min |
| TASK-30 | IMP-SCALE-01 | Q | ~2 hrs |

**Total estimated effort:**
- P0 fixes: ~3 hours
- P1 fixes: ~15 hours (~2 days)
- P2 fixes: ~3 days
- Q quality items: ~7 hours (~1 day)
- **Grand total to reach 9.5/10: approximately 6–7 developer-days**

---

*Plan generated: June 16, 2026 · 5:47 AM UTC*
