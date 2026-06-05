# How Zobia Social Works

## User-Facing Features

### Onboarding

New users choose a username, select their city and country, pick an avatar emoji, and optionally enter a referral code. The onboarding flow calls `/api/onboarding/complete`, which atomically awards welcome XP and coins, generates a unique referral code, and records a tier-1 referral if a code was provided. Auth is immediately established via HTTP-only JWT cookie (web) or Expo SecureStore (Android).

### Direct Messages (DMs)

1-to-1 private messaging between any two users. Messages are stored in the `messages` table with `recipient_id` set. Conversations are fetched from `/api/inbox`. The realtime layer (Supabase Realtime / Ably / Pusher depending on `REALTIME_PROVIDER`) pushes new messages to open clients without polling. Each message sent earns XP on the `social` track.

### Rooms

Zobia has six room types, each with different XP earn mechanics:

| Room Type | Description |
|---|---|
| **Vibe Check** | Open discussion rooms — join, read, or post |
| **Debate Arena** | Structured debate with sides; posts earn extra XP for engagement |
| **Study Hall** | Knowledge-focused rooms; earns XP on the `knowledge` track |
| **Battle Room** | Competitive challenges where members vote for a winner |
| **Chill Zone** | Casual hangout; low-friction, low XP |
| **Flex Room** | Creator-gated rooms; room owner earns creator earnings |

Rooms can be city-scoped or global. Guild captains can create guild-exclusive rooms that earn `competitor` track XP.

### Guilds

Guilds are persistent groups of up to N members. Creating a guild costs 500 Coins (deducted atomically). Members earn `competitor` track XP from guild activities. Guilds have a treasury (coin pool) funded by member donations and war rewards. Guild tiers (bronze → silver → gold → platinum → diamond) unlock higher treasury caps and XP multipliers. See **Guild War Engine** below.

### XP System

XP is earned on seven tracks: `main` (overall), `social`, `creator`, `competitor`, `generosity`, `knowledge`, and `explorer`. Each action type maps to a specific track (e.g. sending a message → social; publishing content → creator; winning a guild war → competitor). The XP Engine applies a multiplier stack — plan bonus → guild bonus → season pass bonus → active booster — using integer basis-point arithmetic. All XP flows through `/api/xp`, which writes to `xp_ledger` and updates `users.xp_total` and the relevant track field.

### Dual Currencies

**Coins** — Earned from quests, daily logins, season rewards, gifts received, rewarded ads (free users only, capped at 5/day). Spent on guilds, gifts, store items, and room creation. Stored in `users.coin_balance`; all mutations go through `coin_ledger` (append-only audit trail).

**Stars** — Premium currency purchased via Paystack or DodoPayments. Used for exclusive cosmetics and season pass upgrades. Stored in `users.star_balance`; all mutations go through `star_ledger`.

### Gifting

Users can send gift items (flower, trophy, crown, etc.) to any other user. Gift items have coin prices and tiers. Sending a gift earns `generosity` track XP. The receiver sees an in-app notification. Creators earn coin revenue when they receive gifts in their rooms.

### Seasons

Seasons run in 8-week cycles. Each season has four phases:

- **Opening (weeks 1–2)**: High XP for first-time actions, quest bonus multiplier active
- **Mid-Season (weeks 3–5)**: Standard rates, guild war frequency peaks
- **Push (weeks 6–7)**: Leaderboard freeze warnings, sprint quests unlock
- **Final Day (week 8)**: 2× XP all day, global leaderboard visible to all users

Season Pass: the free tier earns basic coin rewards for completing quests. The paid tier unlocks exclusive cosmetics, animated borders, and bonus XP multipliers. At season end, competitive rankings reset. Track levels, coin balance, friend list, and history are all preserved.

### Prestige

When a user reaches the maximum rank (Zobia Icon), they can Prestige: their rank resets to Beginner while their prestige count increments. Prestiged users receive an exclusive cosmetic frame visible to all, a permanent coin multiplier, and higher max daily quest rewards.

### Creator Economy

Creators (marked `is_creator = true`) earn revenue from:
- Room entry fees (paid rooms)
- Gifts received in their rooms (80% to creator, 20% to platform)
- Paid content subscriptions

Revenue accrues to `creator_earnings`. The weekly CRON checks creators above the minimum payout threshold (default: ₦5,000 via Paystack). Creators above the manual-approval threshold (default: ₦100,000) require admin approval before disbursement. Completed payouts record to `creator_payouts`.

### Social Graph

