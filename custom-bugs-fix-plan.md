# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-21 02:10 AM  
**Based on:** custom-bugs-report.md (23 bugs)  
**Priority order:** Critical (data/money integrity) → High (auth/security) → Medium (reliability) → Low (code quality/docs)

---

## Phase 1 — Critical: Payment Integrity & Security (Fix First)

### TASK-1: Seed Creator Fund for `room_subscription` payments (BUG-PAY-01)
**Priority:** Critical  
**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`, `apps/web/lib/payments/dodoWebhookHandler.ts`  
**Effort:** Small

In `paystackWebhookHandler.ts`, before the `return` at line 181 (end of `room_subscription` block), add the Creator Fund seeding logic:
```ts
const creatorFundContributionKobo = Math.floor((subGrossKobo ?? amount) * 0.05);
if (creatorFundContributionKobo > 0) {
  await tx.query(
    `INSERT INTO x_manifest (key, value, updated_at) VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
     ON CONFLICT (key) DO UPDATE SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT, updated_at = NOW()`,
    [creatorFundContributionKobo]
  );
}
```
Apply the identical fix in `dodoWebhookHandler.ts` before line 275's `return;`.

---

### TASK-2: Seed Creator Fund for `room_entry` payments (BUG-PAY-02)
**Priority:** Critical  
**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`  
**Effort:** Small

Before the `return` at the end of the `room_entry` block (line 187), add the same Creator Fund seeding as in TASK-1. Use `amount` (the kobo value from the payment) as the gross.

---

### TASK-3: Fix DodoPayments `subscription` Creator Fund inconsistency (BUG-PAY-03)
**Priority:** High  
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts`  
**Effort:** Small

After the `await creditCoins(userId, bonusCoins, ...)` call inside the `subscription` block, add a `return;` statement so that plan subscription payments do not fall through to the Creator Fund seeding — matching the Paystack handler's behaviour. Confirm with product/finance whether platform subscription revenue should ever seed the Creator Fund before finalising this decision.

---

### TASK-4: Fix GCM authentication tag failure silent swallow (BUG-ENC-01)
**Priority:** Critical  
**Files:** `apps/web/lib/security/fieldEncryption.ts`  
**Effort:** Small

In `decryptRaw`, when the `decipher.final()` call throws (indicating auth tag mismatch), catch the error separately from other decrypt errors and re-throw with a distinct error type:
```ts
class DecryptionIntegrityError extends Error { name = "DecryptionIntegrityError"; }
// In the catch block inside decryptRaw:
if (err.message?.includes('Unsupported state') || err.message?.includes('auth tag')) {
  throw new DecryptionIntegrityError(`GCM auth tag failed for version ${version}`);
}
```
In `decryptField`, let `DecryptionIntegrityError` propagate (do not catch it). All callers of `decryptField` will then surface configuration/tamper errors correctly. Separately log a `system_alerts` entry with severity `'critical'` when this error type is detected.

---

## Phase 2 — High: Auth & Session Security

### TASK-5: Fix Expo startup refresh clearing session on network error (BUG-EXPO-01 + BUG-EXPO-02)
**Priority:** High  
**Files:** `apps/expo/lib/auth/context.tsx`  
**Effort:** Medium

Extract the silent-refresh logic into a shared `silentRefresh(storedRefreshToken)` function:
- If the fetch throws (network error, `TypeError`, `AbortError`): do nothing. Return `null`. Log a warning.
- If `resp.ok === false` (HTTP 401/403): delete credentials from SecureStore and return `null`.
- If `resp.ok === true`: update SecureStore with new tokens, return new access token.

Replace both the startup `useEffect` refresh and the AppState `'change'` listener with calls to `silentRefresh`. This makes both paths consistently not delete credentials on network failures, and ensures only a server-side rejection (401) triggers a full sign-out.

---

### TASK-6: Expand `AuthUser` interface with missing fields (BUG-EXPO-03)
**Priority:** High  
**Files:** `apps/expo/lib/auth/context.tsx`, all API routes returning user objects  
**Effort:** Medium

Add to `AuthUser`:
```ts
export interface AuthUser {
  id: string;
  username: string;
  avatarEmoji: string;
  city: string;
  xp: number;
  rankTier: RankName;
  plan: 'free' | 'plus' | 'pro' | 'max';
  isAdmin: boolean;
  isModerator: boolean;
  isCreator: boolean;
  onboardingCompleted: boolean;
}
```
Update the 2FA verify route, Google callback, Telegram callback, and mobile-token routes to include all these fields in the response user object. Update `signIn` to accept and persist the full shape to `SecureStore`.

---

### TASK-7: Fix `invalidateAllSessions` redis.del spread (BUG-SESSION-01)
**Priority:** High  
**Files:** `apps/web/lib/auth/session.ts`  
**Effort:** Small

Replace:
```ts
await redis.del(...sids.map(sessionKey));
```
with:
```ts
const pipeline = redis.pipeline();
for (const sid of sids) {
  evictSessionCache(sid);
  pipeline.del(sessionKey(sid));
}
pipeline.zremrangebyrank(userSessionsKey(uid), 0, -1);
await pipeline.exec();
```

---

### TASK-8: Fix global IP rate limiter to use sliding window (BUG-RATE-01)
**Priority:** High  
**Files:** `apps/web/lib/security/rateLimit.ts`  
**Effort:** Medium

Replace the `INCR + EXPIRE if == 1` Lua script for the global rate limiter with the sliding-window sorted-set approach already used in the per-endpoint limiter. Create a `GLOBAL_RATE_LIMIT` config constant and apply it in `enforceRateLimit` for global IP checks. Ensure both the global and per-endpoint rate limiters call the same Redis Lua script, parameterised by key.

---

### TASK-9: Fix `getClientIp` untrusted proxy header (BUG-IP-01)
**Priority:** High  
**Files:** `apps/web/lib/security/rateLimit.ts`  
**Effort:** Small

Add a `TRUSTED_PROXY` check. On Vercel, use `x-vercel-forwarded-for` (tamper-proof) as the primary IP source:
```ts
function getClientIp(req: NextRequest): string {
  // Vercel-injected header is tamper-proof on Vercel deployments
  const vercelIp = req.headers.get('x-vercel-forwarded-for');
  if (vercelIp) return vercelIp.split(',')[0].trim();
  // x-real-ip trusted only in non-production or when explicitly opted in
  if (process.env.NODE_ENV !== 'production') {
    return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  }
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}
```

---

## Phase 3 — Medium: Reliability & Data Correctness

### TASK-10: Wrap `checkPlayMilestones` in try/catch (BUG-GAMES-01)
**Priority:** Medium  
**Files:** `apps/web/lib/games/sessions.ts` line 207  
**Effort:** Tiny

```ts
// Before:
await checkPlayMilestones(userId);

