# How Zobia Social Works

## User-Facing Features

### Onboarding

New users choose a username, select their city and country, pick an avatar emoji, and optionally enter a referral code. The onboarding flow calls `/api/onboarding/complete`, which atomically awards welcome XP and credits, generates a unique referral code, and records a tier-1 referral if a code was provided. Auth is immediately established via HTTP-only JWT cookie (web) or Expo SecureStore (Android).

### Direct Messages (DMs)

1-to-1 private messaging between any two users. Messages are stored in the `room_messages` table with `recipient_id` set. Conversations are fetched from `/api/inbox`.

**Realtime delivery flow:**
1. The sender's POST to `/api/messages/dm/[conversationId]` saves the message to the database.
2. The handler calls `publishRealtimeEvent("dm:conversation:uuid", "new_message", { message })`.
3. `publishRealtimeEvent` makes a stateless HTTP call to the configured provider's REST API (Ably / Pusher / Supabase Realtime). The `REALTIME_PROVIDER` environment variable selects the active provider.
4. The provider delivers the event over WebSocket to all subscribed clients.
5. The recipient's browser (subscribed via `useRealtimeChannel`) receives the event and updates React state immediately — the message appears without any page refresh.

**Message history vs. live updates:** When a conversation is opened, the page fetches initial message history directly from the database via the REST API. Live updates then arrive over **two independent channels that reconcile via message-id dedup**: (1) the realtime provider's WebSocket push (instant, when `NEXT_PUBLIC_REALTIME_PROVIDER` is configured), and (2) an **adaptive baseline poll** (`useAdaptiveChatPoll`). The poll is the safety net that guarantees delivery even when **no realtime provider is configured** (local dev / self-hosted) or the socket is down — so messages never require a refresh.

**Adaptive polling (cost control):** `useRealtimeChannel` reports live connection status, and `useAdaptiveChatPoll` uses it to minimize serverless invocations — critical on constrained hosting (e.g. Vercel Hobby) where each poll is a billable function call + DB read:
- realtime socket **connected** → only a **30s reconcile** poll (the WebSocket carries new messages);
- **disconnected / no provider** → **3s** fast poll;
- **tab hidden** → polling **pauses entirely**, then fires one immediate catch-up poll on focus;
- a (re)connection also triggers an immediate catch-up poll.

This means once Ably/Pusher/Supabase Realtime is configured, an idle or backgrounded viewer makes effectively **zero** REST calls — load scales with *activity*, not with the number of open tabs. Pure polling (no provider) does **not** scale to hundreds of concurrent viewers and is intended for dev / low-traffic only.

**Delta fetch (poll payload control):** each baseline poll requests only messages newer than the latest one the client already holds, via `?after=<ISO timestamp>` on the room/DM/group message GET endpoints (server returns rows with `created_at >= after`, ascending; cursor pagination for backlog is unchanged). The client merges the delta into state, deduping by id and keeping chronological order (web tracks the newest timestamp in a ref; Expo reads the React Query cache and merges newest-first via `lib/chat/delta.ts`). So a poll on a quiet conversation transfers an (almost) empty array instead of the whole snapshot — collapsing both DB work and response size. Boundary rows may repeat and are removed by the same id-dedup. The **first** load (empty client state) still fetches the recent backlog.

**Message-shape normalization:** The DM/group/room message APIs return rows with database (`snake_case`) columns, while the web/Expo clients render a `camelCase` shape. Each client passes every server payload (initial load, poll, realtime push, and the sender's own POST response) through a small `normalize*`/`mapApi*` mapper before storing it in state. This fixed a class of bugs where a freshly-sent message rendered as "@undefined" with no avatar (and was mis-attributed as someone else's) until a refresh — the raw row's `sender_id`/`sender_username`/`created_at` did not match the `senderId`/`senderUsername`/`createdAt` the UI read. The send endpoints also enrich their response/broadcast with the sender's public profile so the very first render is complete.

**Auth for realtime subscriptions:**
- Ably: the browser calls `GET /api/realtime/ably-token?channel=dm:conversation:uuid` which verifies the JWT, confirms the user is a participant, and returns a scoped Ably TokenRequest (subscribe-only, 1-hour TTL).
- Pusher: the browser calls `POST /api/realtime/pusher-auth` which verifies the JWT, confirms participation, and returns an HMAC-signed auth string for the private channel.
- Supabase Realtime: the browser connects directly with the public `anon` key; Broadcast channels are not RLS-restricted (but the channel name includes the conversation UUID, which is not guessable).

Each message sent earns XP on the `social` track.

### Group Chats

Multi-member messaging via `POST /api/messages/group/[groupId]`, stored in the `messages` table. Brought up to parity with the DM and room-message endpoints:

- **Validation:** body is validated with Zod (`content` 1–2000 chars, `messageType` enum) instead of being trusted as-is.
- **Rate limiting:** `enforceRateLimit(userId, 'user', RATE_LIMITS.messageSend)` applies the same per-user send rate limit as DMs and room chat.
- **Auto-moderation:** non-admin text messages are passed through `applyAutoModeration` (spam/profanity/duplicate detection) before being stored, same as room messages.
- **Offline idempotency:** the client may send an `idempotencyKey`; if a message with the same `(sender_id, idempotency_key)` already exists, the existing row is returned with `200` instead of inserting a duplicate. This lets the Expo sync queue and the PWA's offline outbox safely replay a queued send after reconnecting.
- **XP awards:** the sender's `group_message` XP and each active member's `group_message_member` XP are granted via `safeAwardXP`, keyed on the new message's own UUID rather than the bare `groupId`. The previous raw `INSERT INTO xp_ledger` had no `ON CONFLICT` guard and was keyed only on `groupId`, so XP could be double-awarded on retry and a second message in the same group would collide with the first on the ledger's uniqueness constraint.

**Realtime delivery:** The group send endpoint now calls `publishRealtimeEvent("group:<groupId>:messages", "new_message", { message })` after persisting (previously it relied on polling alone). The web group chat page subscribes to that channel via `useRealtimeChannel`; when a push provider (`NEXT_PUBLIC_REALTIME_PROVIDER`) is configured, new messages from other members are delivered over WebSocket instantly — no page refresh required. A 3-second baseline poll runs in parallel and is the sole live channel when no provider is configured.

**Optimistic updates:** All three chat surfaces (DMs, group chats, and rooms) add the sender's own message to the UI immediately on submit (before the server responds), then replace the optimistic entry with the confirmed server message on success, or roll it back on error. This makes the sender's message appear without any perceptible delay.

### Moments

Moments are short-lived posts (text, optionally one image) that expire 24 hours after creation. The feature is accessible via the `/moments` feed page, `/moments/create`, and the in-Room ⚡ "Moment" toggle on the message composer — all three write to the *same* `moments` table, via the shared `createMoment()` pipeline in `apps/web/lib/moments/service.ts`.

**How they work:**
- **Feed page** (`POST /api/moments`, web + Android Capacitor app) and the **Room ⚡ toggle** (`POST /api/rooms/:roomId/messages` with `messageType: "moment"`) both call `createMoment()`, so a Moment sent from inside a Room shows up on the public `/moments` feed for every user, not just Room members.
- The feed is served by `GET /api/moments` — a **public, cross-user** feed (every non-expired Moment from every user, newest first), cursor-paginated (`?cursor=<created_at>&limit=<n>`, capped at 50/page) via the `idx_moments_active_feed` index so it stays fast at thousands of Moments/day. It is not filtered to the caller's follows.
- **Eligibility & pricing** (all admin-configurable via `/admin/config`, backed by `x_manifest` and cached in `ZobiaManifest.moments`):
  - `moments_min_level` (default `2`) — minimum main-rank level required to post.
  - `moments_cost_credits` (default `100`) and `moments_cost_stars` (default `1`) — either currency is accepted when both are priced > 0; set a cost to `0` to disable that currency, set both to `0` to make Moments free.
  - `feature_moments` — master on/off toggle (`requireFeatureEnabled("moments")`).
  - A user without enough of either currency gets a structured `INSUFFICIENT_MOMENT_FUNDS` (402) error before anything is charged or posted; the client renders this as a popup ("You do not have enough Credits and/or Stars to create a moment…") rather than a silent failure.
  - Charging (`debitCoins`/`debitStars`) and the `moments` row insert happen inside one DB transaction, so a failed insert never leaves a user charged for a Moment that was never created.
- The daily CRON expires moments by comparing `expires_at` against `NOW()`. No data is deleted — rows remain in the DB with `expires_at` in the past.
- Reactions (`❤️`, `🔥`, `😂`, `😮`, `👏`, `💯`, `🎉`, `👀`) are stored in `moment_reactions`, written via `POST /api/moments/[id]/reactions`, and now also returned inline (per-emoji counts + `userReacted`) from `GET /api/moments` so reactions persist across a page refresh instead of resetting to 0.
- Moments are available in the Sidebar/Navbar navigation on web (`/moments`) and in the drawer navigation + `⚡` Room composer button on the Capacitor Android app.

**Offline support:** Moments are not queued for offline send on any platform — they require an active connection to upload media. The room ⚡ button is disabled while offline.

---

### Rooms

**Full-screen chat layout (web + PWA):** Conversation views (`/rooms/:id`, `/messages/:id`, `/messages/groups/:id`) are full-screen surfaces — a fixed header, an internally-scrolling message feed, and a pinned composer. They are detected by route in `components/layout/AppContentShell.tsx`, which renders them **full-bleed** (no `max-w-3xl` centering, no page padding) at a height of `calc(100dvh − 3.5rem)` (viewport minus the 56 px sticky top bar), reserving `pb-14` for the mobile bottom tab bar. The chat pages themselves use `h-full` to fill this shell. Previously each page set its own `h-[100dvh]` while nested inside the padded `max-w-3xl` container *and* below the sticky top bar, so the total height exceeded the viewport: content "extended outside the screen" and the input bar was pushed off the bottom on mobile/PWA. All other (feed-style) pages keep the centered, padded column.

**No-overflow message bubbles:** Bubbles use `break-words whitespace-pre-wrap overflow-hidden` and `min-w-0` so long unbroken strings (e.g. a pasted URL) wrap instead of forcing horizontal scroll / page-zoom. GIF and sticker room messages render as a capped image (`max-w-[70vw] sm:max-w-xs`) / large emoji rather than printing the raw URL as text (which used to overflow the viewport).

**Mobile / PWA input bar:** The room chat input bar is fully responsive. On narrow screens (< `sm` breakpoint, ~640 px) the GIF, Sticker, Moment, Gift, and Room Powers buttons are hidden behind a `+` toggle that reveals an extra row above the text input. On wider screens all buttons are always visible inline. The text input uses `font-size: 16px` (`text-base`) so iOS Safari does not auto-zoom the viewport when the field is focused. The root layout sets `maximumScale: 1`, `interactiveWidget: "resizes-content"` and `viewportFit: "cover"` so the on-screen keyboard does not resize the chat container on Android PWA and the layout sits correctly beneath iOS notches.