- **Friends**: Bilateral friendship requests. Stored in `friendships`. Friend list visible on profile.
- **Follows**: Unilateral following. Stored in `follows`. Used for feed curation and notification preferences.
- **Mutual follows** appear in suggestions.

### Nemesis System

Every week, each user can be assigned a Nemesis: another user within 10% of their XP on their highest active track. The algorithm prefers users in the same city, excludes mutual friends. The Nemesis is displayed on the home screen with an XP delta. Notifications fire when the Nemesis overtakes the user or falls behind. A **Challenge** button starts a 7-day XP sprint between the two users.

### Elder System

The Elder is the highest-XP user in a given city. The Elder badge appears on their profile and in the city leaderboard. The Elder title changes whenever the city leaderboard rank-1 changes.

### Platform Council

A small group of top users (selected by trust score + XP) who can vote on policy questions raised by the admin team. Council membership is updated weekly.

### Referral System

Each user gets a unique referral code after onboarding. Sharing `?r=<code>` when a new user signs up creates:
- **Tier 1 referral**: The referrer earns coins + XP when the new user qualifies (completes first action).
- **Tier 2 referral**: If the referrer was themselves referred, the original referrer also earns a smaller bonus.

Referral stats are visible at `/api/referrals`.

### Notifications

In-app notifications stored in the `notifications` table. Notification types include: guild war updates, nemesis rank changes, leaderboard rank changes, quest completions, friend activity, DM received, gift received, streak milestones, and season events. Telegram bot notifications are sent for high-priority events if the user has linked their Telegram account (`telegram_id` on users table).

### Deep Links

All deep-linkable routes are defined in `lib/deeplinks/routes.ts` — the single source of truth. Universal links via Android App Links use `/.well-known/assetlinks.json`. Referral links use `?r=<referralCode>`. Notification taps carry a route payload that maps to the correct screen via the deep link router.

---

## Admin Features

The admin panel is available at `/admin` and is protected by `is_admin = true` in the database (not just the JWT — every admin route calls `withAdminAuth` which re-checks the database).

### Dashboard Overview (`/api/admin/overview`)
Daily/weekly/monthly active users, new registrations, revenue totals (today / week / month), active rooms, active guilds, and moderation queue depth.

### Financial Monitoring (`/api/admin/financial`)
Transaction volume, creator payout pipeline status, pending payouts awaiting approval, payment provider health, coin/star ledger summaries.

### User Management (`/api/admin/users`)
Search, view, suspend, ban, or restore any user. View user's XP history, coin ledger, quest history, guild membership, and reports filed against them.

All moderation actions are performed via `POST /api/admin/users/:userId/actions` and are logged atomically to the `admin_actions` audit table. Supported actions:

| Action | Description |
|---|---|
| `suspend` | Temporarily suspend account for `duration_hours` hours. Invalidates all sessions immediately. |
| `ban` | Permanently ban account. Invalidates all sessions immediately. |
| `restore` | Lift a suspension or ban. |
| `upgrade_moderator` | Grant moderator role to account. |
| `downgrade_moderator` | Revoke moderator role. |
| `reset_password` | Null out password hash, generate a 1-hour reset token, send reset link to user's email. Invalidates all sessions. |
| `force_2fa` | Clear existing TOTP secret, set `require_2fa_setup = true` so the user must configure 2FA on next login. Invalidates all sessions. |
| `verify_account` | Manually mark the account's email as verified. |

Admins cannot action their own account or any other admin account. All actions are append-only in the audit log (no delete or update endpoints exist).

### Content Moderation (`/api/admin/moderation`)
View AI-classified reports queue. Accept or reject AI decisions. Bulk-action common violation types. View moderation history per user.

### Automated Actions Log
All automated moderation actions (auto-hide, auto-suspend triggered by trust score drop) logged with AI confidence score and DeepSeek/Gemini classification category.

### Feature Flags (`/api/admin/config`)
All `x_manifest` keys are editable from the admin panel. Changes take effect within seconds via Redis cache invalidation. Feature flags include: rooms enabled, DMs enabled, live streaming, AI assistant, marketplace, gifts, rankings.

### Configuration (x_manifest)
Admin-editable app-level settings: payment provider selection, max file upload size, rate limit thresholds, payout minimum thresholds, moderation settings.

### Admin Messaging (`/api/admin/messages`)
Send broadcast messages to all users or to a filtered segment (by city, plan, or trust score range).

### Announcement Modals and Banners
`announcement_modals` — full-screen overlays shown once per user. `announcement_banners` — dismissable top-of-screen banners. Both support scheduling (active_from / active_until).

### Footer Scripts
Inject custom `<script>` tags via `footer_scripts` table — for analytics, pixel tracking, or A/B tools. Managed from the admin panel, served by the layout on each page load.