// After:
await checkPlayMilestones(userId).catch((err) =>
  logger.error({ err, userId }, '[games] checkPlayMilestones failed — play already counted')
);
```

---

### TASK-11: Add maximum play-session age check (BUG-GAMES-02)
**Priority:** Medium  
**Files:** `apps/web/lib/games/sessions.ts`, `apps/web/lib/games/config.ts`  
**Effort:** Small

Add `maxPlaySessionAgeSeconds: number` to the games config (default `3600` — 1 hour). In `finalizeScore`, after the minimum-time check, add:
```ts
const cfg = await getGamesConfig();
if (elapsedSec > cfg.maxPlaySessionAgeSeconds) {
  throw badRequest("Play session has expired. Please start a new game.");
}
```

---

### TASK-12: Check challenge expiry in `prepareChallengeRoundPlay` (BUG-GAMES-03)
**Priority:** Medium  
**Files:** `apps/web/lib/games/challenges.ts`  
**Effort:** Small

After fetching the challenge row in `prepareChallengeRoundPlay`, add:
```ts
if (c.status !== "active") throw conflict("This challenge is not active.");
if (new Date(c.expires_at) < new Date()) throw conflict("This challenge has expired.");
```
Also add `AND expires_at > NOW()` to `lockChallenge` in the expiry sweep transaction to avoid racing with the cron job.

---

### TASK-13: Enforce active season in `claimPassMilestone` (BUG-SEASON-01)
**Priority:** Medium  
**Files:** `apps/web/lib/seasons/seasonEngine.ts`  
**Effort:** Small

At the start of `claimPassMilestone`, after resolving the pass/milestone, query the associated season:
```ts
const { rows: seasonRows } = await tx.query<{ status: string; ended_at: string }>(
  `SELECT status, ended_at FROM seasons WHERE id = $1`,
  [season.id]
);
if (!seasonRows[0] || seasonRows[0].status !== 'active' || new Date(seasonRows[0].ended_at) < new Date()) {
  throw forbidden("This season has ended. Milestone claims are no longer accepted.");
}
```

---

### TASK-14: Fix SSE stream missing `deleted_at IS NULL` (BUG-SSE-01)
**Priority:** Medium  
**Files:** `apps/web/app/api/rooms/[roomId]/stream/route.ts`  
**Effort:** Tiny

```ts
// Before:
`SELECT type, creator_id, is_active FROM rooms WHERE id = $1`

// After:
`SELECT type, creator_id, is_active FROM rooms WHERE id = $1 AND deleted_at IS NULL`
```

---

### TASK-15: Validate `lastMessageId` as UUID before SSE query (BUG-SSE-02)
**Priority:** Medium  
**Files:** `apps/web/app/api/rooms/[roomId]/stream/route.ts`  
**Effort:** Tiny

Add before the `fetchNewMessages` call:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (lastMessageId && !UUID_RE.test(lastMessageId)) {
  return new Response("Invalid lastMessageId: must be a UUID", { status: 400 });
}
```