**Realtime delivery (web room page):** The room send endpoint returns the **normalized camelCase message** (not the raw DB row) and broadcasts it via `publishRealtimeEvent("room:<roomId>:messages", "new_message", message)`. The web room page now uses the same delivery model as DMs/groups — the **adaptive baseline poll** (see *Adaptive polling* above) merged with the realtime push, both deduped by message id and sorted chronologically. (It previously depended on a single-batch SSE stream that closed immediately and only re-fetched on reconnect, which is why other users' messages could lag until a manual refresh.) The `/api/rooms/[roomId]/stream` SSE endpoint remains for any client that still uses it, but is no longer the web page's live channel.

**Provider decoupling / cost notes:** `REALTIME_PROVIDER` (server publish) and `NEXT_PUBLIC_REALTIME_PROVIDER` (client subscribe) are independent of `DATABASE_PROVIDER` and `STORAGE_PROVIDER` — e.g. DigitalOcean Postgres + Ably + R2 requires **no Supabase** at all (the `lib/db/__tests__/providerLeakage.test.ts` regression test enforces that the Supabase SDK never leaks outside its env-gated adapter). `lib/env.ts` fails fast at startup if a selected realtime provider is missing its keys, so you never silently fall back to (expensive) polling. Provider billing is dominated by **fan-out** — a message to a channel with N subscribers ≈ `1 + N` delivered messages — so watch per-room audience size, not just raw send volume.

**Soft presence caps (the fan-out control).** Each room has a soft concurrent-participant cap enforced against **live presence**, not DB membership. Presence lives in a Redis sorted set `room:presence:<roomId>` (`lib/presence/room.ts`); clients heartbeat `POST /api/rooms/[roomId]/presence` every ~45s while viewing, and entries expire after ~70s so a slot frees automatically on tab/app close or idle — no "Leave" button. Admission is atomic (Lua script): the creator and moderators always get in; everyone else only while the live count is below the cap. A full room returns `{ admitted: false }`, and the client then **does not subscribe to the realtime channel** — bounding fan-out. Effective cap = the room's `max_members` override (set by a paid upgrade) else the manifest default for its type (`resolveRoomCap`, `lib/rooms/capacity.ts`). Defaults live in `x_manifest` (`room_free_open_cap`=30, `room_tipping_cap`=30, `room_vip_cap`=200, `room_drop_cap`=100, `room_classroom_cap`=150, `room_guild_cap`=100) and are admin-editable.

**Paid capacity upgrade.** `POST /api/rooms/[roomId]/capacity` lets a room creator spend Credits to raise their own room's `max_members` in fixed steps up to a hard ceiling (manifest keys `room_capacity_upgrade_step`, `room_capacity_upgrade_cost`, `room_capacity_hard_max`). The debit + cap bump are atomic and idempotent (keyed on the target cap) via `debitCoins(... "room_capacity_upgrade" ...)`. Discovery (`GET /api/rooms`) returns each room's live `present_count` + `is_full`, powering the **"Full" badge** and an availability filter (All / Available / Full) on web and Expo room cards.

**Push notifications (offline/backgrounded reach).** After persisting a message, the API pushes to recipients who are **not currently online** (`lib/notifications/chatPush.ts` + `isUserOnline`): DMs → the other participant; group messages → all other members; rooms → only users who were `@mentioned` (never the whole room). Each category has an independent user toggle — `dm_notifications`, `group_notifications`, `room_mention_notifications` on `users`, edited via `/api/users/me/settings` and the Settings screens — and the sender checks the relevant column before sending.

**Mobile realtime + persisted cache.** The Expo app uses the same provider-agnostic hook (`apps/expo/lib/realtime/useRealtimeChannel.ts`, Ably via `authCallback` + Bearer JWT) and makes React Query polling adaptive: `refetchInterval` backs off to 30s when the socket is connected, and `focusManager`/`onlineManager` (wired to `AppState`/NetInfo in `lib/api/client.ts`) pause polling while backgrounded and refetch on foreground. A persisted local message cache (`messageCache.ts` — localStorage on web/PWA, encrypted MMKV on mobile) hydrates recent messages instantly on open and keeps a usable view offline.

**Room creation — slug/`is_public` ordering (fixed).** `rooms` has a CHECK constraint, `rooms_public_requires_slug`, requiring `slug IS NOT NULL` whenever `is_public = TRUE`. `POST /api/rooms` used to insert the row first and only generate+attach the slug in a follow-up `UPDATE` inside the same transaction — but a CHECK constraint is evaluated per-statement, not deferred to COMMIT, so *every* room creation (Free, VIP, Drop, Tipping, ClassRoom) violated the constraint on the initial `INSERT` and 500'd. The fix mirrors the existing game-creation pattern (`app/api/admin/games/route.ts`): generate the slug via `generateUniqueSlug()` with a throwaway `crypto.randomUUID()` fallback *before* the `INSERT`, and pass `slug`/`is_public` in the same statement. Guild Rooms are the one type created with `is_public = FALSE` (private to guild members).

**Guild Room association (fixed).** Creating a `type: "guild"` room previously never wrote to `rooms.guild_id` or the `guild_rooms` join table, so the room the creator just made was unreachable — `GET /api/rooms/[roomId]` (which reads `guild_rooms`) and `POST /api/rooms/[roomId]/join` (which reads `rooms.guild_id`) both threw `403`/`400` for lack of a guild association, even for the creator. `POST /api/rooms` now resolves the owning guild (the caller's highest-tier owned/administered Platinum+ guild, or — for admins — any guild, optionally chosen via `guildId` in the request body) *before* the insert and writes both `rooms.guild_id` and a `guild_rooms` row inside the same transaction.

**Admin bypass for room creation/access.** `is_admin` (re-checked against the database, never trusted from the JWT) now bypasses every room-creation eligibility gate — creator-tier requirement, paid-ClassRoom Trust Score gate, Guild-tier requirement — and the Guild Room viewing gate on `GET /api/rooms/[roomId]`. `GET /api/rooms/eligibility` reports which room types the *current* user may create (`allowedTypes`) so the create-room UI hides buttons for types a regular user isn't eligible for instead of letting them submit and hit a 403; admins get every type plus the full guild list for the Guild Room picker.

**Room card field-name contract (fixed).** `GET /api/rooms`, `/api/rooms/pinned`, and `/api/rooms/recent` used to return the raw snake_case `rooms` row (`member_count`, `cover_emoji`, `type`, …), while every consumer — the web `RoomCard`, the Capacitor Android app's shared `Room` type (`shared/types/index.ts`), and the Expo app — reads camelCase fields (`memberCount`, `coverEmoji`, `roomType`, …). Cover images, member counts, join state, and pricing silently rendered as blank/undefined everywhere a room card appeared, and the Drop Room FOMO strip and Pinned Rooms strip never actually populated (their client-side mapping already assumed the correct camelCase shape). `lib/rooms/serialize.ts` (`toRoomCardPayload`) is now the single place that produces the canonical camelCase room-card payload; all three endpoints use it, so web, the PWA, and the Capacitor Android app read a consistent shape.

**Faves + Recently Visited discovery tabs.** The Rooms discovery page (list view by default — the scalable choice for a feed that can grow to tens of thousands of rooms — with a grid toggle matching the Games page pattern) adds two tabs alongside Trending/Near Me/Friends In:
- **Faves** (❤️ heart icon on every room card) reuses the existing Room Pins mechanism (`room_pins` table, `/api/rooms/pinned`, PRD §3 — tiered by plan) rather than introducing a second favorites table. Toggling the heart calls `POST`/`DELETE /api/rooms/pinned`.
- **Recently Visited** (🕐 clock icon) is backed by a new `room_visits` table (part of the consolidated schema, `db/migrations/0001_consolidated_schema.sql`), upserted fire-and-forget on every `GET /api/rooms/[roomId]`, and served via the new cursor-paginated `GET /api/rooms/recent`.

The Android Capacitor rooms list also gets the heart-icon favorite toggle (same `/api/rooms/pinned` endpoint via a `useMutation` + optimistic `setQueryData`, matching the pattern already used by its notifications screen) — its rooms screen is intentionally minimal (no tabs, no create flow anywhere in the app) so the fuller tab/view-toggle UI stays web/PWA-only.

**`xp_ledger` schema drift (fixed).** An early schema cleanup pass dropped `xp_ledger.action`/`xp_amount`/`xp_net`/`multiplier`/`metadata` as "never populated by any code path" — but `GET /api/nemesis`, the Season Pass gift route, the ClassRoom quiz-attempt route, and the automated-action reversal route all later started reading/writing those columns (and, in three cases, omitted the still-NOT-NULL `amount`/`base_amount`/`source` columns entirely), so every one of those code paths threw. The three write paths now call the canonical `safeAwardXP()` (`lib/xp/safeAwardXP.ts`) instead of hand-rolled `INSERT`s — it already writes the required columns, dedupes on `reference_id`, and updates leaderboard snapshots — and `GET /api/nemesis` reads `amount` directly instead of the dropped `xp_net` column.

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

Guilds are persistent groups of up to N members. Creating a guild costs 500 Credits (deducted atomically). Members earn `competitor` track XP from guild activities. Guilds have a treasury (credit pool) funded by member donations and war rewards. Guild tiers (bronze → silver → gold → platinum → diamond) unlock higher treasury caps and XP multipliers. See **Guild War Engine** below.

`guild_members.left_at` records the timestamp when a member left or was removed, enabling accurate membership duration queries and historical analytics. `guild_tier_history` records a `war_id` (FK to `guild_wars`) so each tier snapshot is tied to the specific war that triggered it; the partial unique index on `(guild_id, war_id) WHERE war_id IS NOT NULL` prevents duplicate snapshots per war.

### XP System

XP is earned on eight tracks: `main` (overall), `social`, `creator`, `competitor`, `generosity`, `knowledge`, `explorer`, and `gaming`. Each action type maps to a specific track (e.g. sending a message → social; publishing content → creator; winning a guild war → competitor; playing or winning games → gaming). The XP Engine applies a multiplier stack — plan bonus → guild bonus → season pass bonus → active booster — using integer basis-point arithmetic. All XP flows through `/api/xp`, which writes to `xp_ledger` and updates `users.xp_total` and the relevant track field.

### Dual Currencies

**Credits** (soft currency, previously "Coins") — Earned from quests, daily logins, season rewards, gifts received, rewarded ads (free users only, capped at 5/day). Spent on guilds, gifts, store items, and room creation. Stored in `users.coin_balance`; all mutations go through `coin_ledger` (append-only audit trail). The display name is admin-configurable via `x_manifest` keys `currency_soft_name_singular` / `currency_soft_name_plural` (defaults: Credit / Credits).

**Stars** (premium currency) — Purchased via Paystack or DodoPayments. Used for exclusive cosmetics and season pass upgrades. Stored in `users.star_balance` (bigint — safe up to ~9.2 × 10¹⁸); all mutations go through `star_ledger`. The display name is admin-configurable via `currency_premium_name_singular` / `currency_premium_name_plural` (defaults: Star / Stars).

**Subscription lifecycle:** Paystack fires webhook events for all subscription state changes (`subscription.create`, `subscription.disable`, `subscription.not_renew`, `invoice.payment_failed`). The webhook handler maps each event's `isActive` flag to either `"active"` or `"inactive"` in the `subscriptions` table. Cancelled or failed subscriptions are correctly reflected as `status = "inactive"` — users do not retain access after cancelling or missing a payment. For `subscription.disable` events: `ends_at` is set to `next_payment_date` when provided; when absent the existing `ends_at` is preserved (if set), otherwise it falls back to `NOW()` — ensuring users never retain premium access indefinitely when both fields are absent.

### Gifting

Users can send gift items (flower, trophy, crown, etc.) to any other user. Gift items have credit prices and tiers. The XP awards for gifting are (PRD §6):

| Event | Who | XP | Track |
|---|---|---|---|
| Sending any gift | Sender | 10 (fixed) | Generosity |
| Receiving any gift | Recipient | 5 | Social |
| First-ever gift received | Recipient | +15 bonus | Social |
| Gift sent in a Room (tip) | Room creator/recipient | 25 | Creator |
| Hosting a Room for 30+ minutes | Creator | 50 (on room close) | Creator |

Creators earn credit revenue when they receive gifts in their rooms (80% net; 85% for Zobia Icon creators). The platform retains the remainder. All credit flows are recorded atomically in `coin_ledger`.

#### Gifts Hub

A dedicated **Gifts Hub** is accessible from the main navigation (below Friends) on both web and Expo:

- **Web:** `/gifts` — tabbed view of received/sent gift history, plus a **Send a Gift** modal. The modal supports searching friends by username (debounced), browsing the catalogue by tier, and confirms the credit cost before sending. Pre-fill a recipient via `?recipientId=<id>` or `?username=<name>` query params (e.g. from a friend's profile page). A prominent **🗂️ Browse gift catalog** button (styled the same as other secondary actions on the page, not a bare text link) opens the same modal without a pre-filled recipient.
- **Expo:** `/(tabs)/gifts` — the same two-tab history view; tapping **Send a Gift** navigates to the existing `/economy/gift-send` send flow. The screen is hidden from the bottom tab bar and accessed via the swipe drawer.

**Gift-to-user deep link:** `/gift/:userId` (used by profile "🎁 Gift" buttons, share cards, and `zobia://gift/:userId` deep links) resolves the target user's username via `GET /api/users/:userId` and redirects to `/gifts?recipientId=<id>&username=<name>` — it hands off to the same Gifts Hub send flow above rather than re-implementing gift selection, wallet balance, and PIN verification a second time. (Previously this page called two API routes that were never implemented, `/api/users/:userId/public` and `/api/economy/gift-items`, so it always showed "User not found" regardless of whether the target user existed — fixed.)

**Gift history API:** `GET /api/economy/gifts` (fixed 500 error). The query joined `gift_types gt ON gt.id = gi.gift_type_id`, but `gift_type_id` lives on `gifts` (added to `gifts`), not on `gift_items` (aliased `gi`) — every call threw `column gi.gift_type_id does not exist`, so both the `/gifts` page and the Gifts Hub history tabs always showed "An unexpected error occurred." Fixed to join on `g.gift_type_id` (the `gifts` row alias).

| Query param | Default | Description |
|---|---|---|
| `type` | `both` | `sent`, `received`, or `both` |
| `limit` | `20` | Max 100 |
| `cursor` | — | Opaque cursor string returned by a previous response as `nextCursor`. Omit for the first page. |

The response includes a `nextCursor` field. Pass it as `?cursor=<value>` to fetch the next page. A `null` value means there are no more pages. Cursor-based pagination prevents items from being skipped or duplicated when new gifts are received during navigation.

Response shape (each item):
```json
{
  "id": "uuid",
  "direction": "sent" | "received",
  "gift_item": { "name": "...", "emoji": "...", "tier": 1, "credit_price": 50 },
  "sender": { "id": "uuid", "username": "...", "avatar_emoji": "..." },
  "recipient": { "id": "uuid", "username": "...", "avatar_emoji": "..." },
  "credits_paid": 50,
  "created_at": "ISO8601"
}
```

### Seasons

Seasons run in 8-week cycles. Each season has four phases:

- **Opening (weeks 1–2)**: High XP for first-time actions, quest bonus multiplier active
- **Mid-Season (weeks 3–5)**: Standard rates, guild war frequency peaks
- **Push (weeks 6–7)**: Leaderboard freeze warnings, sprint quests unlock
- **Final Day (week 8)**: 2× XP all day, global leaderboard visible to all users

Season Pass: the free tier earns basic credit rewards for completing quests. The paid tier unlocks exclusive cosmetics, animated borders, and bonus XP multipliers. At season end, competitive rankings reset. Track levels, credit balance, friend list, and history are all preserved.

### Prestige

When a user reaches the maximum rank (Zobia Icon, sublevel III), they can Prestige via `POST /api/prestige`. Their main XP resets to 0 while their prestige count increments. Prestiged users receive:

- **Prestige 1**: 500 bonus credits + Phoenix frame badge
- **Prestige 2+**: 1 Zobia Star per prestige cycle
- **Prestige 3+**: 3× XP boost for the first 7 days of each new cycle; Elder Candidate badge at P3
- **Prestige 5**: Veteran Prestige badge
- **Prestige 10 — Hall of Fame**: Hall of Fame badge, permanent top-100 visibility on the global main leaderboard (users are always pinned into the top 100 even after XP reset), and the exclusive **custom crest** feature

**Custom Crest (Prestige 10 only)**: Hall of Fame users can set a custom crest (emoji or image URL, max 500 chars) via `PUT /api/users/me/crest`. The crest appears on their leaderboard entry, profile page, and DM header. Non–Hall of Fame users calling this endpoint receive a 403.

**Legacy Score**: Accumulated across all Prestige cycles; never resets; displayed with a ⚜️ icon on profile and leaderboard. The Hall of Fame table (`hall_of_fame`) records the user's legacy score at induction time.

### Creator Economy

Creators (marked `is_creator = true`) earn revenue from:
- Room entry fees (paid rooms)
- Gifts received in their rooms (80% to creator, 20% to platform; **85% for Zobia Icon tier** or Creator Track Level 50 unlock)
- Paid content subscriptions

Revenue accrues to `creator_earnings`. The daily CRON (on payout day) checks creators above the minimum payout threshold (default: ₦5,000 via Paystack). Creators above the manual-approval threshold (default: ₦100,000) require admin approval before disbursement. Completed payouts record to `creator_payouts`.

**Idempotency:** `creator_earnings` has a partial unique index on `(creator_id, reference_id) WHERE reference_id IS NOT NULL`. Creator fund distribution supplies a deterministic `reference_id` (e.g. `creator_fund:<date>:<creatorId>`) so the `ON CONFLICT (creator_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` guard prevents double-crediting if the CRON runs twice in the same period. The composite index (rather than a bare `reference_id` index) ensures two different creators can legitimately share the same `reference_id` without collisions.

**Creator Tiers:** The `creator_tier` column on the `users` table follows five levels based on follower count:

| Tier | Minimum followers | Creator Fund eligible |
|---|---|---|
| `rookie` | 0 | No |
| `rising` | 100 | No |
| `verified` | 500 | No |
| `elite` | 2 000 | Yes |
| `icon` | 5 000 | Yes |

Tier boundaries are re-evaluated by the daily CRON (step 28). Creator Fund distributions go to `elite` and `icon` tier creators only. The `elite` tier was added to fill the gap between `verified` (500) and `icon` (5 000); the daily CRON assigns it correctly when a creator reaches 2 000 followers.

**Creator Fund (monthly):** The platform sets aside 5% of advertising revenue each month into the Creator Fund. On the **1st of each month**, the daily CRON seeds the fund pool by reading `ad_revenue_YYYY_MM_kobo` from `x_manifest` and writing 5% to `creator_fund_balance_kobo`. On the **5th of each month**, the daily CRON distributes the pool to eligible creators (Elite tier+) proportional to their engagement score, then resets the pool to 0. During **International Women's Month** (first week of March), female creators receive a 1.5× boost to their Creator Fund allocation.

**RIZE Coin conversion (PRD §14):** Instead of a bank payout, creators can request `asCoins: true` when calling `POST /api/creator/payouts`. The net earnings are converted to Credits at the admin-configurable `kobo_per_coin` rate (default 100 kobo = 1 Credit) and credited to the creator's wallet in the same atomic transaction.

**Room capacity gates by Creator Track level:** Creators below Level 5 can create rooms with up to 50 members. Reaching Level 5 raises the cap to 100 (Room Opener milestone). Reaching Level 20 removes the cap entirely (rooms can grow to the platform maximum).

### Blogs (PRD §32)

A mini blog/CMS system reusing the platform's existing economy, XP, plans,
moderation and admin infrastructure (same pattern as Answers, §31). Every
user may create one blog (`blogs` table, one row per owner) with a public,
SEO-crawlable home page at `/b/<slug>` and articles/pages at
`/b/<slug>/<postSlug>` — see `app/b/[slug]/page.tsx`,
`app/b/[slug]/[postSlug]/page.tsx`, `lib/public/resolveBlog.ts`,
`lib/public/resolveBlogPost.ts`. `/blogs` (discovery, mirrors Games) and
`/blogs/dashboard` (posts, categories, comment moderation, stats,
settings) are the authenticated web/PWA and Capacitor Android routes;
business logic lives in `lib/blogs/repo.ts` + `lib/blogs/service.ts` +
`lib/blogs/limits.ts`.

- **Articles vs. pages:** articles are dated posts listed reverse-chron on
  the blog home page with an author info box (owner can hide it); pages
  are static, undated, and only appear in the blog's page menu.
- **Word/post limits by plan:** Free 1,000 words/30 posts, Plus/Pro/Max
  5,000 words, with 100/200/500 max posts respectively —
  `lib/blogs/limits.ts`, admin-overridable via `x_manifest`
  (`blog_max_words_<plan>`, `blog_max_posts_<plan>`).
- **Comments:** default on; owner can disable entirely or require
  moderation (`pending` → `visible`/`removed`), moderated from
  `/blogs/dashboard/comments`.
- **Paywalled articles:** the author sets a per-article Credit cost to
  unlock; the public page renders a truncated preview server-side (good
  for SEO) with a "Pay N credits to read the rest" notice. Unlocking
  (`POST /api/blogs/<slug>/posts/<postSlug>/unlock`) debits the reader's
  Credits once (idempotent) and credits the author via the existing
  `creator_earnings` table (`source_type = 'blog_paywall'`), converting
  Credits to kobo with the platform's existing `coin_to_cash_rate` and
  applying provider-fee/VAT/plan-revenue-share rates from
  `lib/blogs/limits.ts` (all admin-configurable in `x_manifest`; default
  revenue share by plan: Free 40%, Plus 50%, Pro 60%, Max 70%).
- **Themes:** three purchasable themes reuse the existing cosmetics store
  (`store_items.cosmetic_type = 'blog_theme'`,
  `GET/POST /api/economy/cosmetics(+/equip)`) — no new purchase flow.
- **Stats:** basic totals for Free; a per-post breakdown for Plus; a
  90-day daily drill-down + CSV export for Pro/Max
  (`GET /api/blogs/<slug>/stats(+/export)`), backed by the lightweight
  `blog_post_daily_stats` rollup table.
- **Admin:** `feature_blogs` master toggle; `/admin/blogs` lists every
  blog with pause/suspend/ban/deactivate/restore/delete actions (each
  logged to `blog_moderation_log`) and an admin-only ownership-transfer
  action (`POST /api/admin/blogs/<id>/transfer`).
- **Views:** recorded at most once per browser per post — deduped
  client-side via `localStorage` (`zobia_blog_viewed`), not a per-view DB
  row, matching the platform's offline-first, low-Redis-call discipline.
- **Subscribed tab:** `/blogs?tab=subscribed` lists blogs the caller
  subscribes to, sorted by most recently *published article* first
  (falling back to the blog's creation date), not `blogs.updated_at` —
  that column isn't bumped when a draft is published later, only on new
  posts/metadata edits, so `lib/blogs/repo.ts` `listSubscribedBlogs()`
  computes `MAX(published_at)` per blog instead. Cursor-paginated on the
  `(sortKey, id)` tuple since the sort key isn't the id. Web/PWA renders
  this as a fifth tab; Android surfaces it as a simple toggle instead of a
  full tab bar (same "no Popular/Trending/New/Random tabs on mobile"
  convention as the rest of this page).

### Social Graph

- **Friends**: Bilateral friendship requests. Stored in `friendships`. Friend list visible on profile.
- **Follows**: Unilateral following. Stored in `follows`. Used for feed curation and notification preferences.
- **Mutual follows** appear in suggestions.

The Friends page (`/friends`) has four tabs:
1. **My Friends** — accepted friendships with quick Remove action.
2. **Requests** — split into two sub-tabs:
   - **Received** — incoming pending requests; Accept / Decline buttons.
   - **Sent** — outgoing pending requests; Withdraw button (calls `DELETE /api/friends/[id]`). Sent requests fetched from `GET /api/friends/requests/sent`.
3. **Recent** (🕐) — people the user has recently direct-messaged, most-recent-first. Backed by the existing `GET /api/messages/dm` conversation list (no new table — the same data already powers the Messages inbox), each row links to the sender's profile and to the conversation.
4. **Discover** — suggested users to add.

Count badges on the Received and Sent sub-tabs show pending counts at a glance. Every avatar/name in all four tabs links to `/profile/:userId`.

**New-request blue dot:** `POST /api/friends` writes an unread `notifications` row (`type: 'friend_request'`) for the addressee. The Friends page checks `GET /api/notifications?type=friend_request&unread=true&limit=1` on load and shows a small blue dot on the Requests tab when the count is non-zero. Opening the Requests tab calls `POST /api/notifications/read-all` with `{ "type": "friend_request" }` in the body — this clears only the friend-request notifications (via a `type` filter added to the read-all route), leaving unrelated bell notifications untouched.

### Profile Privacy

Users can control the visibility of their profile through five privacy settings. The first, second, third and fifth are gated to specific plans/ranks; the fourth is available to all users:

| Setting | Default gate | What it does |
|---|---|---|
| **Private Profile** | Pro / Max / Prestige 1+ | Hides the profile entirely from non-friends (returns 403) |
| **Hide profile sections** | Plus / Pro / Max / Prestige 1+ | Removes individual sections (avatar, bio, rank, xp, guild, seasons, badges) from the non-owner view |
| **Disable friend requests** | Plus / Pro / Max / Prestige 1+ | Prevents the "Add Friend" button appearing on the user's profile |
| **Sitemap opt-out** | All users (no plan gate) | Excludes the user's profile URL from the public `/sitemap.xml` so search engines do not index it |
| **Show online status** | Pro / Max / Prestige 1+ | Opts the user into appearing in friends' Home page "Online Friends" row. **Off by default** — see "Online Friends & Presence Filtering" below. |

Settings are stored as five columns on the `users` table:
- `profile_private` — BOOLEAN
- `profile_hidden_sections` — JSONB array of section keys
- `disable_friend_requests` — BOOLEAN
- `sitemap_opt_out` — BOOLEAN (default `false`; toggled via `PATCH /api/users/me/privacy`)
- `show_online_status` — BOOLEAN (default `false`)

**Enforcement** happens in `GET /api/users/[userId]/profile`:
1. If the profile owner is banned → 403 `ACCOUNT_RESTRICTED`.
2. If the profile owner is suspended → 403 `ACCOUNT_SUSPENDED`.
3. If `profile_private = true` AND the viewer is not a confirmed friend AND the viewer is not the owner AND the viewer is not an admin → 403 `PROFILE_PRIVATE`.
4. For non-owners, fields listed in `profile_hidden_sections` are stripped from the response.

**User control** via `PATCH /api/users/me/privacy` — only toggles the user is eligible for (based on plan/prestige) are accepted. Eligibility is checked server-side against `x_manifest` flags.

**Admin control** — the admin panel page at `/admin/settings/privacy` lets admins configure which plans and prestige ranks can access each privacy feature. The four configurable flags stored in `x_manifest`:

| Key | Default |
|---|---|
| `privacy_can_lock_profile` | `["pro","max","prestige_1"]` |
| `privacy_can_hide_sections` | `["plus","pro","max","prestige_1"]` |
| `privacy_can_disable_friend_requests` | `["plus","pro","max","prestige_1"]` |
| `privacy_hideable_sections` | `["avatar","bio","rank","xp","guild","seasons","badges"]` |
| `privacy_can_show_online_status` | `["pro","max","prestige_1"]` |

Changes take effect within 60 seconds (Redis cache TTL).

### Online Friends & Presence Filtering

The Home page "Online Friends" row previously listed **every** accepted friendship regardless of whether the friend was actually online — it called the same `GET /api/friends` endpoint used by the full Friends list page, which has no presence filter at all. Fixed by adding a dedicated `GET /api/friends/online` endpoint that only returns friends who:

1. Have opted in via `show_online_status = TRUE` (see Profile Privacy above — off by default, Pro/Max gated), **and**
2. Have `last_active_at` within the last hour ("recently active"; within 5 minutes is flagged `isOnline: true` and rendered as the "online" presence ring, matching the 5-minute TTL used by the Redis presence heartbeat key).

This is a pure SQL filter on `users.last_active_at` (already kept warm by `POST /api/presence` on every heartbeat) — it adds **zero** additional Redis calls. The Home page passes the already-known `isOnline` flag into `<OnlineRing knownStatus=... />`, which skips its usual per-avatar `GET /api/presence/[userId]` fetch (an avoidable Redis `GET` per rendered friend) when a known status is supplied.

### Profile Components (PRD §15)

- **Creator Card**: When `is_creator = true`, the profile shows the creator's top 3 rooms by member count with a "see all N rooms by this creator" link (`/rooms?creator_id=<id>`, a new optional filter on `GET /api/rooms`), member count, and total earnings (own profile only, for privacy).
- **Public Achievements Wall**: Up to 12 lifetime `user_badges` displayed as amber chips with earned-date tooltips.
- **Connection Badge**: If the viewer and profile user have a `dm_conversations.conversation_score ≥ 7`, a badge appears (Connected = 7 days, Gold Connection = 14 days, Platinum Bond = 30 days).
- **Legacy Score**: Accumulated across all Prestige cycles; displayed with a ⚜️ icon.

### User Profile Stats Page (PRD §15)

A dedicated Stats page at `/profile/[userId]/stats`, backed by `GET /api/users/[userId]/stats`, aggregates everything about a user in one place: all badges (not capped at 12 like the public wall), all seven progression tracks, created rooms, guild, social counts (friends/followers/following/referrals), and leaderboard positions.

**Visibility.** `withAuth` confirms the caller is either the profile owner or has `is_admin`/`is_moderator` set (re-checked fresh from the DB, never trusted from the JWT — same pattern as the leaderboard plan-visibility check in `GET /api/leaderboards`). Everyone else gets 403. The page is never linked for a regular viewer of someone else's profile; it's reachable from the owner's own `/profile` quick actions, and as a "📊 Stats" action button on `/profile/[userId]` only when `canViewStats` (computed server-side) is true. It is fetched only when the user actually opens the page — never prefetched alongside the profile.

**Basic vs. Full tiers.** `lib/plans/eligibility.ts` (`getAllowedPlans` + `isPlanEligible`, extracted from the Profile Privacy gates below so the same plan/prestige-tier logic isn't duplicated a third time) checks the target user's plan against the `profile_stats_full_plans` x_manifest key (JSON array, default `["plus","pro","max"]`). Free users get **Basic**: badges, tracks, rooms, guild, social counts, and a single "main track, global scope" leaderboard rank. Plans on the list get **Full**: everything in Basic plus every track × every scope (global/city/guild/season) leaderboard rank and season history — computed with the same `getUserRank()` helper used by `GET /api/leaderboards/me`, just scoped to the target `userId` instead of the caller.

**Admin control.** The master switch (`feature_profile_stats`) is a normal `feature_*` key, so it's picked up automatically by the existing Feature Flags panel (`/admin/feature-flags`) with no code change beyond a nicer label. Which plans get Full vs Basic is configured separately at `/admin/settings/profile-stats` (chip selector, same UI pattern as `/admin/settings/privacy`), writing to `profile_stats_full_plans` via the existing generic `PUT /api/admin/config/[key]` route.

**Wallet integration.** The Wallet page shows a compact rank/badges/prestige summary (reading `GET /api/users/me`, which now also returns a cheap `badge_count` via one correlated subquery) linking to this Stats page, so users don't have to leave Wallet to see their standing.

### Wallet Transaction Pagination

The Wallet page previously fetched up to 30 transactions once with no way to see older ones, even though `GET /api/economy/coins/balance` already supported cursor pagination (`cursor`/`star_cursor` query params, `nextCursor`/`nextStarCursor` in the response) — the UI just never read those fields. Now the page requests **10 at a time** and exposes a "Load more" button per currency tab (Credits/Stars have independent cursors, mirroring the notifications page's `cursor`/`hasMore`/`loadingMore` pattern), appending results client-side. No backend changes were needed.

### Guild Treasury (PRD §13)

Legend-tier guilds earn a 5% share of credit gift values sent in rooms where their creator-members are active. This share is taken from the platform fee (not created new), so the total coin supply is never inflated. Each qualifying gift atomically increments `guilds.treasury_balance` and appends a `guild_treasury_log` row with `source = 'room_revenue_share'`. The treasury balance is visible to guild members and spent via future guild upgrades.

### Ad Revenue Share (PRD §10)

Free Open Rooms with 500+ monthly active users (MAU) are automatically enrolled in the ad revenue share programme on the 1st of each month. The daily CRON:
1. Counts distinct members active in each room during the prior month and upserts a snapshot into `room_monthly_active_users`.
2. Sets `rooms.is_ad_enrolled = TRUE` for any room reaching the threshold and sends the creator an `ad_revenue_enrolled` notification.
Once enrolled, future revenue from the in-room AdMob/ad network is shared with the creator at the admin-configured rate.

### Platform Advertising (PRD §17 Pillar 3)

Self-service, CPM-billed ad system layered on existing infrastructure — no parallel payment, moderation, or config system was built for it.

- **Eligibility.** `checkAdvertiserEligibility()` (`lib/ads/limits.ts`) requires a `verified` Business Account whose owner's `users.kyc_tier` is at least `ad_min_kyc_tier_to_advertise` (x_manifest, default 1). Checked on every campaign create/list route — never trusted from a client claim.
- **Schema** (`db/migrations/0006_ads.sql`): `ad_placements` (admin slot catalogue + base CPM), `ad_campaigns` (business- or admin-owned), `ad_creatives` (per-placement creative, format html/text/image/native/third_party — `third_party` is admin-only), `ad_events` (append-only impression/click log, idempotent per `client_event_id`), `ad_campaign_daily_stats` (rollup written in the same transaction as each event), `ad_coupons`/`ad_coupon_redemptions`.
- **Moderation** (`lib/ads/repo.ts` `submitCampaignForModeration`) mirrors the Sponsored Quest flow exactly: `ad_moderation_mode` manual → admin queue at `/admin/ads` (approve/reject, `admin_audit_log`, notification to submitter); `ai` → `classifyAdCreative()` (`lib/moderation/aiClassifier.ts`, DeepSeek primary/Gemini fallback, user content only ever in the user turn) auto-approves at or above `ad_ai_auto_approve_threshold`, else falls back to manual.
- **Billing.** Funding a campaign (`POST /business/ads/campaigns/:id/fund`) debits the advertiser's `coin_balance` through the existing `coin_ledger` (atomic, idempotent, `SELECT FOR UPDATE`) — the "pay with cash" path is just the existing Credit Pack purchase flow (Paystack/DodoPayments/Play Billing) run first. Per-impression CPM spend (`lib/ads/serve.ts` `recordAdEvents`) then draws down `ad_campaigns.spent_credits` directly, **not** one `coin_ledger` row per impression — that would balloon the ledger under normal ad traffic; `ad_events` is the impression-level audit trail instead. A campaign auto-completes once `spent_credits >= total_budget_credits`.
- **Serving** (`GET /api/ads/serve?placement=<key>`, `lib/ads/serve.ts` `serveAd`) picks a random active/approved/in-budget/plan-eligible creative for a placement — no per-user Redis frequency tracking; the client (`components/ads/AdSlot.tsx`) does offline-friendly frequency/queueing in `localStorage` instead (`adEventQueue.ts`), batching impression/click reports and flushing via `sendBeacon` on unload/visibility-change, so ad tracking costs at most a couple of requests per session, not one per impression.
- **In-stream Room ads.** `app/(app)/rooms/[roomId]/page.tsx` interleaves `<InStreamAd />` after every `roomInstreamInterval` messages (x_manifest `ad_room_instream_interval`, default 10) — **`free_open` Rooms only**, gated client-side via `useAdsConfig()` (rides the same cached `GET /api/manifest` as `useMomentsConfig`/`useCurrency`).
- **Plan-based exposure.** `ad_plan_<plan>_ads_level` (full/reduced/none) per plan; `serveAd()` returns `null` for `none` plans server-side, so no client-side bypass is possible.
- **AdMob (Capacitor Android only, additive).** `apps/android/src/lib/ads/admob.ts` wraps `@capacitor-community/admob`, reading unit IDs/test-mode from `GET /api/manifest` (`ads.admob`) — falls back to Google's official test unit IDs whenever `testMode` is on or a real unit ID isn't configured, so it's always safe to ship. Requires a native `AndroidManifest.xml` App ID step before Play Store release — see `docs/SETUP.md`.
- **Boosted content.** A campaign with `objective = boost_post`/`boost_room` and `boosted_content_id` set promotes a Blog post or Room through the identical campaign/billing/moderation pipeline — no separate "boost" table.
- **Rewarded ads** (`POST /api/economy/rewards/ad-reward`, pre-existing) now reads its daily cap and Credit payout range from `x_manifest` (`ads.rewardedDailyCap/rewardedCreditsMin/Max`) instead of hardcoded constants — the Redis daily-counter idiom (single `INCR` + midnight-UTC TTL) is unchanged.

### Nemesis System

Every week, each user can be assigned a Nemesis: another user within 10% of their XP on their highest active track. The algorithm prefers users in the same city, excludes mutual friends. The Nemesis is displayed on the home screen with an XP delta. Notifications fire when the Nemesis overtakes the user or falls behind. A **Challenge** button starts a 7-day XP sprint between the two users.

**Atomicity:** The nemesis assignment (deactivate old record + insert new) is performed inside a single database transaction. Either both succeed or neither does — users can never be left without an active nemesis due to a partial write.

**Uniqueness:** A partial unique index on `nemesis_assignments(user_id, track) WHERE is_active = TRUE` ensures only one active nemesis per user per track at the DB level. The old non-partial index on `(user_id, track, is_active)` allowed multiple active rows for the same user/track pair.

### Elder System

The Elder is the highest-XP user in a given city. The Elder badge appears on their profile and in the city leaderboard. The Elder title changes whenever the city leaderboard rank-1 changes.

### Platform Council

A small group of top users (selected by trust score + XP) who can vote on policy questions raised by the admin team. Council membership is updated weekly.

### Referral System

Each user gets a unique referral code after onboarding. Sharing `?r=<code>` when a new user signs up creates:
- **Tier 1 referral**: The referrer earns coins + XP when the new user qualifies (completes first action).
- **Tier 2 referral**: If the referrer was themselves referred, the original referrer also earns a smaller bonus.

Referral commissions are tracked in `referral_commissions` with both coin and monetary (kobo) fields. `commission_kobo` stores the actual naira value of the commission in kobos (smallest currency unit); `commission_coins` stores the coin equivalent. These are computed from the actual Paystack/DodoPayments charge amount, not from coin quantities.

Referral stats are visible at `/api/referrals`.

### Notifications

In-app notifications stored in the `notifications` table. Notification types include: guild war updates, nemesis rank changes, leaderboard rank changes, quest completions, friend activity, DM received, gift received, streak milestones, and season events. Telegram bot notifications are sent for high-priority events if the user has linked their Telegram account (`telegram_id` on users table).

**Deduplication:** The `notifications` table has a `reference_id TEXT` column and a partial unique index on `(user_id, type, reference_id) WHERE reference_id IS NOT NULL`. Any batch notification INSERT (e.g. Flash XP announcements) uses `ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` so re-running the same event never creates duplicate notifications.

### Floating Reward Notifications

#### Overview
Every time a user earns a positive currency reward, a floating badge animation provides immediate visual feedback. The badge slides up from the bottom of the screen and fades out, creating a satisfying sense of progression.

#### Supported Events
| Event | Notification | Confetti |
|-------|-------------|----------|
| XP earned | +N XP (green) | If amount ≥ xpThreshold |
| Credits earned | +N Credits (amber) | If amount ≥ creditsThreshold |
| Stars earned | +N Stars (violet) | If amount ≥ starsThreshold |
| New referral joins | +1 Referral (blue) | No |
| Daily quest deck complete | "Daily Quests Complete! 🎉" + rewards | Always |

#### Architecture

**Web/PWA:**
- `FloatingNotificationProvider` wraps the app tree (inside `I18nProvider` in root layout)
- Public API `GET /api/config/rewards-ui` returns manifest floatingNotifications config
- Canvas-based confetti (no external library)
- Realtime channel `user:<userId>` receives `reward_earned` events from server for referral notifications

**Expo (iOS/Android):**
- `FloatingNotificationProvider` wraps the app inside `AuthProvider`
- Uses React Native `Animated` API for both notification pills and confetti particles

#### Using the Hook
```typescript
import { useFloatingNotification } from "@/hooks/useFloatingNotification";

function MyComponent() {
  const { fireXP, fireCredits, fireStars, fireReferral, fireDeckComplete } = useFloatingNotification();
  
  // After a quest rewards the user:
  fireXP(500);
  fireCredits(100);
  
  // After deck completion:
  fireDeckComplete(500, 100, "Credits");
  
  // After referral joins (auto-fired via realtime):
  fireReferral();
}
```

#### Manifest Configuration
The `floatingNotifications` section of `ZobiaManifest` controls all settings:
```typescript
floatingNotifications: {
  enabled: boolean;          // master toggle (default: true)
  xpThreshold: number;       // XP amount for confetti (default: 100)
  creditsThreshold: number;  // Credits amount for confetti (default: 50)
  starsThreshold: number;    // Stars amount for confetti (default: 10)
}
```

Admin can configure via **Admin Panel → Config → Floating Notifications**, and preview via **Admin Panel → Notifications Demo**.

### Deep Links

All deep-linkable routes are defined in `lib/deeplinks/routes.ts` — the single source of truth. Universal links via Android App Links use `/.well-known/assetlinks.json`. Referral links use `?r=<referralCode>`. Notification taps carry a route payload that maps to the correct screen via the deep link router.

---

## Admin Features

The admin panel is available at `/admin` and is protected by `is_admin = true` in the database (not just the JWT — every admin route calls `withAdminAuth` which re-checks the database).

### Dashboard Overview (`/api/admin/overview`)
Daily/weekly/monthly active users, new registrations, revenue totals (today / week / month), active rooms, active guilds, and moderation queue depth.

### Financial Monitoring (`/api/admin/financial`)
Transaction volume, creator payout pipeline status, pending payouts awaiting approval, payment provider health, credit/star ledger summaries.

### User Management (`/api/admin/users`)
Search, view, suspend, ban, or restore any user. View user's XP history, credit ledger, quest history, guild membership, and reports filed against them.

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

### Feature Flags (`/api/admin/feature-flags`)
Feature flags are stored as boolean values in the `x_manifest` table (key `feature_*` convention) and augmented with metadata in the `feature_flags` table (keys match `x_manifest`). The dedicated endpoint `GET/PUT /api/admin/feature-flags` returns enriched flag objects:

```json
{
  "key": "feature_guild_wars",
  "enabled": true,
  "description": "Enable Guild Wars feature",
  "availableFrom": null,
  "earlyAccessPlans": null
}
```

`availableFrom` and `earlyAccessPlans` can be set via `PUT /api/admin/feature-flags` to schedule flags for a future date or gate them to specific subscription plans. All changes are logged to `admin_audit_log`.

### Configuration (`/api/admin/config`)
All other `x_manifest` keys are editable from the admin panel. Changes take effect within seconds via Redis cache invalidation. Feature flags include: rooms enabled, DMs enabled, live streaming, AI assistant, marketplace, gifts, rankings.

### Configuration (x_manifest)
Admin-editable app-level settings: payment provider selection, max file upload size, rate limit thresholds, payout minimum thresholds, moderation settings.

### Admin Messaging (`/api/admin/messages`)
Send broadcast messages to all users or to a filtered segment (by city, plan, or trust score range).

### Announcement Modals and Banners
`announcement_modals` — full-screen overlays shown once per user. `announcement_banners` — dismissable top-of-screen banners. Both support scheduling (active_from / active_until).

**View confirmation flow:** The engine (`lib/announcements/engine.ts`) resolves which modal or banner to show a user but does **not** record the view immediately. The client must call `POST /api/announcements/confirm-view` after the announcement is actually rendered and visible to the user. This prevents marking an announcement as "seen" when the client crashes or navigates away before the content is displayed. The engine exports `confirmAnnouncementView(userId, announcementId, type, db)` for use by that endpoint.

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
   - Active booster (per-user temporary multiplier from `user_xp_boosters.multiplier`, stored as integer basis points — 200 = 2.0×, 150 = 1.5×)
3. All multipliers are whole-number basis points (100bp = 1.0×). Integer division is used throughout — no floating-point values enter or exit the engine. **`user_xp_boosters.multiplier` uses the same basis-point scale** — the column type is `INTEGER` (not `DECIMAL`), so 200 means 2.0× and 150 means 1.5×.
4. Minimum award when base > 0 is 1 XP.
5. The result is written to `xp_ledger` and added to `users.xp_total` and the relevant track column.

#### XP Table Authority (ZB-27)

Two tables record XP; they must be kept in sync at all times:

| Column / Table | Role | Read / Write |
|---|---|---|
| `xp_ledger` | Append-only audit trail — one row per XP event | Write-only during mutations; never update/delete rows |
| `users.xp_total` | Denormalised sum of all XP — used for leaderboards, trust scores, and rank badges | Always read from here; update atomically alongside every `xp_ledger` insert |
| `users.xp_<track>` (e.g. `xp_social`, `xp_creator`) | Denormalised per-track totals | Update in the same atomic write as `xp_total` and `xp_ledger` |

**Invariant:** every XP mutation MUST write an `xp_ledger` row AND update `users.xp_total` (plus the track column) inside the same database transaction. Updating `users.xp_total` without a matching `xp_ledger` row, or vice-versa, breaks the audit trail.

**Idempotency:** XP writes use a CTE pattern to prevent double-awards. The `xp_ledger` table has a partial unique index on `(user_id, source, reference_id) WHERE reference_id IS NOT NULL`. Callers supply a stable `reference_id` (e.g. `gift:<id>:sender`) and use `INSERT ... ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING RETURNING id`. The `users.xp_total` update is chained as `WHERE EXISTS (SELECT 1 FROM ins)` so it only fires if the ledger row was actually inserted — retrying the same event is safe.

**Never** sum `xp_ledger.amount` to compute a user's XP — read `users.xp_total` instead. Summing the ledger is expensive (full table scan) and will diverge if any direct `users.xp_total` update is missed.

### Daily Quest & New Member Quest Engine

Location: `lib/quests/questEngine.ts` (daily quest deck) and `lib/quests/newMemberQuestEngine.ts` (New Member Quest steps).

**Daily quest deck (PRD §7):**
1. `GET /api/quests/daily` calls `generateDailyDeck(userId, plan, db)`, which persists the user's plan-sized deck (3/4/5/6 quests for free/plus/pro/max) into `user_quest_decks` for the day (CSPRNG shuffle, Redis lock to avoid duplicate decks from concurrent tab opens). **This persistence step is load-bearing** — action routes advance progress via `triggerActivityQuestProgress(userId, actionType, db)`, which only matches quests present in `user_quest_decks` for today. A previous version of `GET /api/quests/daily` queried `quest_templates` directly without writing to `user_quest_decks`, so every progress-tracking call silently no-opped with a "not in user's deck" error — daily quests always showed 0/x. Any future quest-listing endpoint must go through `generateDailyDeck`, not a parallel query.
2. `triggerActivityQuestProgress(userId, actionType, db, increment?)` is called fire-and-forget from action routes whenever a quest-relevant action happens. `actionType` **must match** `quest_templates.action_type` exactly — the canonical values seeded in `0001_consolidated_schema.sql` are `messages`, `room_join`, `gift`, `login_streak`, `guild_quest`, `xp_meta`. Wired call sites: room/DM/group message send (`messages`), room join (`room_join`), gift send — both `/api/economy/gifts/send` and the DM gift path (`gift`), guild quest contribution (`guild_quest`), daily login claim (`login_streak`), and generically inside `safeAwardXP` for the `xp_meta` "earn N XP today" meta-quest (increment = XP amount awarded; skipped when no ambient DB transaction is in flight, and excluded for `quest_complete`/`deck_completion`/`deck_bonus`/`mentorship_bonus` sources to avoid a quest's own payout re-triggering itself).
3. `updateQuestProgress` also awards a **10% Elder mentorship bonus** to the user's active `elder_mentorships` mentor on quest completion (PRD §7) — this now lives in the shared engine (previously only implemented in an endpoint no client ever called, so mentorship bonuses were never actually paid out).
4. `POST /api/quests/daily/[questId]/progress` (available for direct client-driven progress claims) delegates to `updateQuestProgress` / `checkDeckCompletion` rather than maintaining a second, divergent implementation.
5. `resetDailyQuests` (CRON, daily) expires stale `user_quest_progress` rows and prunes old rows/decks — the only quest step that is CRON-driven; everything else is real-time.

**New Member Quest (PRD §4):** a 6-step onboarding mission (`send_message`, `join_room`, `gift_someone`, `add_friend`, `friend_request` [send 3], `daily_login`) created by `POST /api/onboarding/complete`. Steps are advanced via `advanceNewMemberQuestStep(db, userId, stepId)` / `advanceNewMemberQuestFriendRequestStep(db, userId)`, called from the same action routes that drive daily quests (message send, room join, gift send, friend accept, friend request, daily login). Previously these steps were only ever written by an internal `/api/xp/award` endpoint that nothing in the app actually called over HTTP, so steps never got marked complete on the Home page banner regardless of what the user did.

### Coin Ledger

`coin_ledger` is **append-only** — rows are never updated or deleted. This preserves a complete audit trail of every coin credit and debit.

Race condition prevention: every debit uses `SELECT ... FOR UPDATE` on the `users` row to lock it before reading `coin_balance`. This prevents two concurrent requests from reading the same balance and both believing there are sufficient funds.

Floating-point precision: all coin values are stored as `BIGINT` (smallest unit, like kobo/cents). The application layer uses `Decimal.js` for any arithmetic before writing to the database. This prevents the floating-point drift that would occur with JavaScript `number` arithmetic on large values.

Atomicity: every debit operation pairs the `UPDATE users SET coin_balance = ...` with an `INSERT INTO coin_ledger ...` inside a single database transaction. If either fails, both roll back.

**Idempotency:** `coin_ledger` has a partial unique index on `(user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL`. Callers supply a `reference_id` that is unique per logical event *and* per user (e.g. `quest:<questId>:<userId>:<date>`, `cosmetic_purchase:<itemId>:<userId>`, or a fresh `randomUUID()` for one-shot purchases) — never a bare entity ID shared across users, since that would collide and silently drop every user's credit/debit after the first. `creditCoins`/`debitCoins` check for an existing ledger row for that key before locking the balance (so a retried debit never fails `INSUFFICIENT_BALANCE` against a balance that has already moved), then insert with `ON CONFLICT ... DO NOTHING RETURNING *` and only apply the balance update if the insert actually happened. Retrying the exact same event (e.g. a re-delivered payment webhook) is always safe.

### Star Ledger

`star_ledger` mirrors `coin_ledger` exactly: append-only, `BIGINT` amounts, a `SELECT ... FOR UPDATE` lock on `users` before reading `star_balance`, and the same partial unique index on `(user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` for idempotent retries via `creditStars`/`debitStars`. Star gifts (`POST /api/economy/stars/gift`) use a single `randomUUID()` shared between the sender's debit and the recipient's credit (with different `transaction_type` values: `gift_sent` / `gift_received`) so the same sender can gift the same recipient any number of times — a bare recipient/sender ID as the reference would only allow one gift ever, since every subsequent gift would collide on the dedup index.

### Payout Pipeline

**Account Setup:**
- *Nigeria:* Creator adds a bank account via a two-step Paystack verify-and-confirm flow. `GET /bank/resolve` returns the account name from Paystack; the creator confirms and `POST /api/creator/bank-account` (with `confirmed: true`) calls `createTransferRecipient` to generate a `recipient_code`, which is stored encrypted in `creator_bank_accounts`. The account number is separately encrypted with AES-256-GCM via `encryptField`. **Security gate:** editing or deleting an existing account requires PIN/TOTP/password verification. When TOTP is used, the same atomic Redis `SET NX` replay guard applies (key: `totp:used:<userId>:<code>`, TTL: 90 s) to prevent code reuse within the same time window.
- *Global:* Creator provides a Tron (TRC20) wallet address, which is validated (34 chars, starts with 'T') and stored encrypted in `creator_wallet_addresses`.

**Payout Request (`POST /api/creator/payouts`):**
1. Creator selects a method: `bank_transfer` (Nigeria only), `coins`, or `crypto`.
2. The manifest is checked to confirm the method is enabled for the creator's region (`users.country`).
3. For `bank_transfer`: the current `creator_bank_accounts` row is loaded and a snapshot `{ bank_name, account_name, last4, recipient_code }` is stored as JSONB in the payout record. Subsequent bank account changes do not affect this payout.
4. For `crypto`: the wallet address is loaded and stored (encrypted) as `wallet_address_snapshot`.
5. Three fraud checks run in parallel: new-account gift inflow, payout velocity (>3 requests in 24h), and trust score gate (<30). Any flag forces `awaiting_approval` status and creates a `system_alerts` record.
6. For `coins`: immediate `creditCoins()` call inside a transaction; status set to `completed`.
7. For `bank_transfer` in auto-approve mode: status set to `pending` (CRON picks it up). In manual mode: `awaiting_approval`.
8. For `crypto`: always `awaiting_approval` (manual admin processing).
9. The balance check (`SELECT FOR UPDATE`), pending-payout guard, balance deduction, and `creator_payouts` INSERT all occur inside a single `db.transaction()`. The `FOR UPDATE` row lock is held through COMMIT, preventing concurrent requests from overdrafting the balance or bypassing the one-pending-payout-at-a-time rule.

**CRON Batch Processing (`POST /api/cron/payouts`, every 30 min):**
- Phase 1: SELECT up to `payout_batch_size` records with `status = 'pending'` AND `payout_method = 'bank_transfer'`, ordered by `created_at ASC`.
- For each: call `paystack.initiateTransfer(netKobo, recipientCode, reference)` using the snapshot's `recipient_code`.
- On success: `status → 'processing'`, store `transfer_code` as `provider_reference`.
- On failure: increment `retry_count`, set `next_retry_at` using exponential backoff (5 min → 15 min → 45 min).
- Phase 2: SELECT records with `status = 'failed'` AND `next_retry_at <= NOW()` AND `retry_count < max_retries`; re-attempt transfer.
- After `payout_max_retries` (default 3) failures: move to `payout_dead_letter_queue`, restore `net_kobo` (falling back to `gross_kobo`) to creator's `available_earnings_kobo`, notify creator and create admin `system_alert`.

**Paystack Webhook (`POST /api/economy/webhooks/paystack`):**
- Validates `Content-Type: application/json` before reading the body — returns HTTP 415 if the header is absent or wrong (prevents parser-confusion attacks).
- Validates HMAC-SHA512 signature (`x-paystack-signature`) before any processing — invalid signatures return 200 with `{ received: false }` so Paystack does not retry.
- `transfer.success` → payout status `completed`, creator notified.
- `transfer.failed` → retry logic or DLQ (same as CRON failure path).
- `transfer.reversed` → payout status `reversed`, `net_kobo` (falling back to `gross_kobo`) restored to creator's `available_earnings_kobo`, creator notified.

**Manual Mode (Nigeria) / Global crypto:**
Admin reviews payouts in the admin panel. For bank transfers: Approve → status `pending` (CRON processes). Admin can also manually advance status: `processing → completed/failed`. For crypto: Approve → admin sees the decrypted wallet address snapshot and manually sends USDT; then marks `completed` via the status PATCH endpoint.

**Appeal Pipeline:**
Creator can submit `POST /api/creator/payouts/:id/appeal` with a written reason for rejected payouts. Admin reviews in `/admin/payouts/appeals`. Approving re-opens the payout; dismissing closes the appeal. Both notify the creator.

**The 80/20 split** (80% to creator, 20% platform) is applied at the `creator_earnings` record level. Zobia Icon tier creators and those with the Creator Track L50 unlock receive an 85% split.

### Virtual Economy — Premium Send (PRD §11)

Premium Send is a purchasable booster that adds a gold-shimmer animation to a message. Two tiers:
- **One-shot** (`premium_send`): 50 Credits. Activates for the next message. Multiple one-shots can be queued (they stack; the next send consumes one activation from `user_xp_boosters`).
- **7-Day Pass** (`premium_send_7day`): 250 Credits. All messages for 7 days carry the premium animation. Cannot be stacked.

Both are purchasable via `POST /api/economy/boosters` with `boosterType: "premium_send"` or `"premium_send_7day"`. The message send handler checks for an active `premium_send` or `premium_send_7day` booster before attaching the animation metadata.

### Generosity Track L40 Coin Purchase Bonus (PRD §7)

When a user who has reached the Generosity Track L40 Philanthropist milestone purchases credits (via Paystack or DodoPayments), `getCoinPurchaseBonus()` is called and a 5% bonus credit amount is credited in the same transaction. The bonus is recorded as a separate ledger entry with `type = 'philanthropist_bonus'` for auditability.

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

Deletion is batched by joining the `messages` table against the sender's **current** subscription plan (`users.plan`). A user who upgrades to Plus retains messages that would otherwise fall outside the free window; a user who downgrades has the stricter free window applied on the next nightly run. Messages with a non-null `retain_until` timestamp are never pruned before that date. Results (`freeDeleted`, `plusDeleted`) are included in the CRON response JSON for monitoring.

### Offline Sync

**Web (Service Worker + IndexedDB) — offline-first**
- A Service Worker caches the app shell (HTML, CSS, JS) for instant load.
- **The app opens offline.** Previously-visited routes are served from the runtime
  navigation cache, and the PWA entry point (`/pwa-start`) is `NetworkFirst` with a
  cached fallback — so launching the installed PWA with no connection opens the app
  (on its last route) instead of dead-ending. `offline.html` remains the last-resort
  fallback only for routes that were never visited online.
- **Offline banner:** a small, grey, **closeable** banner pins to the top of the
  screen while offline (`components/offline/OfflineBanner.tsx`) and is replaced by a
  brief "back online" flash on reconnect. The app stays fully interactive behind it.
- **Stale-while-usable data:** the TanStack Query cache is persisted to `localStorage`
  (`lib/offline/queryPersist.ts`) — success responses only, auth-sensitive keys
  (`me`/`wallet`/`session`/`balance`/`coins`) excluded, 24h max age — so the last-seen
  data renders immediately on (re)open and React Query revalidates it once the network
  returns. Chat surfaces additionally hydrate recent messages from `localStorage`
  (`lib/chat/messageCache.ts`).
- Recent messages, the user's profile, and the active quest deck are stored in IndexedDB.
- Outgoing messages composed while offline are saved to IndexedDB with status `pending_sync`.
- On reconnect (`online` event), the `useOfflineSync` hook flushes the IndexedDB queue to the server API. The hook uses a single `isRunning` mutex that covers both the `resetSendingMessages` call and the subsequent `flushQueue` — preventing concurrent reset+flush cycles if the `online` event and mount `useEffect` fire simultaneously.

**Android (MMKV + Expo SQLite)**
- MMKV provides ultra-fast synchronous key-value storage for session tokens, user preferences, and feature flags.
- Expo SQLite stores structured offline data: recent message threads, the quest deck, and cached profile data.
- **Offline queue encryption:** message content is encrypted at rest with AES-256-GCM before being written to SQLite (`lib/offline/sqlite.ts`). A 256-bit key is generated once per device using `crypto.getRandomValues` and stored in expo-secure-store with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (Android Keystore / iOS Secure Enclave). Stored rows use the format `v1:<base64url(iv)>.<base64url(ciphertext)>`; rows without the `v1:` prefix are treated as legacy plaintext for backward-compat migration. Encryption uses `@noble/ciphers/aes` (`gcm()`) — a pure-JavaScript implementation that works on Hermes without `crypto.subtle` (which is absent in the React Native JS engine).
- Same sync-on-reconnect pattern: NetInfo `addEventListener` fires the sync when connectivity is restored.
- The same small, grey, **closeable** offline banner appears at the top of each screen (`components/offline/OfflineBanner.tsx`, mounted via the shared `Screen` wrapper) and is i18n-driven (`common.offline`).
- Offline messages have a 72-hour TTL in SQLite. Messages older than 72 hours that never synced are dropped with a "message not sent" notice displayed to the user.

**Duplicate-send protection:** every queued message (web IndexedDB outbox or Expo SQLite queue) carries a client-generated `idempotencyKey`. The room, group, and DM send endpoints all check `(sender_id, idempotency_key)` before inserting and return the existing message with `200` on a match instead of creating a duplicate. This matters because the sync queue retries on every app open and every `online` event — without server-side dedup, a flaky reconnect (request succeeds server-side but the success response is lost) would resend the same message and create visible duplicates once connectivity stabilizes.

### JWT + Redis Session System

1. **Login** → backend issues two tokens:
   - **Access token** (JWT, 15-minute TTL) signed with `JWT_SECRET`. Stored in HttpOnly cookie (web) or Expo SecureStore (Android).
   - **Refresh token** (JWT, 30-day TTL) signed with `JWT_REFRESH_SECRET`. Stored in Redis under key `session:<refreshToken>` with a 30-day expiry. (The `sessions` DB table was dropped during schema cleanup; all session state lives in Redis.)

**Key rotation for refresh tokens:** Both access tokens and refresh tokens embed a `kid` (key ID) in their JWT header. During a key rotation, verification looks up the matching secret from a registry keyed by `kid` (built from `JWT_REFRESH_SECRET` and any `JWT_REFRESH_SECRET_v{N}` env vars). This allows old refresh tokens to remain valid through the rotation grace period without requiring forced logouts. See `SETUP.md` → Environment Variables Reference for rotation procedure.
2. **API call with valid access token** → validates JWT → proceeds.
3. **API call with expired access token + valid refresh token** → backend validates refresh token against Redis key → issues new access token → delivers both via `Set-Cookie` (HttpOnly, Secure, SameSite=Strict). Tokens are never exposed in response headers.
4. **Logout** → deletes the Redis `session:*` key → immediate invalidation. The old access token will still parse as valid until its 15-minute TTL expires, but the refresh token can no longer be used to extend sessions.
5. **Ban or suspension** → admin action deletes all `session:*` keys for the user → all devices logged out immediately, without waiting for JWT expiry.
6. **Admin sessions** → separate shorter-lived JWT (5-minute TTL), re-verified against `is_admin` in the database on every admin route call.

**Session limit:** Users are limited to **10 concurrent sessions** (`MAX_SESSIONS=10`). When a new login would exceed this limit, the oldest session(s) by creation time are evicted: their `session:{sid}` Redis keys are deleted first, then removed from the `user_sessions:{uid}` sorted set. This order prevents a race where an evicted session could briefly appear valid.

**Session-expired notice for open pages:** When a long-lived page (most commonly an open chat room) outlives its session, its background polls and the next user action receive a `401`. A client `authFetch` wrapper (`lib/api/authFetch.ts`) and the axios interceptor first attempt one silent refresh; if that fails the session is truly gone, and they raise an app-wide event (`lib/auth/sessionExpiredBus.ts`) that mounts a blocking "you've been signed out — sign in again" modal (`components/auth/SessionExpiredModal.tsx`, mounted in `app/layout.tsx` — the **root** layout, not just `app/(app)/layout.tsx`, so it also covers standalone routes outside the authenticated app shell such as `/g/<slug>/play` and `/g/<slug>/embed`). The Expo app surfaces the same notice via `components/auth/SessionExpiredModal.tsx` driven by the auth context's `sessionExpired` flag. This closes the gap where a room left open after auto-logout used to keep showing stale content with silently-failing polls.

**Pitfall — local `fetch` shadows:** `components/games/GameRunner.tsx` previously defined its own local `authFetch` helper (a plain `fetch` with `credentials: "include"`) instead of importing the shared one, so a session expiring mid-game (failing to start a game or submit a score) surfaced only a generic inline error — the session-expired modal never fired. Any new authenticated client component must call the shared `authFetch`/`apiClient`, never hand-roll a same-named local wrapper; a local function named `authFetch` that isn't the shared import is a code-review red flag.

**Scroll-to-error:** A related, separate UX bug — a failed form submit or button click sometimes rendered its error message off-screen (above or below the fold) with no indication anything happened. `lib/hooks/useScrollToError.ts` is a small reusable hook (`const ref = useScrollToError(error)` → attach `ref` to the error container) that scrolls the element into view the moment the error transitions from falsy to truthy. It's wired into the shared `<Input>` component (per-field errors) and a new shared `<ErrorAlert>` component (`components/ui/ErrorAlert.tsx`, for page/form-level banners), and applied to the Home page, login page, and register page banners. New forms should use `<ErrorAlert error={...} />` or the hook directly rather than a bare `{error && <div>...}` block.

**Expo mobile auth hardening:** On an irrecoverable 401, the Expo auth context clears all three SecureStore keys (`zobia_jwt`, `zobia_rt`, `zobia_user`) before transitioning to the signed-out state, so stale credentials cannot cause a re-authentication loop on the next app restart. After a successful silent token refresh, the Axios interceptor fetches `/api/users/me` and fires an `onUserUpdated` event; the auth context subscribes to this event and updates the in-memory user object with fresh XP, rank, and city — fields that are not embedded in the JWT payload and would otherwise go stale until re-login.

### Redis Cost Controls

The platform runs comfortably on a **free Redis tier + Vercel Hobby**. Because every authenticated request is a serverless invocation that previously made several Redis reads, two layers keep both command volume and invocation count low without degrading perceived latency:

1. **Per-instance L1 cache in front of Redis** (`lib/cache/memory.ts`):
   - **Session validation** — `getSession()` runs on *every* authenticated request. Its `session:{sid}` lookup is cached in-process for **3s** (`SESSION_CACHE_TTL_MS` in `lib/auth/session.ts`), and the entry is evicted immediately on this instance whenever the session is rotated (refresh) or revoked (logout/ban/eviction). Cross-instance revocation is bounded by the 3s TTL; account-status (ban) enforcement is independent and unaffected.
   - **Account status** — the banned/suspended/deleted check in `withAuth` (`lib/api/middleware.ts`) now uses L1 (15s) → Redis (30s) → DB. Sensitive mutations (payments, payouts, gifts, transfers) always bypass L1 and confirm against Redis/DB.
   - Net effect: a warm instance serving a steady chat poll makes **~0 Redis reads** for auth instead of ~3–4 per request.

2. **Activity-based chat-poll backoff** (`lib/hooks/useAdaptiveChatPoll.ts`): when no realtime provider is connected the baseline poll starts fast (3s) but **backs off geometrically up to 15s while the conversation is idle**, snapping back to 3s the instant new messages arrive or the user sends. A backgrounded tab stops polling entirely. An idle 1:1 chat therefore costs ~4 polls/minute instead of ~20.

Existing in-process caches (rate-limit L1, manifest 15s, room top-gifters 10s) and the geo-anomaly check (Redis only when the request IP actually changes) remain in place. Presence heartbeats stay at 45s and continue to free room slots automatically via short Redis TTLs.

### Health Check Endpoint

`GET /api/health` — used by load balancers and uptime monitors.

**Response shape:**
```json
{
  "status": "ok" | "degraded",
  "db": "ok" | "error",
  "redis": "ok" | "error",
  "circuit": "closed" | "open" | "half-open",
  "timestamp": "ISO8601"
}
```

Returns HTTP 200 when all systems are reachable. Returns HTTP 503 when one or more services are unreachable (status will be `"degraded"`). Load balancers should poll this endpoint and remove the instance from rotation when a 503 is received.

### Graceful Shutdown

`apps/web/instrumentation.ts` registers handlers for `SIGTERM` and `SIGINT`. On receipt of either signal the process:
1. Stops accepting new requests.
2. Waits for in-flight requests to complete (up to a configurable drain timeout).
3. Closes the database connection pool and Redis client.
4. Exits with code 0.

This ensures zero dropped requests during rolling deploys on Vercel and other container-based platforms.

**CRON SIGTERM handling:** The daily CRON handler (`/api/cron/daily`) additionally registers a module-level `process.once('SIGTERM', ...)` handler that sets a `_shuttingDown` flag and schedules `process.exit(0)` after a 10-second drain window. The GET handler checks this flag at its entry point and returns immediately with `{ success: false, reason: 'SHUTTING_DOWN' }` if a shutdown is already in progress, preventing any new CRON work from starting mid-deploy.

### Database Provider Abstraction

`DATABASE_PROVIDER` env var → `lib/db/index.ts` reads it and returns the correct `DatabaseAdapter` singleton. All queries in business logic call `db.query()` or `db.transaction()` — never a provider-specific SDK.

An ESLint rule flags any direct import of `@supabase/supabase-js` or provider-specific modules from business logic files. Only the adapter file in `lib/db/providers/` may import provider SDKs.

Switching providers requires only changing `DATABASE_PROVIDER` and redeploying. Data migration (pg_dump/restore) is a separate, manual step.

**`db.query<T>` type parameter:** The generic `T` on `DatabaseAdapter.query<T>` (defined in `lib/db/interface.ts`) defaults to `Record<string, unknown>`. Provider implementations use `T & Record<string, unknown>` internally when calling the underlying `pg` driver (which requires `T extends QueryResultRow`), then cast the result back to `T[]`. This means call sites can pass any interface as the type parameter — they are not required to extend `Record<string, unknown>` themselves.

```typescript
// Correct — interface does not need to extend Record<string, unknown>
interface UserRow { id: string; username: string; }
const { rows } = await db.query<UserRow>('SELECT id, username FROM users WHERE id = $1', [userId]);
```

### Shared Type Package (`@zobia/types`)

Cross-cutting domain types (plans, ranks, XP actions, ledger entries, etc.) live in `shared/types/index.ts` and are imported via the `@zobia/types` alias, which is configured in `apps/web/tsconfig.json`:

```json
"@zobia/types": ["../../shared/types/index.ts"]
```

Add new domain-wide types to `shared/types/index.ts`, not to individual feature files. If a type is only used within one feature (e.g. a specific API route's response shape), keep it local.

**`CoinTransactionType`** — the full union of valid coin ledger transaction types is maintained in `shared/types/index.ts`. When adding a new coin operation, add its type string to this union; the TypeScript compiler will catch any call sites that pass a string not in the union.

### Shared API Contract Schemas (`@zobia/shared/schemas`)

Runtime-validated Zod schemas for all API request/response shapes are maintained in `shared/schemas/` and exported from `shared/schemas/index.ts`. These schemas serve as the **single source of truth** for API contracts across the web (Next.js) app and the Expo mobile app.

| Schema file | Exports |
|---|---|
| `shared/schemas/api/auth.ts` | `LoginRequestSchema`, `RegisterRequestSchema`, `AuthUserSchema`, `AuthResponseSchema`, `RefreshResponseSchema`, `PinVerifyRequestSchema`, `PinSetupRequestSchema` |
| `shared/schemas/api/coins.ts` | `CoinTransferRequestSchema`, `CoinTransferResponseSchema`, `CoinBalanceResponseSchema`, `CoinPurchaseRequestSchema`, `CoinPurchaseResponseSchema`, `CoinLedgerEntrySchema` |
| `shared/schemas/api/user.ts` | `UserProfileSchema`, `MeResponseSchema`, `UpdateProfileRequestSchema`, `PushTokenRequestSchema`, `UserSearchResponseSchema` |
| `shared/schemas/api/notifications.ts` | `NotificationSchema`, `NotificationsListResponseSchema`, `MarkNotificationsReadRequestSchema` |
| `shared/schemas/api/economy.ts` | `StarGiftRequestSchema`, `StarBalanceResponseSchema`, `SendGiftRequestSchema`, `SendGiftResponseSchema`, `BoosterActivateRequestSchema`, `IAPVerifyRequestSchema`, `IAPVerifyResponseSchema` |

**Usage:**
```typescript
// In web route handler or Expo screen:
import { CoinTransferRequestSchema } from '@zobia/shared/schemas';

const parsed = CoinTransferRequestSchema.safeParse(body);
if (!parsed.success) return error(400, parsed.error);
```

Add new API contracts to the appropriate domain schema file. Do not duplicate schema definitions inline in individual route files — always import from `@zobia/shared/schemas`.

### Rate Limiting

Rate limit options are specified with `lib/security/rateLimit.ts`'s `RateLimitOptions` interface:

```typescript
interface RateLimitOptions {
  limit: number;       // max requests allowed in the window
  windowMs: number;    // window duration in milliseconds
  name: string;        // identifier used in Redis key prefix and error messages
  bypassL1?: boolean;  // when true, skips the in-process L1 cache fast-path; use for sensitive endpoints (auth, payments) where a stale L1 hit could mask a genuine attack
}
```

Pre-built presets are exported as `RATE_LIMITS` (e.g. `RATE_LIMITS.auth`, `RATE_LIMITS.apiWrite`). For custom limits, construct `RateLimitOptions` directly — use `limit` (not `max`) and `windowMs` (not `windowSeconds`).

### Presence Keys

The Redis key used for user presence (`presence:online:<userId>`) is defined in `lib/presence/keys.ts` and imported from there by both `app/api/presence/route.ts` and `app/api/presence/[userId]/route.ts`.

> **Note:** Next.js route files may only export HTTP method handlers and a small set of route-config constants (`dynamic`, `revalidate`, etc.). Any shared helper used by multiple route files must live in `lib/`, not in a route file, even if logically related.

### `useSearchParams` and Suspense

Pages that call `useSearchParams()` must be wrapped in a `<Suspense>` boundary; otherwise Next.js cannot statically generate the page and the build fails. The pattern used in this project:

```tsx
// Split into an inner component that uses the hook…
function PageContent() {
  const searchParams = useSearchParams();
  // …
}

// …and an outer default export that wraps it in Suspense
export default function Page() {
  return (
    <Suspense>
      <PageContent />
    </Suspense>
  );
}
```

This applies to any `"use client"` page that reads search params. Examples in this codebase: `app/auth/login/page.tsx`, `app/(app)/wallet/page.tsx`.

### Auth System

**No Supabase Auth anywhere.** All auth is platform-managed.

- **Google OAuth**: Frontend redirects to Google → Google calls `/api/auth/google/callback?code=...` → backend exchanges code for Google tokens → backend verifies Google ID token → creates or retrieves Zobia user by `google_id`.
  - **If the user has 2FA enabled**: instead of issuing a full JWT pair, the backend issues a short-lived `pre_auth` JWT (type `pre_auth`, 5-minute TTL). The edge middleware (`middleware.ts`) enforces that `pre_auth` tokens can only reach `/api/auth/2fa/verify`; all other API routes return `401 PRE_AUTH_TOKEN` and all app routes redirect to `/auth/2fa`. After the user submits a valid TOTP code via `POST /api/auth/2fa/verify`, the backend verifies the code, performs an atomic Redis `SET NX` replay check (key: `totp:used:<userId>:<code>`, TTL: 90 s), and only then issues the full JWT pair. The opaque code is never placed in the URL query string.
  - **If 2FA is not enabled**: the backend issues the Zobia JWT pair directly.
- **Telegram Login**: Telegram Login Widget posts data to `/api/auth/telegram` → backend performs HMAC-SHA256 verification using the bot token as key → creates or retrieves user by `telegram_id` → issues JWT pair.
- **JWT validation**: `lib/auth/jwt.ts` using the `jose` library. No third-party auth SDK.
- **CSRF protection (mobile):** The Next.js middleware enforces an `Origin` header check on all mutating requests. The Expo Axios client sends `Origin: <API_BASE_URL>` on every request (including the token refresh call), so mobile clients pass the CSRF check without requiring a server-side exemption.

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
   - Determines the winner by strict comparison (`score1 > score2`). Equal scores result in a **draw**.
   - **Win path**: calls `distributeWarRewards()` to distribute XP + credits to winning guild members by contribution rank; awards a Rematch Token to the losing guild captain; increments `guilds.wars_won` / `wars_lost`.
   - **Draw path**: sets `winner_alliance_id = NULL` on the war record; increments `wars_drawn` on both participating guilds and their alliances; awards each member half the win XP (`ALLIANCE_WAR_DRAW_XP`); sends a draw notification.
5. All war calculations use integer arithmetic. No floating-point values.

### Season System

Seasons are 8-week cycles defined in the `seasons` table. The Season Engine (`lib/seasons/seasonEngine.ts`) manages:
- Phase detection based on current week within the season.
- Season Pass reward tier checks (free vs paid).
- End-of-season reward distribution (credits, cosmetics, prestige points for top-ranked users).
- Season transition (closing the old season, opening the new one).

At season end: competitive rankings reset. Track XP, credits, friends, and history are **not** reset.

**Canonical season-pass tables** (two tables only — do not re-introduce the dropped ones):

| Table | Purpose |
|---|---|
| `user_season_passes` | One row per (user, season). Tracks `is_paid`, `season_xp`, `season_rank`, `purchased_at`. All pass ownership and XP mutations go here. |
| `user_season_milestone_claims` | One row per (user, season, milestone). Unique on `(user_id, season_id, milestone_id)` so the same milestone can be reclaimed in a future season. Inserted atomically alongside the reward grant. |

The legacy `season_passes` (never used) and `user_season_pass_claims` (broken unique key — omitted `season_id`) tables were dropped during an early schema cleanup.

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
Both DeepSeek and Gemini have independent circuit breakers persisted in Redis (`ai:circuit:deepseek:*` and `ai:circuit:gemini:*`). After 3 consecutive failures, the respective provider's circuit opens and the request is routed to the other provider. If both circuits are open simultaneously, the call throws an error and the moderation report is held in `pending` status — a `ai_provider_failure` system alert fires. Human moderators can process the backlog manually. Each circuit enters a half-open state after the configurable recovery window and resets on the next successful call. The admin AI Settings page (`/admin/ai-settings`) shows the circuit status and failure count for both providers.

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

**City leaderboard snapshots**
`safeAwardXP` now upserts both a global-scope and a city-scoped `leaderboard_snapshots` row whenever XP is awarded, using the `city` field from the `users` row returned by the UPDATE. City-scoped rows use `scope = 'city'` and carry the `city` value. The Elder badge and city rankings are therefore always up-to-date without a separate CRON step.

**Duplicate daily login claim**
The Redis key `daily_login:<userId>:<YYYY-MM-DD>` prevents double-awards within the same calendar day. The `/api/login/daily` endpoint is idempotent — if the key exists, it returns the current streak without re-awarding XP and includes `alreadyClaimedToday: true` in the response.

---

## Testing

### E2E Tests (Playwright)

Located in `e2e/`. Covers all 11 PRD-required user journeys:
- Authentication (register, login, logout, Google OAuth)
- Direct messages (credit cost, anti-spam, gift-them-credits flow)
- Economy (credit purchase, transfer, gift items)
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

The server sends push notifications via `apps/web/lib/notifications/push.ts` using the Expo Push API. Delivery follows a **two-stage protocol** required by Expo:

#### Stage 1 — Send (immediate)

`POST https://exp.host/--/api/v2/push/send` — up to 100 messages per request. Expo returns a **push ticket** for each message:
- `status: "ok"` with `id` — the message was accepted; the ticket ID is persisted to the `push_tickets` table for stage-2 polling.
- `status: "error"` with `details.error = "DeviceNotRegistered"` — the token is stale; it is immediately purged from `user_push_tokens`.

**Device-ID deduplication:** When a user reinstalls the Expo app, the new install may register a new push token while the old token is still in `user_push_tokens`. To prevent duplicate delivery, the send batch fetches the `device_id` column alongside each token and keeps only one token per (`user_id`, `device_id`) pair — the most recently seen one (ordered by `last_seen_at DESC`). Tokens without a `device_id` are always included. This ensures one notification per physical device even when multiple tokens exist.

#### Stage 2 — Receipt polling (deferred, ≥ 15 minutes later)

`POST https://exp.host/--/api/v2/push/getReceipts` — takes up to 100 ticket IDs and returns delivery receipts. Called from the daily CRON job via `pollPushReceipts()`:
- `status: "ok"` → mark ticket resolved.
- `status: "error"` with `DeviceNotRegistered` → purge user's push tokens and mark ticket resolved.
- Other `status: "error"` → record the error code, mark ticket resolved for monitoring.

Pending tickets are fetched in batches of 100, marked `checked_at = NOW()` before polling to prevent duplicate polls on concurrent CRON runs, and processed until all pending tickets older than 15 minutes are resolved.

#### push_tickets table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Row ID |
| `user_id` | UUID | FK to users |
| `ticket_id` | TEXT | Expo stage-1 ticket ID (UNIQUE) |
| `status` | TEXT | `pending` → `ok` / `error` / `device_not_registered` |
| `error_code` | TEXT | Expo error code if status is `error` |
| `created_at` | TIMESTAMPTZ | When the notification was sent (stage 1) |
| `checked_at` | TIMESTAMPTZ | When stage-2 polling was attempted |
| `resolved_at` | TIMESTAMPTZ | When the ticket reached a terminal state |

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

On first launch (before login), the Expo app:
1. Checks if running on a physical device (`expo-device`).
2. If the permission status is `undetermined`, calls `expo-notifications.requestPermissionsAsync()` immediately after the MMKV store initialises — so the system dialog appears on install, not after login.

After login, the app additionally:
3. Calls `expo-notifications.getExpoPushTokenAsync()` to retrieve the unique device token.
4. Registers the token with `POST /api/users/push-token` (stored in `user_push_tokens` table).

Notification tap handling routes users to the deep-link `action` field attached to each notification payload (e.g. `/guild/wars/[warId]`, `/leaderboards`, `/profile/[userId]`).

---

## Android App

The Android app lives at `apps/android/` and is built with **Capacitor 6** (WebView bridge), **Vite 5** (bundler), **React 18**, **TanStack Router v1** (file-based routing), **TanStack Query v5** (data fetching), and **Tailwind CSS**. It shares the same backend API and authentication system as the web app and the Expo app.

### Architecture

The build pipeline is: Vite bundles the React app into `apps/android/dist/`, Capacitor copies that bundle into `apps/android/android/app/src/main/assets/public/`, and Gradle wraps it in a native Android shell. The result is a standard `.apk` whose only native surface is a full-screen WebView.

Key architectural decisions:

- **Capacitor replaces React Native.** There are no native UI components — the entire UI is the Vite-built React app running in a WebView. This allows sharing Tailwind classes, TanStack Router, and TanStack Query directly with the web codebase without a React Native bridge layer.
- **TanStack Router v1 with file-based routing.** Route files live in `apps/android/src/routes/`. The `TanStackRouterVite` Vite plugin auto-generates `src/routeTree.gen.ts` at build time. Public routes (`/auth/login`, `/auth/register`) bypass `AuthGuard`; all other routes require a valid token.
- **Capacitor Preferences replaces SecureStore/MMKV.** JWT and refresh tokens are stored via `@capacitor/preferences` (backed by Android SharedPreferences with encryption). The API client (`src/lib/api/client.ts`) reads and writes tokens through the same async `get/set/remove` pattern.
- **Capacitor Network and App replace NetInfo and AppState.** `@capacitor/network` powers `useNetworkStatus` for the offline banner and query pause logic. `@capacitor/app` provides `appStateChange` events to pause Ably subscriptions and query polling when the app is backgrounded.
- **i18next-browser-languagedetector replaces expo-localization.** Language detection reads the browser `Accept-Language` header (surfaced by Capacitor's WebView). The chosen language is persisted in `@capacitor/preferences`. All locale JSON files are sourced from `shared/i18n/locales/` — the same canonical files used by the web app.

**Screen coverage.** `apps/android/src/routes/` currently ports: home, quests, games, rooms (list + detail), messages (list + conversation), moments (feed + create), Answers (list, ask, question detail — `answers/`), profile, wallet, stats, settings, notifications, and auth. `wallet.tsx` and `stats.tsx` (added alongside the web Stats page) cover the logged-in user's own wallet/rank/badges and Stats screens — reachable from Settings — using `useInfiniteQuery` + an explicit "Load more" button for transaction history against the same `GET /api/economy/coins/balance` and `GET /api/users/[userId]/stats` endpoints the web app uses. Friends (`/friends`) and the Gifts Hub (`/gifts`) — both covered in this doc for web/PWA — are not yet ported to the Capacitor app; there is no `apps/android/src/routes/friends.tsx` or `gifts.tsx` today. When they are built, they should mirror the web/PWA tab layout and API calls described above (same `/api/friends*` and `/api/economy/gifts*` endpoints, TanStack Query instead of raw `fetch` + `useState`, per the pattern in `src/routes/messages/index.tsx`).

### Routing and Navigation

The root route (`src/routes/__root.tsx`) renders `AppShell`:

1. `AuthGuard` — redirects unauthenticated users to `/auth/login`.
2. `TopBar` — 56px fixed header with page title and optional back button.
3. `OfflineBanner` — fixed red strip below the TopBar, visible only when offline.
4. `<Outlet>` — the active route's content, wrapped with `page-slide-in` CSS animation.
5. `BottomNav` — 5-tab navigation (Home, Games, Messages, Rooms, Profile).

Route-to-title mapping is derived from `location.pathname` inside `AppShell` — no per-route metadata object required.

### Authentication

The Android app supports three login methods, all funnelling into the same `useAuth().setAuth(token, user)` call which persists the JWT to Capacitor Preferences and updates in-memory React state.

**Email / password login** — handled by `src/routes/auth/login.tsx`. `LoginRequestSchema` (Zod) validates before the API call. The response may include a `requires2FA: true` flag (see Two-Factor below).

**Google OAuth** — the login screen opens `GET /api/auth/google?mobile=true` in a Capacitor in-app browser (`@capacitor/browser`). The API redirects the browser to Google, handles the OAuth callback server-side, then issues a deep link back to the app:

```
zobia://auth/callback?token=<jwt>&user=<json>
```

`AppShell` in `__root.tsx` listens for `appUrlOpen` events via `App.addListener`. On receiving `zobia://auth/callback`, it parses the token and user, validates the user shape with `AuthUserSchema`, calls `setAuth`, and navigates to `/home`.

**Telegram Login** — same pattern as Google. Opens `GET /api/auth/telegram?mobile=true`; the API performs HMAC-SHA256 verification of Telegram's Login Widget data, then deep-links back via:

```
zobia://auth/telegram-callback?token=<jwt>&user=<json>
```

`AppShell` handles both `/callback` and `/telegram-callback` under the same `auth` hostname.

**Two-Factor Authentication (2FA)** — when an email/password login returns `{ requires2FA: true, preAuthToken: string }`:

1. The login page stores the `preAuthToken` in a module-level in-memory variable (`src/lib/auth/preAuth.ts`) and navigates to `/auth/two-factor`.
2. The 2FA screen (`src/routes/auth/two-factor.tsx`) presents a numeric 6-digit TOTP input.
3. On submit it calls `POST /api/auth/2fa/verify` with `{ preAuthToken, code }`.
4. On success the API returns the full JWT; the app clears the in-memory token, calls `setAuth`, and navigates to `/home`.
5. If no `preAuthToken` is in memory (e.g. the user navigated here directly), the screen immediately redirects back to `/auth/login`.

`/auth/two-factor` is added to the `PUBLIC_ROUTES` list in `__root.tsx` so `AuthGuard` does not redirect it, and the route is registered in `routeTree.gen.ts` alongside `/auth/login` and `/auth/register`.

### Offline Support

TanStack Query v5 is configured with `experimental_createPersister` from `@tanstack/query-persist-client-core` backed by `idb-keyval` (IndexedDB). All successful query results with `staleTime: 24 * 60 * 60 * 1000` are persisted across app restarts with a 7-day `gcTime`.

When offline:
- The offline banner (`src/components/ui/OfflineBanner.tsx`) appears immediately via `useNetworkStatus`.
- Queries fall back to the IndexedDB-persisted cache automatically — no separate cache-read logic needed.
- TanStack Query's `onlineManager` is wired to `@capacitor/network` events so queries pause and resume with real connectivity changes.

### Realtime

`src/lib/realtime/useRealtimeChannel.ts` is adapted from `apps/expo/lib/realtime/useRealtimeChannel.ts`. Key differences:

- `App.addListener('appStateChange', ...)` replaces React Native's `AppState.addEventListener`.
- The listener handle is stored and cleaned up via `handle.remove()` on unmount.
- All other logic is identical: Ably `authCallback` pattern, `RECOVERABLE_STATES`, `onEventRef` stable-ref pattern, and strict single-subscribe-per-channel discipline.

Adaptive polling (`src/lib/hooks/useAdaptiveChatPoll.ts`) is a verbatim copy of `apps/web/lib/hooks/useAdaptiveChatPoll.ts`. When the Ably socket is connected, the baseline poll runs every 30 seconds. When disconnected, it starts at 3 seconds and backs off geometrically to 15 seconds. When the app is backgrounded, polling pauses entirely.

### APK Build Process

See `docs/SETUP.md` → "Android App" for full instructions. In brief:

1. Push to the `android` branch (or trigger the workflow manually at `.github/workflows/android-build.yml`).
2. The GitHub Actions workflow runs `npm ci` (root workspace), `vite build` (with `VITE_API_BASE_URL` and `VITE_WEB_BASE_URL` secrets), copies the dist bundle into `android/app/src/main/assets/public/`, and runs `./gradlew assembleDebug --no-daemon`.
3. The resulting `app-debug.apk` is uploaded as a workflow artifact (30-day retention).
4. Download the artifact from the GitHub Actions run and sideload it on an Android device.

Required repository secrets: `VITE_API_BASE_URL`, `VITE_WEB_BASE_URL`.

Build targets: `compileSdk 36`, `targetSdk 36`, `minSdk 26` (Android 8.0+). Gradle 8.7, AGP 8.3.2, Java 17.

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

## Answers (Mini Forum / Q&A)

Reddit-style community Q&A (PRD §31). Questions require a minimum account
level to post (`forum_min_level_to_post`, default Level 2); answering has a
separate, lower level gate (`forum_min_level_to_comment`, default Level 1)
that can be bypassed by spending Credits (`forum_comment_bypass_cost_credits`).

### How It Works

1. `lib/forum/service.ts` mirrors `lib/moments/service.ts`'s pipeline: feature
   flag → eligibility (rank + manifest config) → level gate → auto-moderation
   → atomic insert. Rewards (XP via `safeAwardXPFireAndForget`, Credits via
   `creditCoins`) are awarded **after** the write transaction commits, not
   inside it — a reward-award failure never blocks or rolls back the post.
2. Answers self-reference (`parent_answer_id`) for Reddit-style nesting, with
   a denormalized `depth` column capped at 10 server-side. The question page
   eagerly loads only 3 replies per top-level answer; deeper/further replies
   are lazy-loaded via `GET /api/answers/questions/[id]/answers/[answerId]/thread`
   (a small recursive CTE bounded by the depth cap) when the user clicks
   "View N more replies."
3. Voting toggles: voting the same direction again removes the vote; voting
   the other direction flips it. One row per `(target_type, target_id, user_id)`
   in `forum_votes`, enforced by a unique index — no JSONB voter-array hacks.
4. **Redis avoidance:** list/detail queries `LEFT JOIN forum_votes`/
   `forum_favorites` on the caller's ID directly in SQL, exactly like
   `rooms.is_favorited` — zero per-item Redis reads for vote/favorite state,
   consistent with this codebase's Redis-cost discipline (see
   "Redis Cost Controls" above).
5. Moderation reuses `lib/moderation/contentFilter.ts` (duplicate-post
   detection + profanity filter) rather than a parallel system — see
   `lib/forum/moderation.ts`. Reports flow through the existing
   `moderation_reports` table and AI classifier; two nullable columns
   (`reported_forum_question_id`, `reported_forum_answer_id`) were added to
   both `reports` and `moderation_reports`.

### Feature Flag

Controlled by `feature_forum` in x_manifest / `/admin/config` (or
`/admin/forum/settings`, which edits the same rows). Default: enabled. When
disabled, `/api/answers/**` routes return 503.

### Moderator Access Is Scoped

Unlike the rest of `/admin/*` (admin-only), `/admin/forum/*` accepts either
`is_admin` **or** `is_moderator`. This required adding `is_moderator` to the
signed JWT access-token payload (previously only carried in the Redis
session record, not the token itself — see `lib/auth/session.ts`) so the
edge middleware pre-filter (`FORUM_MOD_PREFIXES` in `middleware.ts`) can
check it without a DB round trip. The API layer still always re-verifies
`is_admin`/`is_moderator` fresh from the database
(`withModeratorOrAdminAuth` in `lib/api/middleware.ts`) before authorizing
any action — the JWT claim is only ever used for the low-cost page-level
gate, matching this codebase's existing `withAdminAuth` convention. Within
`/admin/forum/*`, a small set of actions (permanently banning a user,
restoring removed content, locking/unlocking a question) remain admin-only.

### API Routes

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/answers/questions` | List (tab-filtered, cursor-paginated) / ask a question |
| GET | `/api/answers/questions/[id]` | Question detail |
| DELETE | `/api/answers/questions/[id]` | Soft delete (author or moderator/admin) |
| GET/POST | `/api/answers/questions/[id]/answers` | List top-level answers / post an answer or reply |
| DELETE | `/api/answers/questions/[id]/answers/[answerId]` | Soft delete an answer |
| GET | `/api/answers/questions/[id]/answers/[answerId]/thread` | Lazy-load a reply subtree |
| POST | `/api/answers/questions/[id]/vote` , `.../answers/[answerId]/vote` | Upvote/downvote (toggle) |
| POST/DELETE | `/api/answers/questions/[id]/favorite` | Favorite / unfavorite |
| POST | `/api/answers/questions/[id]/best-answer` | Mark an answer as best |
| GET | `/api/answers/categories` | List forum categories (for the ask-question picker) |
| GET | `/api/admin/forum/stats`, `/queue`, `/posts` | Admin/moderator dashboard, moderation queue, post management |

**SEO (v1.97):** `/a/<slug>` (`app/a/[slug]/page.tsx`) is a public, unauthenticated, SSR preview of a question — title/description/OpenGraph/Twitter metadata, `QAPage` JSON-LD, canonical tag, listed in `app/sitemap.ts`. It resolves via `lib/public/resolveForumQuestion.ts` (slug → legacy UUID → `slug_redirects`, same 3-case pattern as rooms) and renders `components/public/PublicForumQuestionView.tsx`. This is separate from the authenticated `/answers/[id]` page (voting/answering); the public page's CTA sends unauthenticated visitors to `/auth/login`.

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

**Canonical pair ordering:** `dm_conversations` enforces `user_id_1 < user_id_2` via a CHECK constraint (`dm_canonical_pair`). All INSERT and SELECT operations on this table must use `canonicalDmPair(a, b)` from `lib/messaging/canonicalDmPair.ts` to sort the two UUIDs into ascending order before querying. This ensures exactly one row per user pair and allows the `(user_id_1, user_id_2)` unique index to be used efficiently.

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
3. The XP award path calls `checkAndApplyFlashXP`, which checks for any active flash event and applies the multiplier.

**Flash XP caching:** `checkAndApplyFlashXP` maintains a 60-second Redis cache (`flash_xp:active_event`) to avoid a DB query on every single XP award. The cache is invalidated whenever the lifecycle CRON fires or expires an event, ensuring the multiplier is always applied within 60 seconds of activation. A Redis failure falls back gracefully to a direct DB query.

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

## Business Account Signup & Tier Upgrades (PRD §17)

### Signup (Business Starter)

Business Starter is a **paid** tier (admin-configurable, default ₦5,000/month) — it is not free. Creating a business account is a payment-gated flow, mirroring the subscription purchase flow (`POST /api/economy/subscriptions`) rather than the tier-upgrade flow below:

1. Client calls `POST /api/business` with `{ business_name, business_type }`. No `business_accounts` row exists yet at this point.
2. Server resolves the Starter price from `x_manifest` key `business_starter_price_kobo` (falls back to the PRD default of ₦5,000).
3. Server calls Paystack (`initializePayment`) or DodoPayments (`createPaymentSession`) with `itemType: "business_signup"` metadata (`userId`, `businessName`, `businessType`) and returns `{ paymentUrl }` (HTTP 202 — nothing has been created yet).
4. Server inserts a `pending` record in the `payments` table (`payment_type = 'business_upgrade'`, `idempotency_key = reference`) so the webhook handler can find it.
5. Client redirects the user to the checkout page.
6. On `charge.success` / `payment.succeeded`, the webhook handler's `business_signup` branch **creates** the `business_accounts` row (`tier = 'starter'`, `status = 'active'`) using an `INSERT ... ON CONFLICT (user_id) DO NOTHING`, which makes account creation idempotent against replayed webhook deliveries — the `user_id` column is `UNIQUE`, so a duplicate delivery (or a race with a second signup attempt) simply no-ops instead of erroring or creating a second row.
7. The user is notified in-app once the account is created. `GET /api/business` will 404 until the webhook has processed — the settings page shows the "Create Business Account" form until then.

### Tier Upgrades

Once a business account exists at `starter`, it can be upgraded to `growth` (₦15,000/month) or `enterprise` (₦50,000+/month):

1. Client calls `PATCH /api/business/tier` with `{ tier, paymentProvider }`.
2. Server looks up the tier price from `x_manifest` (admin-configurable; falls back to PRD defaults).
3. **Race guard:** if the business account already has a `pending_tier` + `pending_payment_ref`, the server checks the `payments` table for a still-`pending` row with that `idempotency_key` created within the last 30 minutes. If found, the request is rejected with `409 UPGRADE_ALREADY_PENDING` instead of overwriting `pending_payment_ref` — overwriting it would make the first payment's eventual webhook activation match zero rows (see step 7) and silently lose the upgrade. Once the window expires (or the first payment resolves), a new upgrade request is allowed.
4. Server stores `pending_tier` and `pending_payment_ref` on the business account record.
5. Server calls Paystack (`initializePayment`) or DodoPayments (`createPaymentSession`) and returns `{ paymentUrl }`.
6. Server inserts a `pending` record in the `payments` table (`payment_type = 'business_upgrade'`) with `idempotency_key = reference` and `provider_reference` set to the payment provider's own reference. This record is required for the webhook handler's idempotency check; without it the webhook would bail out before activating the upgrade.
7. Client redirects user to the checkout page.
8. On `charge.success` (Paystack) or `payment.succeeded` (DodoPayments), the webhook handler:
   - Verifies the HMAC signature before any processing.
   - Looks up the `payments` row by `provider_reference` and acquires a `FOR UPDATE` row lock to prevent duplicate processing.
   - Activates the tier with `UPDATE business_accounts SET tier = ... WHERE id = ... AND pending_payment_ref = ...` — the `pending_payment_ref` match means a stale or already-applied reference updates zero rows. If zero rows are matched, the handler raises a `business_upgrade_activation_mismatch` system alert for manual reconciliation and does **not** send the success notification (a prior version of this handler sent the notification unconditionally, producing false "upgraded" confirmations when the reference was stale).
   - Clears `pending_tier` and `pending_payment_ref`.
   - Records `tier_updated_at`.
   - Sends an in-app notification to the business account owner confirming the tier activation — only when the activation update above actually matched a row.

Tier prices are admin-configurable via `x_manifest` keys `business_starter_price_kobo`, `business_growth_price_kobo`, and `business_enterprise_price_kobo`.

### Verification Requests

Independent of tier, a business account can request the "Verified" badge (PRD §17):

1. Client calls `POST /api/business/verify`. Server rejects with `409 CONFLICT` if `verification_status` is already `pending` or `verified`.
2. Server sets `verification_status = 'pending'`, `verification_requested_at = NOW()`, and raises a low-severity `system_alerts` entry so admins see it in the moderation queue.
3. Admin reviews the request at Admin → Business Accounts and calls `PATCH /api/admin/business` with `{ id, action: "verify" | "reject", reason? }`, which sets `verification_status` to `verified` or `rejected` and notifies the user.
4. `GET /api/business` returns `verification_status` (and the related `verification_requested_at` / `verification_reviewed_at` / `verification_reject_reason` columns) so the settings page reflects the live status on every page load — a prior version of this endpoint omitted these columns from its `SELECT`, which made the UI fall back to `unverified` on every refresh even after an admin had approved the request, and then throw `409 CONFLICT` if the user clicked "Request Verification" again.

### Entry points (v2.02)

`/business` (sidebar link, always visible — same "nav item unconditional, feature enforced server-side" convention as Blogs) is the hub: no account → an explainer of the feature/tiers/pricing with a Create CTA (routing to `/settings/business`, which owns the actual paid signup form); has an account → cards linking to Account & Billing (`/settings/business`, unchanged), Business Pages (`/business/pages`), the Advertising Panel (`/business/ads`), and Stats (`/business/stats`). The Capacitor Android app mirrors this at `/business`, `/business/pages(+/$pageId)`, `/business/ads` — tier/verification management itself stays web/PWA-only (same convention as Blogs settings), and any paid action (signup, upgrade) opens the Paystack/DodoPayments checkout URL in the external in-app browser (`@capacitor/browser`, the same pattern already used for OAuth) rather than embedding it — Google Play Billing is the only allowed in-app purchase mechanism on Android (PRD §18), so a web checkout page must never be presented as in-app purchase UI.

### Business Pages

A business account can run one or more **Business Pages** — its brand identity/profile, each with a name, bio, avatar/cover image, a lightweight post feed, and stats. Data model (`db/migrations/0003_business_expansion.sql`): `business_pages` (one row per page, `slug` unique, `status` active/deactivated/suspended/banned), `business_page_posts` (title/body/image, draft/published), `business_page_daily_stats` (per-page/per-day views/post_views/ad_impressions/ad_clicks rollup — same idiom as `blog_post_daily_stats`).

- **Slot limits per tier** — Starter 2, Growth 10, Enterprise 50, admin-configurable via `x_manifest` (`business_page_limit_<tier>`, `lib/business/limits.ts`). `POST /api/business/pages` rejects creation with `403 BUSINESS_PAGE_LIMIT_REACHED` once the active-page count reaches the limit; `DELETE /api/business/pages/<id>` frees the slot.
- **Public page** — `GET zobia.org/p/<slug>` (`app/p/[slug]/page.tsx`), SSR/crawlable, same convention as `/b/<slug>` for Blogs: `lib/public/resolveBusinessPage.ts` resolves by slug → legacy UUID → `slug_redirects` (entity `business_page`), listed in `app/sitemap.ts` (capped 2000), `/p/` is public in `middleware.ts`. Views are deduped client-side via `localStorage` (`zobia_biz_page_viewed`, `components/business/PageViewTracker.tsx`) exactly like blog post views, not a per-view DB row.
- **Stats depth by tier** — mirrors the Blogs stats-tier convention exactly (`lib/business/limits.ts` `getBusinessStatsTier`, same `basic`/`more`/`detailed`/`detailed_export` shape as `lib/blogs/limits.ts`): Starter = account-wide totals only; Growth = totals + per-page breakdown; Enterprise = + a 90-day daily drill-down and CSV export (`GET /api/business/pages/stats(+/export)`).
- **Admin moderation** — `/admin/business/pages` (API: `GET/PATCH /api/admin/business/pages`) mirrors `/admin/business`'s filter-pills + table + action pattern: suspend/ban/deactivate/restore/delete a single page, each action logged to `admin_audit_log` (`resource = 'business_page'`) and notified to the owner.

### Sponsored Quests — business self-service submission

Growth+ tier business accounts can submit **Sponsored Quests** — reusing the pre-existing Creator Economy Sponsored Quest Marketplace (PRD §14, `sponsored_quests` table) rather than a parallel ads system. Previously only admin could publish a quest (`POST /api/admin/sponsored-quests`, immediately live); business submission adds a moderation gate in front of that same table.

- `sponsored_quests` gains (migration `0003_business_expansion.sql`): `business_account_id`, `business_page_id`, `submitted_by`, `moderation_status` (`pending`/`approved`/`rejected`, defaults to `'approved'` so the pre-existing admin-only flow is unaffected), `moderation_reason`, and a `deleted_at` column — the latter fixes a pre-existing bug where the admin `DELETE /api/admin/sponsored-quests/[questId]` handler referenced `deleted_at` on a column that was never actually added to the schema.
- `POST /api/business/sponsored-quests` (`lib/business/limits.ts` `canSubmitSponsoredQuests` gates on tier ≥ Growth) requires an active Business Page (`businessPageId`) — the quest's `brand_name`/`brand_logo_url` are copied from that page, so "adverts run by this page are shown to come from the selected business page." The quest is inserted `is_active = false` and `moderation_status` per the admin's moderation-mode toggle.
- **Moderation mode** (`x_manifest` key `sponsored_quest_moderation_mode`, admin-editable at `/admin/config` under "Business Accounts"): `manual` (default) queues the submission for the admin approval panel; `ai` runs it through `lib/moderation/aiClassifier.ts` `classifySponsoredQuest()` — a new, dedicated system prompt (never interpolates the untrusted brief into the prompt itself, same prompt-injection defense as `classifyReport()`) that scores `approvalConfidence` 0–1; scores at or above `sponsored_quest_ai_auto_approve_threshold` (default 0.85, admin-configurable) auto-approve, everything else falls back to the manual queue.
- **Admin approval queue** — `/admin/sponsored-quests` (pre-existing admin publish/edit page) gains a moderation badge per quest and Approve/Reject buttons for business submissions, calling the new `POST /api/admin/sponsored-quests/[questId]/moderate` endpoint (`{ action: "approve"|"reject", reason? }`) — distinct from `creator/sponsored-quests/[questId]/approve` (which approves a *creator's completed application*, not the quest listing itself). Approval flips `is_active = true`; rejection notifies the submitting business owner with the reason.
- Branded Room sponsorships and Sponsored Leaderboard Banners (Pillar 3) remain admin-arranged rather than self-service — the Advertising Panel (`/business/ads`) surfaces a "Contact sales" callout for those instead of a submission form.

### Self-service tier downgrade & grace period

`PATCH /api/business/tier` also accepts a **lower** tier than the account's current one — unlike an upgrade, this needs no payment:

1. The account's `downgrade_to_tier` and `downgrade_effective_at` (`= NOW() + business_downgrade_grace_days` days, default 30, uniform across all three tiers — a deliberately simpler policy than the pre-existing per-plan `grace_period_days_business_<tier>` keys used by the *subscription-lapse* grace sweep, §"Subscription Sweep" below, which stay untouched) are set immediately; `tier` itself does **not** change yet.
2. The account keeps its current tier — including its page-slot limit and any live Sponsored Quests — until the grace period elapses. Requesting the *current* tier again (`PATCH /api/business/tier { tier: currentTier }`) cancels the pending downgrade. Requesting an *upgrade* while a downgrade is pending supersedes and clears it.
3. `lib/business/downgradeSweep.ts` `sweepBusinessDowngrades()`, called once a day from the daily-economy CRON (step 7, alongside the pre-existing `sweepSubscriptions()`), finds accounts whose `downgrade_effective_at` has passed and:
   - Deactivates the newest Business Pages beyond the new tier's slot limit (oldest-created pages are kept active first).
   - Stops (`is_active = false`) every currently-running Sponsored Quest owned by the account.
   - Applies the new `tier` and clears the downgrade fields.
   - Notifies the owner.

This is a separate, simpler mechanism from the pre-existing `lib/plans/subscriptionSweep.ts` business half (non-renewal lapse → `grace` → `lapsed` status, keyed off `business_accounts.subscription_id`) — that linkage is still never populated today (business tiers are one-off `payments` rows, not a recurring `subscriptions` row), a pre-existing gap unrelated to this self-service downgrade flow, which uses its own dedicated `downgrade_to_tier`/`downgrade_effective_at` columns instead of touching `subscriptions` at all.

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

**Exceptions** — files exempted via `overrides` in `.eslintrc.json`:
- `lib/db/providers/supabase.ts` — database adapter
- `lib/storage/providers/supabase-storage.ts` — storage adapter
- `lib/realtime/**` — realtime providers and client hook (`useRealtimeChannel`)
- `app/api/realtime/**` — realtime auth endpoints (Ably token, Pusher auth)

This enforces the PRD §22.1 requirement: when `DATABASE_PROVIDER != 'supabase'`, no Supabase SDK code is reachable through any import path (except the explicitly exempted realtime layer, which dynamically imports the SDK only when `NEXT_PUBLIC_REALTIME_PROVIDER=supabase-realtime`).

---

## Internationalisation & RTL Support (PRD §21)

The Expo app supports 8 languages: English (`en`), French (`fr`), Arabic (`ar`), Hausa (`ha`), Swahili (`sw`), Amharic (`am`), Zulu (`zu`), and Portuguese (`pt`).

Locale files live at `apps/expo/lib/i18n/locales/<lang>.json`. All locale files use a **nested JSON** structure matching the top-level namespace objects in `en.json` (23 namespaces, ~352 keys). i18next is initialised with `compatibilityJSON: 'v4'`.

### Arabic RTL

`apps/expo/lib/i18n/rtl.ts` exposes `setupRTL(locale)` which calls `I18nManager.forceRTL(true)` for Arabic and `forceRTL(false)` for all other locales. This is called automatically at app startup in `apps/expo/lib/i18n/index.ts` after i18n initialisation, and re-called whenever the language changes at runtime via the `i18n.on('languageChanged', ...)` listener. A full app reload is required for native-side RTL mirroring to take effect.

### API error translation lookup

Every API route's error response carries a machine-readable `code` (e.g. `"USERNAME_TAKEN"`) alongside its English `message` (`lib/api/errors.ts`). `translateApiError(t, code, fallbackMessage, params?)` — mirrored at `apps/web/lib/i18n/apiErrors.ts` and `apps/expo/lib/i18n/apiErrors.ts` — looks up `errors.<code lowercased>` (e.g. `errors.username_taken`) in the active locale via `t(key, { defaultValue: fallbackMessage, ...params })`, falling back to the API's own English message when no translation entry exists yet for that code/locale. This matches the casing convention of the pre-existing `errors.global_rate_limit` / `errors.not_room_member` keys.

`en.json` in both apps now has all ~110 confirmed `errors.<code>` keys populated as the English source of truth (dynamic messages use `{{paramName}}` interpolation, e.g. `errors.age_requirement_not_met`). The other 7 locale files and the ~150 existing call sites that currently render `error.message` directly have **not** been touched — translating the remaining languages and wiring `translateApiError` into call sites is follow-up work.

---

## Room Powers (PRD §11)

Room Powers are credit-purchasable in-room enhancements available to the room creator:

| Power | Cost | Effect |
|---|---|---|
| `room_spotlight` | 500 Credits | Boosts room in discovery for up to 72 hours |
| `member_highlight` | 200 Credits | Highlights a chosen member in the room for up to 8 hours |
| `message_pin` | 100 Credits | Pins a message (creator or co-moderator only) |

The backend is at `POST /api/rooms/[roomId]/powers`. The Expo room screen (`apps/expo/app/rooms/[roomId].tsx`) shows a "Room Powers" button for room creators. Tapping "Highlight Member" opens an inline username input. The app resolves the username to a UUID via `GET /api/users/search`, then posts to the powers endpoint.

---

## Google Play Annual Subscriptions

The Expo subscription screen (`apps/expo/app/settings/subscription.tsx`) supports both monthly and annual billing via a toggle. Annual plans offer 2 months free.

Play Store product IDs:

| Plan | Monthly | Annual |
|---|---|---|
| Plus | `sub_plus_monthly` | `sub_plus_annual` |
| Pro | `sub_pro_monthly` | `sub_pro_annual` |
| Max | `sub_max_monthly` | `sub_max_annual` |

Annual product IDs must be created in the Google Play Console. The verification endpoint (`/api/economy/iap/verify`) handles both monthly and annual subscription tokens identically — the `isSubscription: true` flag distinguishes them from one-time credit purchases.

---

## Cultural Vitality Calendar (PRD §25)

Platform events with XP multipliers are seeded in the `platform_events` table. The complete 2026 calendar includes:

| Event | Dates | Effect |
|---|---|---|
| New Year Hustle Season | Jan 1–7 | 1.5× XP |
| Black History Month | Feb 1–28 | 1.25× XP |
| Valentine's Gift Weekend | Feb 13–15 | 2× gift XP |
| International Women's Month | Mar 1–7 | 1.5× XP (female creators) |
| Eid al-Fitr | Mar 30–31 | 2× gift XP |
| Easter Weekend | Apr 3–5 | 2× gift XP |
| Labour Day | May 1 | 1.5× XP |
| Africa Freedom Day | May 25 | 2× XP |
| Eid al-Adha | Jun 6–8 | 2× gift XP |
| African Union Day | Jul 10–12 | 1.5× XP + alliance bonus |
| Nigerian Independence Day | Oct 1 | 2× XP |
| Kwanzaa Week | Dec 26–Jan 1 | 1.5× XP |
| Detty December | All December | 1.5× XP |
| New Year Countdown | Dec 31 23:00–Jan 1 01:00 | 3× XP |
| AFCON Season | Jan–Feb | 1.5× competitor XP + guild war bonus |

Events are stored with JSONB `metadata` for event-specific flags (e.g. `gift_xp_multiplier`, `female_creator_only`, `guild_war_points_multiplier`). The XP engine and CRON handlers read active `platform_events` and apply the appropriate multipliers at award time.

---

## Games & Gaming Track

The games feature is a modular mini-games arcade spanning web, PWA and the Expo app.
Everything except the game engines themselves is generic infrastructure.

The platform ships **57 games across 13 categories**: Puzzle, Action, Arcade, Tap, Word,
Casual, Board, Card, Idle, Trivia, Strategy, Sports, and Music. 26 games were in the
initial launch; the games catalog seed (in the consolidated schema) adds 30 more.

### Surfaces

- **Directory** — `/games` (web, in `(app)` group) and the Expo `app/games/index.tsx`
  screen list active games grouped by category (13 categories: Puzzle, Action, Arcade,
  Tap, Word, Casual, Board, Card, Idle, Trivia, Strategy, Sports, Music).
- **Public cover** — `/g/<slug>` (`apps/web/app/g/[slug]/page.tsx`, SSR, crawlable;
  Expo `app/g/[slug].tsx`). Guests see a **login gate**; members get a **Play** CTA and
  a **share** button (`buildGameReferralUrl` → `/g/<slug>?r=<code>`).
- **Play host** — web `/g/<slug>/play` and the chromeless **embed** `/g/<slug>/embed`
  used by the Expo `GameWebView`. Both mount `GameRunner`.

### The "plug in a new game" contract

A game is a self-contained HTML5/canvas React component implementing
`GameEngineProps { onReady?, onGameOver(score), onScore? }`
(`apps/web/components/games/types.ts`). To add one:

1. Add an entry to `shared/utils/games.ts` (`GAME_REGISTRY`: slug, engineKey, category).
2. Create `apps/web/components/games/engines/<engineKey>/index.tsx`.
3. Register the lazy import in `apps/web/components/games/engineRegistry.ts`.
4. Add a seed row in a migration; admin edits the cover/rewards at runtime.

`GameRunner` opens a server play session (`POST /api/games/<slug>/start`), mounts the
engine, and on game-over submits the score (`POST /api/games/<slug>/score`). The same
component runs inside the Expo WebView (`GameWebView`), which injects the access token
and relays score/reward events over the React Native bridge.

### Scoring, rewards & the Gaming track

- A play session issues a single-use **nonce**; `/score` consumes it once. Scores are
  validated against the game's `max_score` cap and `min_play_seconds` floor and are
  rate-limited (`game:score`). These are pragmatic anti-cheat guards for client-reported
  scores — see also the per-game reward gating below.
- A **solo win** = a new personal best with score > 0. On a win the player is granted the
  game's per-win **credits / XP / stars** (manifest fallbacks when 0), via the coin/star
  ledgers and `safeAwardXP(userId, xp, "gaming", …)` — all idempotent on the play id.
- The **Gaming track** (`xp_gaming` / `level_gaming` on `users`) is the 7th track (§7 of
  the PRD, added right after Generosity in every track list — leaderboards tab order,
  profile `TRACK_META`, etc.). Level-ups fire milestone titles/badges through
  `checkAndAwardTrackMilestones`. **Games-played milestones** (`game_play_milestones`,
  admin-configurable) reward cumulative play and are claimed idempotently via
  `game_milestone_claims`.
- Admin can make a game **free or paid**: `play_cost_credits` / `play_cost_stars` are
  debited in `POST /start` (challenge rounds are exempt).
- **Difficulty ramp:** some engines (currently Fruit Slicer) speed up over the course of
  a round instead of holding a fixed pace forever — `RAMP_INTERVAL_MS` per difficulty
  (60s/45s/30s for easy/medium/hard) bumps a `rampStep` that scales fall speed
  (`×1.15^step`) and shrinks the spawn interval (`×0.9^step`), capped at 8 steps so late
  game is faster but not literally unplayable. This stops a fixed pace from being
  farmable for an unbounded high score.

### Discovery — search, favorites & tabs

- `/api/games` now takes a `q` param (`ILIKE` on `name`/`tagline`) consumed by the
  discovery page's 250ms-debounced search bar — kept cheap by the debounce plus the
  existing `LIMIT`/cursor pagination; a `pg_trgm` GIN index on `games.name` is the next
  scaling step if the catalogue grows well past its current size.
- **Favorites ("❤️ Faves")**: `game_favorites (user_id, game_id)` — unique per pair, not
  plan-gated (unlike Room Pins). Toggled via `POST`/`DELETE /api/games/favorites`
  `{ gameId }`; `games.favorite_count` is a denormalised counter (mirrors
  `play_count`/`rating_count`) so the `❤️ <count>` meta shown on cards is a column read,
  not a `COUNT(*)` per row. The Android games screen gets the same heart toggle via the
  same endpoint (`useMutation` + optimistic `setQueryData`, matching the pattern already
  used by the rooms/notifications screens there).
- **Recently Played**: `GET /api/games/recent` groups the existing `game_plays` rows by
  `MAX(started_at)` per game — no new table, since every `/start` call already writes a
  play row with a timestamp.
- **Random**: `tab=random` orders by `random()` with no cursor (there's no meaningful
  stable page over a random order); the UI shows a "Shuffle again" button instead of
  "Load more" for this tab.
- The discovery page's **Leaderboards** link now goes straight to
  `/leaderboards?track=gaming` instead of the per-game score board, so it lands on the
  Gaming tab directly; the per-game high-score board is still reachable at
  `/games/leaderboards`.

### Challenges & wagers

`lib/games/challenges.ts` runs the async, score-based series. Create → (opponent) accept
→ play rounds → settle. Best-of-1 needs 1 round win, best-of-3 needs 2; draws append a
sudden-death round (hard-capped). Optional **credit wager** is escrowed from both players
on accept (`game_wager`); the winner takes the pot minus `game_wager_rake_pct`
(`game_payout`); decline/cancel/expiry refunds both (`game_refund`). The hourly
`/api/cron/games` sweep expires stale challenges and refunds escrow.

**Expiry window:** `game_challenge_expiry_hours` defaults to **720 (30 days)** — a
pending or active challenge with no response from the other side that long is expired
(and any escrow refunded) by the sweep above. The challenges page shows a live countdown
(`⏳ Expires in …`) on every pending/active challenge so this isn't a surprise.

**Challenge cancellation by challenger:** if cancelled before any rounds are played, both
stakes are fully refunded. If one or more rounds have been completed, the challenger forfeits
a fraction of their stake proportional to the opponent's round-win share (e.g. if the
opponent won 2 of 3 decisive rounds, the challenger forfeits ⅔ of their stake to the
opponent). The exact refund/forfeit amounts are included in the `game_challenge_cancelled`
notification metadata (`challRefund`, `oppRefund`, `challForfeitCoins`).

**Delete vs. cancel vs. archive:** `DELETE /api/games/challenges/<id>` removes a
**pending** challenge outright — only the challenger can do this, and only before the
opponent has responded, since nothing is escrowed yet. Once accepted (`active`), the
challenger must use `POST .../cancel` instead, which runs the forfeit logic above.
`PATCH /api/games/challenges/<id> { action: "archive" }` hides a **completed** challenge
from either participant's inbox (sets `archived_at`) without touching the
prize/wager ledger rows — completed challenges are the audit trail and are never deleted.

**Opponent search:** the challenge-creation form finds the opponent via the same
debounced `GET /api/users/search?q=` endpoint the gifts page uses (300ms debounce, min 2
chars, prefix-match on `username` + substring-match on `display_name`, capped at 20
results) instead of requiring their exact username — this was the actual cause of
`POST /api/games/challenges` occasionally 404ing ("Opponent not found") on a mistyped
username, not a routing bug. **Scalability note:** the `username ILIKE 'q%'` half of that
query is index-friendly (`idx_users_username`) as long as the DB collation lets Postgres
use it for prefix matches (verify with `EXPLAIN` — a plain btree index needs a "C"
collation or a `text_pattern_ops` index to serve `LIKE 'prefix%'`, otherwise it falls
back to a sequential scan); the `display_name ILIKE '%q%'` half is a substring match that
can't use a plain index at all — fine at current scale behind the 2-char minimum, `LIMIT
20`, and rate limiting, but if the user table grows into the millions, add a `pg_trgm`
GIN index on `display_name` (and consider `text_pattern_ops` on `username`) before this
becomes a hot path.

### Leaderboards & ads

- **Per-game high scores** live in `game_best_scores` and are read with a plain
  `ORDER BY` wrapped in a 60s Redis cache (`lib/games/leaderboard.ts`) — minimal Redis.
- The **gaming-track ranking** reuses `leaderboard_snapshots` via `track=gaming` (added to
  the leaderboards cron and the leaderboards API/UI track lists) — it's the tab right
  after Generosity on `/leaderboards`, and `?track=gaming` on that URL opens it directly.
- **Plan column is Mod/Admin-only** (applies to every track, not just Gaming): `GET
  /api/leaderboards` re-checks the requester's `is_admin`/`is_moderator` fresh from
  `users` on every call and only includes the `plan` field per entry when true — regular
  users never receive another user's plan in the response, not just have it hidden in
  the UI. `GET /api/auth/me` now also returns `is_moderator` (looked up fresh; unlike
  `is_admin` it isn't carried on the access token) so the client knows whether to render
  the column at all.
- **Ads** render through a provider-pluggable slot — web `components/ads/AdSlot.tsx`
  (AdSense when `NEXT_PUBLIC_ADSENSE_CLIENT` is set, else a labelled placeholder) and Expo
  `components/ads/AdBanner.tsx` (AdMob) — gated by the `admob_ads` feature flag.

### Star Rating System

Players can rate any game they have played (1–5 stars). The play-gate is enforced
server-side: `POST /api/games/<slug>/rate` checks `game_best_scores` for the user+game
pair (one row = has played) before accepting a rating.

- **Cover page (`/g/<slug>`):** `GET /api/games/<slug>/my-rating` returns
  `{ yourRating, hasPlayed }`. The rating widget is shown only when `hasPlayed = true`; if
  not yet played, the play CTA is shown instead.
- **Post-game screen (`GameRunner`):** the rating widget is shown automatically after every
  solo play session, directly on the result screen — no extra navigation needed.
- **Storage:** `game_ratings (game_id, user_id, rating)` unique on `(game_id, user_id)`;
  each upsert recalculates `games.avg_rating` and `games.rating_count` atomically.

### Admin

- **`feature_games`** master toggle (Feature Flags) disables the directory, API and pages.
- **`/admin/games`** — CRUD over the cover page (name, slug, descriptions, emoji, cover
  image URL, category, engine), per-game rewards, free/paid play cost, score cap, min play
  time, sort order, active flag; per-game stats; and games-played milestone management.
  The admin games page defaults to **list view** (sortable table); a card-grid view is also
  available. Category filter and text search are supported client-side.
- Runtime config (`/admin/config`): `game_wager_rake_pct`, `game_challenge_expiry_hours`,
  `game_default_reward_credits`, `game_default_reward_xp`, `game_max_wager_credits`
  (default 10 000 — server-enforced upper bound on per-challenge credit wagers),
  `game_max_play_session_age_seconds` (default 3600 — `/score` submissions older than this
  are rejected, preventing replay of stale sessions).

### Save Slots

Users can pause an in-progress game and resume it later — a plan-gated pool of "save
slots" shared across all games (not per-game): **Free 0 / Plus 1 / Pro 3 / Max 5**,
admin-configurable at `/admin/config` (`save_slots_<plan>`, `lib/plans/saveSlots.ts`).
Only one in-flight save per specific game is kept — saving again for the same game
overwrites the existing save rather than consuming a second slot.

- **Schema:** `game_saves (id, user_id, game_id, label, state jsonb, score, created_at,
  updated_at)`. `state` is an opaque JSON blob the engine serialized;
  the server never inspects its shape.
- **Engine contract:** `GameEngineProps` gains optional `initialState` / `onStateChange`
  (`apps/web/components/games/types.ts`). An engine opts in by reading `initialState` on
  mount to restore, and calling `onStateChange(snapshot)` whenever it's meaningful to
  resume from (at minimum, when `GameRunner` pauses it — see the reference
  implementation in `components/games/engines/g2048`, which snapshots `{ grid, score }`
  on every pause). `GameRunner` only shows the "💾 Save & Quit" pause-overlay button and
  the pregame "▶ Resume Saved Game" button for engines listed in
  `SAVE_SUPPORTED_ENGINES` (`components/games/GameRunner.tsx`) — adding save support to
  another engine is: implement the two props, add one line to that set. No other
  GameRunner change is required.
- **API:** `lib/games/saves.ts` backs `GET/POST /api/games/saves`,
  `GET/DELETE /api/games/saves/[saveId]`, and `POST /api/games/saves/reconcile`. The slot
  limit is enforced at write time in `upsertSave()` (a `SELECT ... FOR UPDATE` count
  inside a transaction, since the limit is admin-configurable and can't be a DB CHECK
  constraint) — creating a new save beyond the limit returns `409 SAVE_SLOTS_FULL`, and
  the client falls back to `GET /api/games/saves` to offer "overwrite one of these
  instead."
- **Finishing a resumed game:** `handleGameOver` in `GameRunner` deletes the consumed
  save once the score is successfully submitted — a completed game is no longer
  "in progress," so its slot is freed automatically without the user having to remember
  to delete it.
- **Management UI:** `/games/saved` (web/PWA, linked from the Games page header) and
  `apps/android/src/routes/games/saved.tsx` (Capacitor). The Android app doesn't host any
  gameplay engine in-app yet (its `/games/$slug` screen is a cover page only — the "Play"
  button isn't wired up), so its "Resume" action opens the web play page
  (`/g/<slug>/play`) in the in-app browser via `Browser.open()` (the same pattern already
  used for OAuth) instead of trying to resume a nonexistent local engine.
- **Downgrade/expiry overage:** see "Subscription Grace Period" below — Save Slots
  (`saved_games`) is a grace-gated feature, so its data survives a lapsed subscription
  until the grace period ends. If a user's slot limit drops below their current save
  count (whether from a lapsed-and-grace-expired subscription or an active plan
  downgrade), `/games/saved` shows an overage banner offering two paths, both requiring
  an explicit "Proceed?" confirmation: pick specific saves to delete, or confirm
  "delete the oldest automatically." `POST /api/games/saves/reconcile` powers both —
  `{ deleteIds: [...] }` for the explicit pick, `{}` for oldest-first. The same
  oldest-first trim runs non-interactively from the CRON sweep when the grace period
  elapses with nobody present to choose.

---

## Subscription Grace Period (PRD §3)

When a personal plan (Plus/Pro/Max) or Business tier (Starter/Growth/Enterprise)
subscription lapses (doesn't renew), the account is downgraded immediately, but
admin-selected data isn't deleted right away — it survives a **grace period** first.

- **Config:** `lib/plans/gracePeriod.ts` reads two `x_manifest` key families (migration
  `0042`, editable at `/admin/config` → "Grace Periods & Save Slots"):
  `grace_period_days_<plan>` (default 7/14/30 for Plus/Pro/Max, mirrored per Business
  tier as `grace_period_days_business_<tier>`) and `grace_period_features_<plan>` — a
  JSON array of feature keys from the extensible registry
  `lib/plans/graceFeatures.ts` (currently `saved_games`; `galleries` is reserved for the
  future Image Galleries feature). The admin config page renders one checkbox per
  registry entry automatically — adding a new grace-gated feature is a one-array-entry
  code change plus wiring its purge logic behind `isFeaturePreservedDuringGrace()`
  (see `lib/games/saves.ts` for the reference implementation), no new admin UI or
  migration needed.
- **Schema:** `subscriptions.grace_period_ends_at` and
  `business_accounts.grace_period_ends_at`. `subscriptions.status`
  gains two values alongside the existing `active`/`cancelled`: `grace` (lapsed, within
  the grace window) and `lapsed` (grace window elapsed, purge already ran).
- **Sweep:** `lib/plans/subscriptionSweep.ts`, called as the last step of the
  `daily-economy` CRON. Two passes:
  1. **Lapse sweep** — `active` subscriptions past `ends_at` move to `grace`
     (`grace_period_ends_at = NOW() + <plan's days>`), and `users.plan` is immediately
     reset to `free` (perks are lost right away — only the grace-gated *data* survives).
     Any grace-gated feature **not** on the plan's preserved list is purged immediately
     rather than waiting out a grace period nobody configured for it.
  2. **Grace-expiry sweep** — `grace` subscriptions past `grace_period_ends_at` move to
     `lapsed`, and any preserved-but-now-expired grace-gated data is purged (Save Slots:
     trimmed to the Free plan's limit, which is 0 by default — i.e. all saves are
     removed).
  Business accounts mirror the same two passes, keyed off
  `business_accounts.subscription_id` joined to `subscriptions` — this only fires once a
  business tier is actually linked to a recurring `subscriptions` row (the current
  Business Starter signup flow, `paystackWebhookHandler.ts`, doesn't set
  `subscription_id` yet, so the business half of the sweep has nothing to act on until
  that linkage is wired up — a pre-existing gap in Business Account billing, not
  something this sweep invents a workaround for).
- **Minimal Redis usage:** grace config reads go through the existing two-tier manifest
  cache (15s in-process + 60s Redis, `lib/manifest`) — no new Redis keys, no per-request
  Redis round-trip.

---

## CRON Architecture

### Design principles

The original monolithic `daily/route.ts` (2700+ lines) ran all background jobs in a single Vercel function invocation. On Vercel Hobby, that function has a 10-second wall-clock limit — long enough to time out under sustained DAU load. The solution:

1. **Split into 7 staggered daily slots** — each slot runs once per day at a different UTC hour, spread across the night (23:00–05:00 UTC = midnight–6am WAT). Every slot has a 10-second timeout (`export const maxDuration = 10`) and completes comfortably within it.
2. **No Redis for CRON state** — idempotency is enforced by the `cron_state` PostgreSQL table using a conditional `INSERT ... ON CONFLICT DO UPDATE WHERE value_ts < today`. A second invocation on the same calendar day resolves to `rowCount = 0` and returns immediately. Zero extra Redis reads per CRON slot.
3. **Set-based SQL everywhere** — per-row loops replaced with `INSERT ... SELECT`, CTEs with `RETURNING`, and `unnest()` batch operations. A 5000-guild contribution-alert loop (5000 × 3 queries = 15 000 round-trips) is now a 3-query CTE that runs in one round-trip.
4. **Limited-concurrency HTTP** — external HTTP calls (Telegram, push) use a `withConcurrency(items, limit, fn)` helper instead of `Promise.all` (which would fan out hundreds of simultaneous HTTP requests) or a serial `for` loop (which would exhaust the 10-second budget).
5. **Shared auth helper** — `apps/web/lib/cron/auth.ts` exports `validateCronSecret` (timing-safe `timingSafeEqual`) and `checkCronIdempotency` (DB guard). Every CRON file imports these two functions — no duplicated auth code.

### Slot assignments

```
23:00 UTC  daily-core      — structural resets (quests, streaks, XP, moments, pins)
00:00 UTC  daily-users     — user-state jobs (inactivity, guild discovery, comeback coins)
01:00 UTC  daily-notify    — outbound notifications (push, email, Telegram, council invites)
02:00 UTC  daily-guilds    — guild lifecycle (tiers, patron badge, contribution, quests)
03:00 UTC  daily-economy   — money (creator fund, plan bonuses, ad revenue, payouts, referrals, subscription grace-period sweep)
04:00 UTC  daily-social    — social graph (nemesis, leaderboards, stickers, trust scores)
05:00 UTC  daily-platform  — platform events + SYS maintenance (season, flash XP, alliance wars, DLQ)
```

### Sub-daily CRONs (externally triggered via cron-jobs.org)

These must run more frequently than once per day and cannot use Vercel's native scheduler on Hobby:

| Route | Frequency | Key jobs |
|---|---|---|
| `/api/cron/guild-wars` | Every 1 hour | Final Hour transitions, war resolution, Flash XP lifecycle, Drop room auto-close |
| `/api/cron/leaderboards` | Every 15 minutes | Batch snapshot upserts (all users × 8 tracks incl. gaming in 1 query), rank-change notifications |
| `/api/cron/games` | Every 1 hour | Expire stale game challenges and refund any escrowed wager credits |
| `/api/cron/payouts` | Every 30 minutes | Paystack transfer initiation + retry |
| `/api/cron/reconcile-balances` | Nightly (06:00 UTC) | Batch XP + coin ledger vs. wallet reconciliation; batch unnest() corrections |

### Key SQL patterns

**Batch upsert with unnest()** (replaces per-row INSERT loop):
```sql
INSERT INTO leaderboard_snapshots (user_id, track, scope, xp_value, updated_at)
SELECT unnest($1::uuid[]), unnest($2::text[]), 'global', unnest($3::int[]), NOW()
ON CONFLICT (...) DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
```

**CTE with data-modifying INSERT** (detect + insert in one round-trip):
```sql
WITH upserted AS (
  INSERT INTO guild_contribution_alerts (guild_id, user_id, weeks_below)
  SELECT ... FROM guild_avgs JOIN guild_members ...
  ON CONFLICT DO UPDATE SET weeks_below = weeks_below + 1
  RETURNING guild_id, user_id, weeks_below
)
INSERT INTO notifications (user_id, type, body, ...)
SELECT upserted.user_id, 'guild_low_contribution', ... FROM upserted
```

**Batch UPDATE with unnest()** (replaces per-row UPDATE loop):
```sql
UPDATE users SET xp_total = updates.val, updated_at = NOW()
FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS val) updates
WHERE id = updates.uid
```

**Parallel safeAwardXP** (replaces serial per-user await loop):
```typescript
await Promise.allSettled(
  warWinners.map((w) => safeAwardXP(w.user_id, XP, 'competitor', 'alliance_war_victory', `war_${warId}_${w.user_id}`))
);
```

---

## Auth Error Page

When Google OAuth fails (CSRF expiry, rate limit, banned/suspended account, stale token), the callback redirects to `/auth/error?code=<errorCode>` instead of showing raw JSON. The page renders a user-friendly message with a "Back to sign in" button. The `/auth/error` route is public (no auth required). All OAuth cookies (`zobia_csrf_state`, `zobia_mobile_redirect`, `zobia_web_redirect`) are cleared on every error path.

Supported error codes: `session_expired`, `rate_limited`, `invalid_request`, `email_not_verified`, `unexpected`.

---

## Settings — Password Section & PIN Gate

- **Optional/removable password:** `PUT /api/users/me/password` only requires
  `currentPassword` when the account already has `password_hash` set — accounts with no
  password (Google/Telegram-only signups) can leave it blank. Sending a blank/omitted
  `newPassword` **disables** password login entirely, but only when the account has a
  Google or Telegram login linked (`google_id`/`telegram_id`) — otherwise the request is
  rejected with 400 so a user can never lock themselves out of their own account.
  `GET /api/users/me` returns `has_password` / `has_oauth_login` so `/settings` can show
  the right copy (e.g. "Current password (leave blank — not set)") without guessing.
- **PIN gate:** if the user has a PIN set (`hasPIN` on `GET /api/users/me`), `/settings`
  requires PIN verification before rendering any content — same
  `POST /api/auth/pin/verify` → `pin_ok:<userId>:<sessionId>` Redis guard (5-minute TTL)
  used to gate gifts/payouts/transfers (`lib/auth/pinGuard.ts`). The verified state is
  cached client-side in `sessionStorage` for 5 minutes (matching the server TTL) so
  navigating within Settings doesn't re-prompt on every render.
- Android's `/settings` screen doesn't have password/PIN UI at all yet (only language,
  wallet/stats links, and logout) — a pre-existing gap, not part of this fix.

---

## Onboarding Gate

After Google OAuth completes, the access JWT includes an `onboarding_completed` boolean claim. Middleware checks `payload.onboarding_completed === false` (strict — old tokens without the claim pass through) and redirects any request to an app page (non-API, non-auth, non-onboarding prefix) to `/onboarding`. This prevents users from bypassing onboarding by directly navigating to app pages after a partial Google sign-up.

---

## PWA Install Prompt

The `PWAInstallPrompt` component (rendered in the app layout) shows a platform-appropriate install prompt once per visit window:

- **Android:** shows an "Install the app" banner with a link to the admin-configured APK download URL (`android_app_url` in the manifest). If no URL is configured, the prompt does not appear on Android.
- **iOS:** shows a manual "Tap Share → Add to Home Screen" guide.
- **Desktop (Chrome/Edge):** triggers the browser's native `beforeinstallprompt` dialog when available.

Dismissal is stored in `localStorage` under `zobia_pwa_prompt`:
- "Not now" → suppress for 7 days
- "Already installed / downloaded" → suppress for 90 days

The prompt never appears inside a standalone PWA (detected via `window.matchMedia("(display-mode: standalone)")`).

---

## Gifts Catalog Admin

Admins can manage the full gift item catalog at `/admin/gifts`. The page lists all gift items (active and retired) with cursor-based pagination suited to large catalogs. Actions: create a new gift item, edit any field (name, emoji, coin cost, tier, animation URL, spectacle threshold), retire an item (soft-disable), or restore a retired one.

API:
- `GET  /api/admin/gifts`       — list with cursor pagination and optional `?retired=true`
- `POST /api/admin/gifts`       — create a new gift item
- `PATCH /api/admin/gifts/:id`  — update any field
- `DELETE /api/admin/gifts/:id` — retire (sets `is_active = FALSE`)

User-facing `/gifts` page has a "Browse gift catalog" link that opens the send-gift modal so users can explore available gifts before choosing a recipient.
