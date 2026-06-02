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