---

### TASK-16: Add muted-user check to SSE stream (BUG-SSE-03)
**Priority:** Medium  
**Files:** `apps/web/app/api/rooms/[roomId]/stream/route.ts`  
**Effort:** Small

Extend the membership query to include muted status:
```ts
const { rows: memberRows } = await db.query<{ role: string; muted_until: string | null }>(
  `SELECT role, muted_until FROM room_members WHERE room_id = $1 AND user_id = $2`,
  [roomId, userId]
);
```
Add a product decision here: if full-room bans should block reading, add `if (member.muted_until && new Date(member.muted_until) > new Date()) return new Response("You are muted in this room", { status: 403 });`. If muting only blocks writing, document this explicitly.

---

### TASK-17: Fix `sanitizeAnnouncementContent` unknown content type (BUG-SANITIZE-01)
**Priority:** Medium  
**Files:** `apps/web/lib/security/htmlSanitizer.ts`  
**Effort:** Tiny

```ts
// Before:
return content; // unsafe fallback

// After:
// Strip all HTML tags for unknown content types — treat as plain text
console.warn(`[sanitize] Unknown contentType: ${contentType} — treating as plain text`);
return sanitizeHtmlLib(content, { allowedTags: [], allowedAttributes: {} });
```

---

## Phase 4 — Low: Code Quality & Schema Cleanup

### TASK-18: Add self-referral guard in `awardReferralCommissions` (BUG-REFERRAL-01)
**Priority:** Low  
**Files:** `apps/web/lib/referrals/commissions.ts`  
**Effort:** Tiny

After resolving `tier1Id`, add:
```ts
if (!tier1Id || tier1Id === buyerId) return result; // prevent self-referral commissions
```
Also add DB CHECK constraint: `ALTER TABLE users ADD CONSTRAINT chk_no_self_referral CHECK (referred_by IS NULL OR referred_by != id);`

---

### TASK-19: Fix 2FA verify route stale documentation (BUG-2FA-01)
**Priority:** Low  
**Files:** `apps/web/app/api/auth/2fa/verify/route.ts`  
**Effort:** Tiny

Update the route-level JSDoc to remove the reference to the legacy `sessionToken` flow (option `b)`). The comment should only describe the current pre-auth token flow.

---

### TASK-20: Update challenge cancellation notification to include forfeiture amount (BUG-CHALLENGE-01)
**Priority:** Low  
**Files:** `apps/web/lib/games/challenges.ts`  
**Effort:** Small

In `cancelEscrow`, after computing `challForfeitCoins`, pass the amount via metadata to the notification:
```ts
await notify(c.challenger_id, "game_challenge_cancelled", {
  challengeId: c.id,
  coinsForfeited: challForfeitCoins,
  coinsRefunded: challRefund,
});
await notify(c.opponent_id, "game_challenge_cancelled", {
  challengeId: c.id,
  coinsBonus: challForfeitCoins,
  coinsRefunded: oppRefund,
});
```
Update `CHALLENGE_NOTIFICATION_COPY["game_challenge_cancelled"]` to reference the metadata values.

---

### TASK-21: Remove or document dead `sessions` DB table (BUG-SCHEMA-01)
**Priority:** Low  
**Files:** `apps/web/lib/db/schema.ts`, migration files  
**Effort:** Medium

Decide: if the table serves no purpose, create a migration to `DROP TABLE sessions` and remove its Drizzle definition. If it is intended for audit logs, write the session creation and invalidation paths to it (in addition to Redis) and document it as the permanent audit trail.

---

### TASK-22: Consolidate the two quest tracking tables (BUG-SCHEMA-02)
**Priority:** Low  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/quests/questEngine.ts`  
**Effort:** Large

Audit all reads and writes to both `user_quests` and `user_quest_progress`. Determine which table is canonical (likely `user_quest_progress` if it was introduced as a replacement). Write a data migration to move any active quest state from the old table to the new one. Remove the old table definition and all references. Add integration tests to verify quest assignment, progress, and completion all use the surviving table.

---

## Fix Order Summary

| Phase | Tasks | Risk | Estimated Effort |
|-------|-------|------|-----------------|
| 1 — Critical | TASK-1, 2, 3, 4 | High (money/data) | 1–2 days |
| 2 — High | TASK-5, 6, 7, 8, 9 | Medium (auth/security) | 2–3 days |
| 3 — Medium | TASK-10 through 17 | Low (reliability) | 2–3 days |
| 4 — Low | TASK-18 through 22 | Minimal (cleanup) | 1–2 days |
| **Total** | **22 tasks** | | **~6–10 days** |

---

*Fix plan generated: 2026-06-21 02:10 AM*