### Alerts (`/api/admin/alerts`)
System alerts for: low payout balance, AI provider failure, CRON failure, moderation queue spike. Each alert can be resolved by an admin with an optional note.

### Android Admin Mirror
A read-only admin dashboard view available in the Expo app for admins, showing the same metrics as the web panel without write access.

---

## Technical Architecture

### XP Engine

Location: `lib/xp/engine.ts`

All XP values and multipliers are defined here — never inline at call sites.

Calculation flow:
1. `calculateXPForAction(action)` returns the **base XP** for the action type.
2. `applyMultipliers(baseXP, ctx)` applies the multiplier stack:
   - Plan multiplier (free=100bp, plus=110bp, pro=125bp, max=150bp)
   - Guild tier bonus (read from `getGuildXPBoostPercent(guildTier)`)
   - Season pass bonus (read from active season config)
   - Active booster (per-user temporary multiplier stored in Redis)
3. All multipliers are whole-number basis points (100bp = 1.0×). Integer division is used throughout — no floating-point values enter or exit the engine.
4. Minimum award when base > 0 is 1 XP.
5. The result is written to `xp_ledger` and added to `users.xp_total` and the relevant track column.

### Coin Ledger

`coin_ledger` is **append-only** — rows are never updated or deleted. This preserves a complete audit trail of every coin credit and debit.

Race condition prevention: every debit uses `SELECT ... FOR UPDATE` on the `users` row to lock it before reading `coin_balance`. This prevents two concurrent requests from reading the same balance and both believing there are sufficient funds.

Floating-point precision: all coin values are stored as `BIGINT` (smallest unit, like kobo/cents). The application layer uses `Decimal.js` for any arithmetic before writing to the database. This prevents the floating-point drift that would occur with JavaScript `number` arithmetic on large values.

Atomicity: every debit operation pairs the `UPDATE users SET coin_balance = ...` with an `INSERT INTO coin_ledger ...` inside a single database transaction. If either fails, both roll back.

### Payout Pipeline

1. Creator accumulates revenue in `creator_earnings` (per-room, per-gift entries).
2. The weekly CRON (part of `/api/cron/daily` on Sundays, or a separate scheduled job) aggregates `creator_earnings` by creator and checks the payout threshold from `x_manifest`.
3. **Below threshold**: No action. Earnings continue accumulating.
4. **Above threshold, below manual-approval threshold**: Automatic payout initiated via Paystack or DodoPayments (selected by `x_manifest.payment.primaryProvider`). Record created in `creator_payouts` with status `processing`.
5. **Above manual-approval threshold**: Record created with status `awaiting_approval`. Admin sees it in the payouts panel and approves manually.
6. **On approval**: Paystack/DodoPayments transfer API called. On webhook confirmation → status set to `completed`.
7. **On failure**: Status set to `failed`, admin alerted. Manual retry available.
8. The 80/20 split (80% to creator, 20% platform) is applied at the `creator_earnings` record level, not at payout time.

### AI Moderation Pipeline

1. A user report is submitted → record created in `reports` with status `pending`.
2. DeepSeek classifier is called with the reported content (sandboxed from system instructions — user content is passed as a separate `user` role message, never interpolated into the system prompt).
3. DeepSeek returns: category (spam / hate / nsfw / misinformation / harassment / ok) + confidence score.
4. If DeepSeek fails 3 consecutive times (HTTP error or timeout) → circuit breaker trips → Gemini fallback is called.
5. If both fail → report remains `pending`, admin alerted via `system_alerts`.
6. AI result stored on the report record. Human moderators review high-confidence cases flagged for action.
7. Low-confidence cases (below the `x_manifest` threshold) are always routed to human review.

### CRON Architecture

**Vercel Hobby (1 daily CRON)**
- Configured in `apps/web/vercel.json`: `/api/cron/daily` at `0 0 * * *` (midnight UTC).
- Handles: daily quest reset, login streak updates, re-engagement checks (3/7/14/30/90-day inactivity), nemesis refresh (Sundays), season transitions.

**cron-jobs.org (sub-daily jobs)**
- `/api/cron/guild-wars` — every 1 hour: Final Hour transitions, war resolution.
- `/api/cron/leaderboards` — every 15 minutes: snapshot upserts, rank-change notifications.

All CRON handlers:
1. Require `Authorization: Bearer <CRON_SECRET>` — return 401 otherwise.
2. Are idempotent — safe to re-run if a previous run was interrupted.
3. Log failures to Redis (`cron_failure:<handler>:<date>`) for the admin alert system.
4. Return structured JSON with counts of actions taken and any errors encountered.

**Message History Enforcement (Step 23 of daily CRON)**

Plan-based message retention limits are enforced nightly:
- **Free plan**: Messages older than 90 days are permanently deleted.
- **Plus plan**: Messages older than 180 days are permanently deleted.
- **Pro / Max plan**: No deletion — unlimited history.

Deletion is batched by joining `messages` against the sender's subscription plan. Results (`freeDeleted`, `plusDeleted`) are included in the CRON response JSON for monitoring.

### Offline Sync

**Web (Service Worker + IndexedDB)**
- A Service Worker caches the app shell (HTML, CSS, JS) for instant load.
- `offline.html` is served as the navigation fallback when the network is unavailable.
- Recent messages, the user's profile, and the active quest deck are stored in IndexedDB.
- Outgoing messages composed while offline are saved to IndexedDB with status `pending_sync`.
- On reconnect (`online` event), the client flushes the IndexedDB queue to the server API.
- Stale-while-revalidate strategy: cached data is shown immediately while a fresh fetch runs in the background.

**Android (MMKV + Expo SQLite)**
- MMKV provides ultra-fast synchronous key-value storage for session tokens, user preferences, and feature flags.
- Expo SQLite stores structured offline data: recent message threads, the quest deck, and cached profile data.
- Same sync-on-reconnect pattern: NetInfo `addEventListener` fires the sync when connectivity is restored.
- Offline messages have a 72-hour TTL in SQLite. Messages older than 72 hours that never synced are dropped with a "message not sent" notice displayed to the user.

### JWT + Redis Session System

1. **Login** → backend issues two tokens:
   - **Access token** (JWT, 15-minute TTL) signed with `JWT_SECRET`. Stored in HttpOnly cookie (web) or Expo SecureStore (Android).
   - **Refresh token** (JWT, 30-day TTL) signed with `JWT_REFRESH_SECRET`. Stored in Redis under key `session:<refreshToken>` with a 30-day expiry, and in the `sessions` table for auditability.
2. **API call with valid access token** → validates JWT → proceeds.
3. **API call with expired access token + valid refresh token** → backend validates refresh token against Redis key → issues new access token → returns both to client.
4. **Logout** → deletes the Redis `session:*` key → immediate invalidation. The old access token will still parse as valid until its 15-minute TTL expires, but the refresh token can no longer be used to extend sessions.
5. **Ban or suspension** → admin action deletes all `session:*` keys for the user → all devices logged out immediately, without waiting for JWT expiry.
6. **Admin sessions** → separate shorter-lived JWT (5-minute TTL), re-verified against `is_admin` in the database on every admin route call.

### Database Provider Abstraction

`DATABASE_PROVIDER` env var → `lib/db/index.ts` reads it and returns the correct `DatabaseAdapter` singleton. All queries in business logic call `db.query()` or `db.transaction()` — never a provider-specific SDK.

An ESLint rule flags any direct import of `@supabase/supabase-js` or provider-specific modules from business logic files. Only the adapter file in `lib/db/providers/` may import provider SDKs.

Switching providers requires only changing `DATABASE_PROVIDER` and redeploying. Data migration (pg_dump/restore) is a separate, manual step.

### Auth System

**No Supabase Auth anywhere.** All auth is platform-managed.

- **Google OAuth**: Frontend redirects to Google → Google calls `/api/auth/google/callback?code=...` → backend exchanges code for Google tokens → backend verifies Google ID token → creates or retrieves Zobia user by `google_id` → issues Zobia JWT pair.
- **Telegram Login**: Telegram Login Widget posts data to `/api/auth/telegram` → backend performs HMAC-SHA256 verification using the bot token as key → creates or retrieves user by `telegram_id` → issues JWT pair.
- **JWT validation**: `lib/auth/jwt.ts` using the `jose` library. No third-party auth SDK.

### Deep Link Structure

All deep-linkable routes are defined in `lib/deeplinks/routes.ts` — the **single source of truth**. No hardcoded paths exist in notification code or anywhere else.

Universal links via Android App Links: `/.well-known/assetlinks.json` lists the app's SHA-256 certificate fingerprint. Android verifies this at install time so `https://zobia.social/profile/username` opens the app rather than the browser.

Referral format: `?r=<referralCode>` — alphanumeric code stored on the user's row.

Notification tap targets: each notification `payload` contains a `deepLink` field (e.g. `/guilds/<id>/war/<warId>`) resolved by the deep link router on the client.

### Guild War Engine

Location: `lib/guilds/warEngine.ts`

1. **Declaration**: A guild captain declares war → `findWarOpponent()` searches for guilds within ±15% XP of the declaring guild, same tier preferred, no active war against each other, cooldown of 72 hours respected.
2. **Active phase (48 hours)**: All member activity earns War Points. `calculateWarPoints(activity, isFinalHour)` returns points; during the Final Hour the multiplier is `FINAL_HOUR_MULTIPLIER = 2`.
3. **Final Hour**: When `ends_at - 1 hour ≤ now`, the hourly CRON transitions the war to `final_hour` status and notifies all members.
4. **Resolution**: When `ends_at < now`, the hourly CRON calls `resolveWar(db, warId)`. The engine:
   - Determines the winner (higher total war points).
   - Calls `distributeWarRewards()` to distribute XP + coins to winning guild members by contribution rank.
   - Awards a Rematch Token to the losing guild captain.
   - Updates `guilds.wars_won` / `wars_lost`.
5. All war calculations use integer arithmetic. No floating-point values.

### Season System

Seasons are 8-week cycles defined in the `seasons` table. The Season Engine (`lib/seasons/seasonEngine.ts`) manages:
- Phase detection based on current week within the season.
- Season Pass reward tier checks (free vs paid).
- End-of-season reward distribution (coins, cosmetics, prestige points for top-ranked users).
- Season transition (closing the old season, opening the new one).

At season end: competitive rankings reset. Track XP, coins, friends, and history are **not** reset.

### Nemesis System

Location: `lib/nemesis/nemesisEngine.ts`

Weekly assignment algorithm:
1. For each user, find their highest active XP track.
2. Query users within 10% XP of the requesting user on that track.
3. Filter: prefer same city, exclude mutual friends, exclude current Nemesis.
4. Assign the closest match. Store in `nemesis_assignments`.

The home screen shows the XP delta between the user and their Nemesis. Notifications are sent when:
- The Nemesis overtakes the user's XP.
- The user overtakes the Nemesis's XP.

A 7-day XP sprint challenge can be initiated via the **Challenge** button, which creates a temporary head-to-head leaderboard between the two users.

---

## Edge Cases

**User suspended mid-war**
War points stop accumulating for the suspended user's guild. The guild still competes with remaining active members. When the suspension ends, the user resumes accumulating war points (if the war is still active).

**Payout account low**
If the platform's payment provider balance falls below the `payout_low_balance_alert_kobo` threshold in `x_manifest`, the admin alert system fires a `payout_low_balance` system alert. Payouts are queued but not processed. Admin tops up the account → the queue processes on the next CRON run or manual trigger.

**AI provider failure**
The circuit breaker counts consecutive failures per provider. After 3 failures, the router switches to the fallback provider. If both DeepSeek and Gemini are failing, the report is held in `pending` status and a `ai_provider_failure` system alert fires. Human moderators can process the backlog manually. The circuit breaker resets after a configurable cool-down period.

**CRON failure**
CRON failures are caught, logged to Redis (`cron_failure:<handler>:<date>`), and trigger a `cron_failure` system alert. The daily quest deck rollover is designed to be safe to apply late: if the CRON runs at 1:00 AM instead of midnight, it detects which users need their deck reset and applies it. Partial runs (e.g. CRON hit a timeout at user #5000 of 10000) are handled by idempotent checks — already-reset users are skipped on re-run.

**Database provider switch**
1. Change `DATABASE_PROVIDER` env var to the new provider.
2. Redeploy.
3. The ESLint rule enforces that no Supabase-specific SDK calls leak into business logic — the abstraction holds.
4. Data migration is a **separate manual step**: `pg_dump` from old provider, `psql` restore to new provider. The app itself has no migration automation for provider switches.

**Offline messages fail to sync**
Messages saved to IndexedDB (web) or SQLite (Android) while offline are retried on each app open and on `online` events. If a message is older than 72 hours and has not been acknowledged by the server, it is dropped from local storage and a "message not sent" notice is displayed in the conversation thread. The user can manually retry by re-typing the message.

**Referral code collision**
The onboarding flow generates a referral code and immediately checks for uniqueness (`SELECT EXISTS ... WHERE referral_code = $1`). On collision, it appends a suffix character and retries. Collisions are expected to be extremely rare given the code space.

**Leaderboard tie**
`upsertLeaderboardSnapshot` uses a `COUNT(*)` of users with higher XP to calculate `rank_position`. Tied users receive the same rank position. The next rank is offset by the number of tied users (standard competition ranking: 1, 1, 3, 4...).

**Duplicate daily login claim**
The Redis key `daily_login:<userId>:<YYYY-MM-DD>` prevents double-awards within the same calendar day. The `/api/login/daily` endpoint is idempotent — if the key exists, it returns the current streak without re-awarding XP and includes `alreadyClaimedToday: true` in the response.

---

## Testing

### E2E Tests (Playwright)

Located in `e2e/`. Covers all 11 PRD-required user journeys:
- Authentication (register, login, logout, Google OAuth)
- Direct messages (coin cost, anti-spam, gift-them-coins flow)
- Economy (coin purchase, transfer, gift items)
- Rooms (create, join, VIP gate, gift in room)
- Guilds (create, join, declare war, resolve war)
- Leaderboards (global, city, track-specific)
- Referrals (code sharing, tier-1 + tier-2 attribution)
- Creator payouts (request, auto-approve, manual-approve threshold)
- Suspension (admin suspend, session invalidation, restore)
- Season reset (end-of-season competitive reset, track preservation)
- Admin (user management, moderation, financial dashboard)

Run: `cd apps/web && npx playwright test`

### Unit Tests (Jest)

Located in `apps/web/lib/**/__tests__/`. Covers:
- XP engine: all action types, multiplier stack, track attribution
- Coin ledger: credit/debit invariant, `SELECT FOR UPDATE` race guard, append-only
- Financial integrity: transfer fee math (5% floor), insufficient-balance rejection
- Concurrency: sequential credit/debit chain integrity, balance roundtrip
- Creator payouts: 80/20 split, minimum threshold, manual-approval threshold, tier distribution
- Guild wars: war points calculation, Final Hour multiplier, reward distribution
- Season engine: phase detection, pass milestones, end-of-season reset

Run: `cd apps/web && npx jest`

### Load Tests (k6)

Located in `load-tests/`. All scenarios target a staging environment.

| File | Scenario | VUs | Duration |
|---|---|---|---|
| `room-feed.js` | Room discovery feed under load | 1000 | 5 min |
| `guild-war-final-hour.js` | Final Hour simultaneous war point submissions | 500 | 10 min |
| `cron-daily-reset.js` | Daily CRON handler under concurrent requests | 500 | 3 min |
| `daily-login.js` | Daily login endpoint burst | 500 | 5 min |

Run: `k6 run load-tests/room-feed.js --env BASE_URL=https://staging.zobia.app`

### Security / Penetration Tests

Located in `security-tests/`. Covers OWASP Top 10 and platform-specific threats:

| File | Coverage |
|---|---|
| `auth.security.test.ts` | JWT tampering, algorithm confusion (alg:none), brute-force rate limiting |
| `injection.security.test.ts` | SQL injection, XSS in profile fields, SSRF via URL params, NoSQL operators |
| `idor.security.test.ts` | Profile/message/payout IDOR, admin route access by regular users |
| `economy.security.test.ts` | Negative/zero/float/overflow amounts, double-spend race condition |
| `admin.security.test.ts` | Privilege escalation, self-action protection, audit log immutability |
| `ratelimit.security.test.ts` | Login/transfer/report burst 429 enforcement, Retry-After header |

Prerequisites: running dev server + env vars `SECURITY_TEST_BASE_URL`, `SECURITY_TEST_USER_TOKEN`, `SECURITY_TEST_ADMIN_TOKEN`, `SECURITY_TEST_USER_ID`, `SECURITY_TEST_OTHER_USER_ID`.

Run: `cd apps/web && npx jest --testPathPattern="security" --runInBand`

---

## Push Notification System

### Server-Side Delivery

The server sends push notifications via `apps/web/lib/notifications/push.ts` using the Expo Push API (`https://exp.host/--/api/v2/push/send`).

Notifications are sent:
- **Guild War Final Hour** — to all guild members when 60 minutes remain.
- **Mystery XP Drop** — fired when the CRON dispatches a random drop.
- **Leaderboard ripple** — when a user's rank changes while they are offline.
- **Nemesis overtake** — when the Nemesis pulls ahead or the user overtakes them.
- **Friend gift** — when a friend sends a gift.
- **Season reset (24h)** — reminder before competitive season closes.
- **Re-engagement sequences** — at 3, 7, 14, 30, and 90 days of inactivity.

Notification priority levels:
- `high` — sound + banner (Guild War Final Hour, Mystery XP Drop, gifts).
- `normal` — sound + banner (general social notifications).
- `low` — silent badge-only (weekly contribution scores, non-urgent nudges).
- `silent` — no sound or visual interruption (background data updates).

### Client-Side Setup (Expo)

On first authenticated load, the Expo app:
1. Checks if running on a physical device (`expo-device`).
2. Requests permission via `expo-notifications.requestPermissionsAsync()`.
3. Calls `expo-notifications.getExpoPushTokenAsync()` to retrieve the unique device token.
4. Registers the token with `POST /api/users/push-token` (stored in `user_push_tokens` table).

Notification tap handling routes users to the deep-link `action` field attached to each notification payload (e.g. `/guild/wars/[warId]`, `/leaderboards`, `/profile/[userId]`).

---

## Community Notes

Community Notes is an admin-toggleable crowdsourced fact-checking feature (PRD §19, Layer 2 moderation).

### How It Works

1. Any user can submit a note on flagged content (messages, rooms, profiles, guilds).
2. The community votes notes as "Helpful" or "Not Helpful."
3. Notes with a sufficient ratio of helpful votes gain `visible` status and appear alongside the original content.
4. Admin moderators can review and remove notes via the admin panel.

### Feature Flag

Controlled by `community_notes_enabled` in the x_manifest / admin feature flags panel. Default: enabled.

When disabled, the web page at `/community-notes` shows a "Feature Unavailable" notice. The API returns 403.

### API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/community-notes` | List notes, filterable by status |
| POST | `/api/community-notes` | Submit a new note |
| POST | `/api/community-notes/[noteId]/vote` | Vote helpful or unhelpful |

---

## Gift Spectacle Threshold

Each room creator can set a minimum gift value (coins) required to trigger the full room-wide spectacle animation (PRD §12).

- The spectacle animation dims the message feed for 3 seconds and plays the gift emoji prominently.
- High-value gifts (Tier 2+) always trigger spectacle when no threshold is set.
- Creators set the threshold via the "🎁 Spectacle Threshold" panel in the room sidebar.
- Stored in `rooms.spectacle_threshold_coins`. `NULL` = use gift item's default.
- API: `PUT /api/rooms/[roomId]/spectacle-threshold` with `{ thresholdCoins: number | null }`.

---

## Gift Messages in DMs

When a user sends a gift to another user via `POST /api/economy/gifts/send` (without a `roomId`), the gift:

1. Debits coins from the sender atomically (80/20 or 95/5 split depending on whether recipient is a creator).
2. Credits the recipient's coin balance.
3. **Creates a DM message** with `message_type = 'gift'` so it appears in the conversation feed.
4. Upserts the `dm_conversations` record to ensure the conversation is trackable.

The gift message displays as a special bubble (`🎁 Gift Name (X coins)`) in both sender's and recipient's DM view.

---

## "Gift Them Coins" Flow

When a user does not have enough coins to reply to a DM, the conversation screen shows:

> "Not enough coins to reply. **Gift them coins →**"

Tapping "Gift them coins" opens the **Coin Transfer** flow (not the gift item flow):
- **Web:** Routes to `/wallet?transfer=[userId]` which opens the CoinTransferPanel.
- **Expo:** Routes to `/economy/wallet` with `transfer=[userId]` param.

This allows the current user to send raw coins to the recipient so they can reply.

This allows the current user to send raw coins to the recipient so they can reply.

---

## Flash XP Event Scheduling (PRD §2.4, §8, §25)

Flash XP events follow a two-phase lifecycle managed by the hourly CRON (`GET /api/cron/guild-wars`):

### Phase 1 — Announcement (6-hour advance notice)

When an event's `announced_at` timestamp is reached and `announcement_notification_sent = FALSE`, the CRON:

1. Atomically marks the event as `announcement_notification_sent = TRUE`.
2. Inserts a `flash_xp_announced` in-app notification for all users active in the last 30 days.
3. The notification body tells users a Double XP event is happening *sometime before* the window closes — the exact fire time is never disclosed.

**Admin creates events** via `POST /api/admin/flash-xp` with:
- `announced_at` — when to send the 6-hour advance notification
- `fires_at` — the actual (secret) fire time (must be ≥ 6 hours after `announced_at`)
- `ends_at` — when the XP multiplier deactivates

The 6-hour minimum gap is enforced server-side (returns 400 if violated).

### Phase 2 — Firing (unannounced moment within the window)

When `fires_at <= NOW()` and `fired = FALSE`, the CRON:

1. Atomically marks the event as `fired = TRUE`.
2. Inserts a `flash_xp_live` high-urgency notification for all users active in the last 7 days.
3. The XP award route (`POST /api/xp/award`) checks `flash_xp_events` for any row where `fired = TRUE AND fires_at <= NOW() AND ends_at > NOW()` and applies the multiplier.

The admin controls the exact fire time — from the user perspective, it fires "at a random moment" within the announced window.

---

## Admin: Sponsored Quest Marketplace (PRD §14)

The Sponsored Quest Marketplace has two separate API surfaces:

### Brand / Admin side — `GET|POST /api/admin/sponsored-quests`

Admin creates quests on behalf of brands. Required fields:

| Field | Description |
|---|---|
| `brandName` | Sponsoring brand name |
| `brandLogoUrl` | Optional brand logo |
| `title` | Quest title shown to creators |
| `description` | Full quest brief |
| `requirements` | What creators must do to earn the reward |
| `rewardAmountCoins` | Total reward in Coins |
| `creatorSharePercent` | Creator's share (default 70%) |
| `platformSharePercent` | Platform's share (default 30%, must sum to 100 with creator share) |
| `maxApplications` | Max concurrent creator approvals |
| `deadline` | Application closing date |
| `minCreatorTier` | Minimum creator tier to apply (default: "verified") |

### Creator side — `GET /api/creator/sponsored-quests` + `POST /api/creator/sponsored-quests/[id]/apply`

Verified+ creators browse active quests and apply. Application status: `pending → approved → completed`.

On completion, the Coin reward is split per `creatorSharePercent`/`platformSharePercent`.

---

## PWA Per-Platform Toggle (PRD §3, §20, §22)

Admin controls PWA availability independently for web, Android, and iOS from the admin config panel. Changes are stored in `x_manifest` and take effect within the Redis cache TTL (60 seconds).

### Web PWA

`generateMetadata()` in `app/layout.tsx` reads `manifest.pwa.webEnabled` at request time. When `FALSE`, the `<link rel="manifest">` tag is omitted from the HTML `<head>`, which prevents browsers from offering "Add to Home Screen" for the web version.

The `next.config.js` also reads `NEXT_PUBLIC_PWA_WEB_ENABLED=false` at build time to disable service worker generation for deployments that should never serve a PWA (e.g. admin-only instances).

### Android / iOS PWA

`manifest.pwa.androidEnabled` and `manifest.pwa.iosEnabled` are checked by the Expo app's service worker registration code and the web app's install prompt component. When disabled, the "Install App" banner and prompt are suppressed.

---

## Business Account Tier Upgrades (PRD §17)

Business accounts start at the free `starter` tier. To upgrade to `growth` (₦15,000/month) or `enterprise` (₦50,000+/month):

1. Client calls `PATCH /api/business/tier` with `{ tier, paymentProvider }`.
2. Server looks up the tier price from `x_manifest` (admin-configurable; falls back to PRD defaults).
3. Server stores `pending_tier` and `pending_payment_ref` on the business account record.
4. Server calls Paystack (`initializePayment`) or DodoPayments (`createPaymentSession`) and returns `{ paymentUrl }`.
5. Client redirects user to the checkout page.
6. On `charge.success` (Paystack) or `payment.succeeded` (DodoPayments), the webhook handler:
   - Matches the `pending_payment_ref` on the business account.
   - Updates `tier` to the `newTier` from metadata.
   - Clears `pending_tier` and `pending_payment_ref`.
   - Records `tier_updated_at`.

Tier prices are admin-configurable via `x_manifest` keys `business_growth_price_kobo` and `business_enterprise_price_kobo`.

---

## Weekly Season Leaderboard Snapshot (PRD §25)

Every Sunday (UTC), the daily CRON publishes an official Season leaderboard snapshot:

1. Finds the currently active season.
2. Deletes the previous week's `season_weekly` snapshot rows for that season from `leaderboard_rank_snapshots`.
3. Re-inserts the top 200 users ranked by `season_xp` from `season_leaderboard_entries`.

This snapshot is what powers the "Season Leaderboard snapshot published (every Sunday)" shown in the Platform Vitality Calendar. The live leaderboard continues to update every 15 minutes via the hourly CRON's leaderboard step.

---

## ESLint Supabase Import Restriction (PRD §22.1)

`apps/web/.eslintrc.json` contains a `no-restricted-imports` rule that blocks direct imports from:

- `@supabase/supabase-js`
- `@supabase/auth-helpers-nextjs`
- `@supabase/auth-helpers-react`
- `@supabase/auth-helpers-shared`
- Any `@supabase/auth-helpers-*` package

**Exception:** `lib/db/providers/supabase.ts` and `lib/storage/providers/supabase-storage.ts` are exempted via the `overrides` config — these are the only two files permitted to use the Supabase SDK directly.

This enforces the PRD §22.1 requirement: when `DATABASE_PROVIDER != 'supabase'`, no Supabase SDK code is reachable through any import path.
