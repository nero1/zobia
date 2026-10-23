# Historical PRD release notes

Preserved reference material from releases before v2.43. Current requirements live in the root PRD; legacy Expo build notes are historical and do not direct current Capacitor development. Git history retains the original interleaving.

## Appendix: Version 1.74 Change Log

### v1.74 — Changelog

- **SQL migration fix (0025):** Dollar-quoted policy blocks in `CREATE POLICY` statements inside `DO $...$` blocks no longer double-escape single quotes — all four affected RLS policies (messages, kyc_submissions, creator_kyc, failed_xp_awards) corrected. *(Note, added in v2.02: this entry predates the v2.00 migration-file consolidation — the numbered file `0025` no longer exists, and the identity-KYC tables it references (`kyc_submissions`/`kyc_documents`) were not even part of the schema at the time this fix landed (they were added later, in `0001_consolidated_schema.sql`, post-consolidation). `kyc_submissions`/`kyc_documents` in fact had zero RLS until `0001_consolidated_schema.sql` — see the v2.02 changelog below for the actual fix.)*
- **Quest deck shuffle (CSPRNG):** Replaced `ORDER BY MD5(JWT_SECRET || id)` with application-layer Fisher-Yates shuffle using `crypto.randomBytes` rejection-sampling, eliminating the MD5 bias and removing the JWT secret from DB queries entirely.
- **Cache headers:** Added correct `Cache-Control` headers to six previously uncached API routes: `/api/games/[slug]/leaderboard`, `/api/config/games`, `/api/config/rewards-ui`, `/api/announcements/banner`, `/api/announcements/modal`, `/api/leaderboards/banner`.
- **Rate-limit cookie clearing:** All rate-limit error paths now clear all session and OAuth cookies before returning the error, preventing stale cookie loops.
- **Games navigation:** Games added as the 4th item in the user sidebar accordion and the desktop header nav; Messages removed from the bottom mobile toolbar and replaced with Games.
- **Google OAuth error UX:** All auth callback error paths (CSRF expiry, invalid state, rate limit, banned/suspended) now redirect to a user-friendly `/auth/error?code=...` page instead of returning raw JSON. All OAuth cookies are cleared on every error path. The `/auth/error` page is public (added to middleware's `PUBLIC_PREFIXES`).
- **Onboarding gate:** JWT `AccessTokenPayload` gains an `onboarding_completed?: boolean` claim. Middleware redirects any authenticated user with `onboarding_completed === false` to `/onboarding` for all app pages not in the allowed-prefixes list.
- **Username "taken" fix:** The onboarding gate ensures users with incomplete Google-auth sign-up cannot bypass onboarding; the auto-generated username is reserved but the onboarding flow allows claiming a new one before completion.
- **PWA install prompt:** New `PWAInstallPrompt` client component added to the app layout. On Android, shows an admin-configured APK download link (from `android_app_url` in the manifest). On iOS/desktop, shows the standard "Add to Home Screen" guide or triggers the `beforeinstallprompt` native dialog. "Not now" suppresses for 7 days; "Already installed/downloaded" suppresses for 90 days. Prompt is skipped inside standalone PWA.
- **Admin gifts catalog:** New admin page `/admin/gifts` with cursor-based pagination for managing all gift items (create, edit, retire/restore). Backed by new admin API routes `GET/POST /api/admin/gifts` and `PATCH/DELETE /api/admin/gifts/:id`. Entry added to admin sidebar nav. User-facing `/gifts` page gains a "Browse gift catalog" link.
- **i18n:** 23 new English keys added for auth error page and PWA install prompt (`authError.*`, `pwa.*`).

---

## Appendix: Version 1.75 Change Log

### v1.75 — Changelog

- **Games Catalog Major Expansion (30 new games, 4 new categories):** Added Sudoku, Word
  Search, Lights Out, Number Match, Nonogram, Pipe Connect, Sliding Blocks, Mahjong Solitaire
  (Puzzle); Whack-a-Mole, Fruit Slicer (Action); Ayo — traditional Nigerian Mancala (Board);
  Platform Jumper, Pixel Runner, Asteroid Dodge (Arcade); Speed Tap, Color Rain (Tap); Quick
  Quiz, True or False, Emoji Quiz, Flag Quiz (Trivia — new); Word Guess, Hangman, Anagram Rush
  (Word); Tic Tac Toe, Connect Four (Casual); Gem Swap, Dots & Boxes (Strategy — new); Penalty
  Kick, Basketball Shot (Sports — new); Beat Tap (Music — new). Total catalog: 57 games.
- **GameCategory type expanded** to include Trivia, Strategy, Sports, Music. GAME_CATEGORIES
  array updated in shared types.
- **User star rating system with play-gate:** Interactive 1–5 star rating widget added to
  GameRunner result screen (after every play) and the `/g/<slug>` cover page (for users who
  have already played). Server-side play-gate enforced at `POST /api/games/<slug>/rate` —
  checks `game_best_scores` table; returns 400 if user has never played. New
  `GET /api/games/<slug>/my-rating` endpoint returns `{ yourRating, hasPlayed }`.
- **Admin games management card/list views:** Admin `/admin/games` page now has a list
  (table, default) + card grid toggle, inline search, and category filter dropdown. All 30
  new engine keys and 4 new categories added to admin selectors.
- **i18n (English):** New strings for Trivia/Strategy/Sports/Music categories, rating UI
  ("Rate this game", "Thanks for rating!", play-gate prompt), and admin view controls.
- **DB migration 0029:** Seeds all 30 new games; idempotent `ON CONFLICT DO NOTHING`.
- **Scalability:** Games list uses cursor-based pagination (offset+cursor keyset) already
  in place, designed for thousands of games. Redis leaderboard cache 60s TTL. Rating
  play-gate is a single indexed lookup on `game_best_scores (game_id, user_id)`.

---

## Appendix: Version 1.73 Change Log

### v1.73 — Changelog

- **Games Catalog Expansion (20 new games, 9 categories):** Added Tap Frenzy, Bubble
  Burst, Reaction Rush, Color Tap (Tap); Flappy Duck, Stack Tower (Arcade); Memory Match,
  Slide Puzzle, Minesweeper, Color Sort (Puzzle); Blackjack, Whot!, Higher or Lower (Card);
  Chess vs AI, Ludo vs AI (Board); Cookie Kingdom, Galaxy Miner (Idle); Word Scramble,
  Simon Says (Word); Rock Paper Scissors (Casual).
- **Game UX:** Difficulty selector (Easy/Medium/Hard) per play session, pause/resume,
  sound toggle, in-game score HUD, "How to Play" modal, "More games" link — all via
  GameRunner (zero per-engine code needed).
- **Sound effects:** All games use Web Audio API synthetic tones (subdued, comforting)
  via `useGameSound` hook. No external files.
- **Game discovery page redesign:** New/Popular/Trending tabs, category chips, Free/Paid
  filter, card and list view, cursor-based pagination.
- **Star ratings (1-5):** `game_ratings` table, `avg_rating` / `rating_count` on `games`,
  POST `/api/games/<slug>/rate`.
- **Play count formatting:** abbreviated display (1.35K, 42.19M, 567.34M) in UI.
- **Public cover page nav:** login/signup for guests, full nav for members.
- **/g/ redirect:** `/g/` root now redirects to `/games/`.
- **Paid games:** `play_cost_credits` / `play_cost_stars` — cost shown only when > 0.
- **Existing game fixes:** Snake (slowed, D-pad added), Star Blaster (collision fixed,
  particle effects), Tetris (side buttons for mobile, ghost piece, grid), Speed Dodge
  (5 lanes, starts slower, narrower cars).
- **Profile page:** Games section added with links to discover, leaderboards, challenges.
- **Admin games page:** Updated with all 26 engine keys and 9 categories.
- **i18n:** English strings added for all new games-related UI.

---

## Appendix: Version 1.72 Change Log

### v1.72 — Changelog

- **Added §30 Games & Gaming Track.** New mini-games arcade across web, PWA and Expo:
  central directory, crawlable `/g/<slug>` cover pages with a login gate for
  non-members, and 6 launch games in 3 categories (Puzzle: Tetris, 2048; Action: Speed
  Dodge, Star Blaster; Arcade: Snake, Brick Buster).
- **Gaming progression track** (`xp_gaming` / `level_gaming`) mirroring the existing six
  tracks, with milestone titles/badges and games-played milestones.
- **User-vs-user challenges** (best-of-1/3, async score model) with optional credit
  **wagers** (escrow on accept; winner takes pot minus configurable rake).
- **Per-game leaderboards** + gaming-track ranking; **ads** wired into game surfaces;
  **referral share links** for games.
- **Admin:** master `feature_games` toggle, `/admin/games` CRUD (cover page, per-game
  rewards, free/paid play cost, stats) and games-played milestone management.
- Modular engine abstraction so adding a new game is a plug-in (registry + engine
  component), reusing all sessions/scoring/leaderboard/challenge/ads infrastructure.

---

## Appendix: Version 1.81 Change Log

### v1.81 — Changelog

Security hardening, reliability improvements, UX/i18n consistency, and build configuration fixes across the Expo mobile app.

#### Security

- **OAuth deep link validation (BUG-SEC-01):** The deep-link handler in `auth/login.tsx` now performs strict origin + pathname validation using `new URL()` instead of a substring match (`url.includes('auth/callback')`). A crafted URL like `https://evil.com/?r=auth/callback` is now correctly rejected.
- **signOut CSRF fix (BUG-SEC-02):** `signOut()` in `lib/auth/context.tsx` now calls `apiClient.post('/auth/logout')` instead of a raw `fetch()`. The raw fetch bypassed the CSRF `Origin` header required by server middleware.
- **Captive portal false-online fix (BUG-SEC-03):** `onlineManager` in `lib/api/client.ts` now checks `state.isInternetReachable !== false` in addition to `state.isConnected`, preventing spurious API calls on hotel/airport Wi-Fi captive portals.
- **JWT in-memory cache (BUG-SEC-04):** A module-level `_cachedToken` variable in `lib/api/client.ts` holds the current access token after the first SecureStore read. All request interceptor calls use the cache and only fall back to SecureStore when the cache is empty. The cache is populated on `signIn`, `restoreSession`, and token refresh; cleared on `signOut`. This eliminates one Android Keystore round-trip per concurrent API request.
- **APP_ENV removed from app.json (BUG-SEC-05):** `"APP_ENV": "development"` has been removed from `app.json` `extra`. Each EAS build profile's `env` block in `eas.json` now sets the correct value (`development`, `preview`, `staging`, `production`), so the build pipeline controls the environment rather than a hardcoded default.
- **OTA runtimeVersion policy (BUG-SEC-07 / BUG-CFG-03):** `"runtimeVersion": { "policy": "fingerprint" }` added to the `expo-updates` plugin config in `app.json`, preventing incompatible JS bundles from being pushed to old native builds. The `fingerprint` policy derives the runtime version from the native layer fingerprint (native modules, config plugins, assets), so OTA updates are only delivered to builds whose native environment exactly matches.

#### Reliability / Data Integrity

- **Cold-start offline queue reset (BUG-REL-01):** `resetSendingMessages()` is now called immediately after `initOfflineDB()` on every cold start in `app/_layout.tsx`, ensuring messages stuck in `sending` state from a previous crash are retried on next launch rather than requiring a connectivity cycle.
- **Daily login XP persistence (BUG-REL-02):** The MMKV `daily_login_last_date` write in `app/(tabs)/index.tsx` is now inside the mutation's `onSuccess` callback rather than pre-mutation. On server error, the key is not written and the mutation retries on the next launch. An `onError` handler logs the failure.
- **Room auto-scroll on entry (BUG-REL-03):** `isAtBottomRef` in `app/rooms/[roomId].tsx` is initialised to `true` (was `false`), so new messages auto-scroll immediately when entering a room.
- **Presence heartbeat gated on membership (BUG-REL-04):** The heartbeat `setInterval` in the room screen now returns early if `!isMember`, preventing spurious 401/403 heartbeat calls for private rooms the user has not joined.
- **Idempotency key field name standardised (BUG-REL-05):** GIF/sticker sends in `app/rooms/[roomId].tsx` now use `idempotencyKey` (camelCase), matching all other send paths. The inconsistent `idempotency_key` (snake_case) field is removed.
- **DM reaction `userReacted` fix (BUG-REL-06):** `mapApiDM()` in `app/messages/[conversationId].tsx` now accepts and uses `currentUserId` to set `userReacted: true` on reactions the current user has applied. Reaction pills now correctly highlight for own reactions.
- **Ad load listener cross-cleanup (BUG-REL-07):** In `lib/ads/admob.ts`, the LOADED callback now calls `unsubscribeError()` before resolving, and the ERROR callback calls `unsubscribeLoaded()` before rejecting, for both `loadRewardedAd()` and `loadInterstitialAd()`.
- **SlugRedirect timeout (BUG-REL-08):** `components/deeplink/SlugRedirect.tsx` now uses an `AbortController` with a 15-second timeout. On abort or unrecoverable error, an error state with a "Go Back" button is rendered instead of an infinite spinner.
- **Cold-start notification routing (BUG-REL-09):** `app/_layout.tsx` now calls `Notifications.getLastNotificationResponseAsync()` on startup. If a notification response is present (app was cold-started from a push tap), it is routed through the same `VALID_PUSH_ROUTES` allowlist handler used for foreground taps.
- **Android keyboard double-offset fix (BUG-REL-10):** `<KeyboardAvoidingView>` in `app/rooms/[roomId].tsx` and `app/messages/[conversationId].tsx` uses `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`. `softwareKeyboardLayoutMode: "adjustResize"` in `app.json` (Android) ensures the window shrinks when the soft keyboard appears, keeping inverted FlatList input bars visible on Android API 35 with dynamic-height predictive keyboards.
- **Dedup set cap check order (BUG-REL-11):** The `seenIds` pruning in the room message dedup loop now occurs *before* `seenIds.add(id)` (check `size >= 500`), preventing the set from momentarily growing to 501 entries.
- **PIN double-advance race prevention (BUG-REL-12):** `app/settings/pin.tsx` uses an `advancingRef` to ensure `advance()` cannot be called twice within the 150 ms transition window, even when both the hidden `TextInput.onChangeText` and a numpad `Pressable.onPress` fire simultaneously.
- **War countdown timer stops on end (BUG-REL-13):** The countdown `tick()` function in `app/guilds/wars/[warId].tsx` now calls `clearInterval(id)` when `diff <= 0`, preventing indefinite state updates after the war has ended.
- **War query polling stops on end (BUG-REL-14):** `refetchInterval` in the war screen query is now `war?.status === 'ended' ? false : 10_000`, stopping the 10-second polling once the war is over.
- **Tied-score display fix (BUG-REL-15):** `guild1Winning` in the war screen is now `!isTied && guild1.score > guild2.score`. When scores are tied, both are rendered in the neutral text colour rather than highlighting guild 1 as the winner.
- **Settings patch silent failure fixed (BUG-REL-16):** `patchMutation` in `app/settings/index.tsx` now has an `onError` handler that shows an `Alert` with `t('settings.saveFailed')`, making setting save failures visible to the user.
- **Date-of-birth calendrical validation (BUG-REL-17):** After the regex check in the DoB save flow, the date is now validated calendrically via `new Date()` and compared back to the ISO string. Structurally valid but impossible dates (e.g. 2000-13-45) are now rejected.

#### UX / I18N / Consistency

- **Push registration failure no longer blocks app (BUG-UX-01):** The `Alert.alert()` on push token registration failure in `app/_layout.tsx` has been replaced with `console.warn()`. Push failures are non-blocking; the user can retry via Settings.
- **Quests tab migrated to React Query (BUG-UX-02):** `app/(tabs)/quests.tsx` now uses `useQuery` for both daily quests and new-member quest data, enabling stale-while-revalidate, background refetch on tab focus, and pull-to-refresh via `refetch()`.
- **Wallet tab migrated to React Query (BUG-UX-03):** `app/(tabs)/wallet.tsx` now uses `useQuery` with `queryKey: ['wallet', 'summary']`, replacing the manual `useState`/`useEffect` pattern.
- **Settings `/users/me` deduplicated (BUG-UX-04):** `TwoFactorSection` and the DoB pre-fill in `app/settings/index.tsx` now share a single `useQuery` with `queryKey: ['user-me-totp']`, eliminating the duplicate `/users/me` network call.
- **Data export uses file sharing (BUG-UX-05):** `handleExport()` in `app/settings/index.tsx` now writes the JSON to `FileSystem.cacheDirectory` via `expo-file-system` and shares via `Share.shareAsync()` with `mimeType: 'application/json'`. The previous `Share.share({ message: json })` approach failed or truncated on Android for large payloads.
- **`formatPlayingSince` uses active locale (BUG-UX-06):** `app/(tabs)/profile.tsx` now passes `i18n.language` to `formatPlayingSince()` instead of the hardcoded `'en-US'` locale.
- **Profile tab i18n (BUG-UX-07):** "Edit Profile", "Track Levels", "Season History", "No Guild", "No past seasons yet", "My Wallet", "Credit Store", "Creator Dashboard" are now passed through `t()` using the `profile.*` keys added to `lib/i18n/locales/en.json`.
- **Messages tab section headers i18n (BUG-UX-08):** "Direct Messages" and "Group Chats" in `app/(tabs)/messages.tsx` are now `t('messages.directMessages')` and `t('messages.groupChats')`.
- **SwipeDrawer gesture conflict resolved (BUG-UX-09):** The pan gesture in `components/layout/SwipeDrawer.tsx` now sets `.activeOffsetX([5, Infinity]).failOffsetY([-10, 10])`, preventing the drawer from opening when the user is horizontally scrolling child content.
- **PIN brute-force rate limiting (BUG-UX-10):** Both `app/settings/pin.tsx` and `app/economy/store.tsx` now track failed PIN attempts and lock the numpad for 30 seconds after 5 consecutive failures.
- **Reaction endpoints corrected and standardised (BUG-UX-11):** DM reactions now call `POST /messages/dm/{conversationId}/reactions` with `{ messageId, emoji }` in the request body (was incorrectly calling `/messages/dm/{id}/messages/{msgId}/react`). Room reactions now use `POST` (was `PATCH`) to match the server route at `/api/rooms/{roomId}/messages/{messageId}/reactions`.
- **`formatCoins()` uses Decimal.js (BUG-UX-12):** `app/economy/wallet.tsx` now computes M/K coin display values using `new Decimal(amount).div(...)` instead of native float division, eliminating precision risk at large balances.
- **Admin user list guard against double-fetch (BUG-UX-13):** `FlatList.onEndReached` in `app/admin/users.tsx` now checks `!loading && !refreshing` before calling `loadUsers()`, preventing a second page from being fetched while one is already in flight.
- **Typed route objects replace `as never` casts (BUG-UX-14):** Route pushes in `app/(tabs)/guild.tsx` now use typed `{ pathname, params }` objects and static string routes, enabling TypeScript to catch route renames at compile time.
- **Admin financial formatting deterministic (BUG-UX-15):** All numeric metrics in `app/admin/index.tsx` now use `.toLocaleString('en-US')` with an explicit locale, ensuring consistent display across all admin devices regardless of device locale.

#### Build Configuration

- **`googleServicesFile` added to `app.json` (BUG-CFG-02):** `"googleServicesFile": "./google-services.json"` is now present in the `android` block, enabling reliable FCM delivery on Android API 33+.
- **`prefsStore` intent documented (BUG-CFG-04):** The unencrypted MMKV instance in `lib/i18n/index.ts` now has an explicit comment confirming it stores only UI language preference (non-sensitive) and must never be used for user data or auth tokens.

---

## Appendix: Version 1.71 Change Log

### v1.71 — Changelog

#### SEO-Friendly Public URLs + Cross-Platform Referral Attribution

Introduced human-readable, crawlable, shareable public URLs across web, PWA and Expo, plus a working `?r=` referral capture/attribution layer.

- **Public URL scheme:** `/u/<username>` (profiles), `/r/<slug>` (Rooms), `/c/<slug>` (courses/classrooms), `/g/<slug>` (games — upcoming). See "Public URL Structure — SEO-Friendly Slugs".
- **Identifier model:** immutable UUID stays the internal reference; a mutable, unique **slug** is the public alias. Duplicate names get a numeric suffix with no separator (`dorcas-cuisine`, `dorcas-cuisine2`). Slug source of truth: `slugify` in `@zobia/shared/utils` + DB dedupe in `apps/web/lib/slug.ts`.
- **New schema (migration `0001_consolidated_schema.sql`):** `rooms.slug` (+ partial unique index, backfilled for existing rooms), new `games` table, new `slug_redirects` table (rename history for 301s).
- **Backward compatible:** legacy `/r/<uuid>` links and retired slugs 301-redirect to the canonical slug. Sitemap, `canonical` tags and `robots.txt` use slug paths.
- **Referral param stays `?r=`** (not `?ref=`/`?utm=`) and now works when attached to ANY public page. Capture is automatic: `ReferralCapture` (web/PWA, cookie + localStorage) and `useReferralCaptureFromLink` (Expo, MMKV); replayed at `/onboarding/complete` then cleared. Previously the web onboarding never sent the captured code — now fixed.
- **Deep linking:** Expo universal-link screens (`/u`, `/r`, `/c`, `/g`) resolve slugs to UUIDs via new `GET /api/public/resolve`. iOS Universal Links (`apple-app-site-association`) added; Android `assetlinks.json` package name corrected to `org.zobia.social`.
- **Domain:** retired `zobia.social`; defaults now point at `zobia.vercel.app`, configurable via `NEXT_PUBLIC_APP_URL` (web) / `WEB_BASE_URL` (Expo), switching to `zobia.org` on custom-domain connection. `robots.txt` is now generated dynamically (`app/robots.ts`).

---

## Appendix: Version 1.6 Change Log

### v1.6 — Changelog

#### 1. Soft Currency Renamed: Coins → Credits

The soft (earned) currency has been renamed from **Coins** to **Credits** across all user-facing surfaces — web app, PWA, and Expo mobile app. All i18n strings in all 8 supported locales have been updated accordingly. Internal database identifiers (`coin_ledger`, `coin_balance`, `coin_to_cash_rate`) are unchanged.

#### 2. Admin-Configurable Currency Display Names

Both currencies now have admin-configurable display names, stored in `x_manifest`:

| Key | Default | Description |
|---|---|---|
| `currency_soft_name_singular` | `Credit` | Singular form of the soft currency |
| `currency_soft_name_plural` | `Credits` | Plural form of the soft currency |
| `currency_premium_name_singular` | `Star` | Singular form of the premium currency |
| `currency_premium_name_plural` | `Stars` | Plural form of the premium currency |

Admins can change these from **Admin → Platform Configuration → Economy**. Changes are reflected within the manifest cache TTL (60 seconds). The `ZobiaManifest` interface exposes these under `manifest.currency.*`. A DB migration (009) seeds the defaults.

#### 3. Authenticated Root Redirect

When a logged-in user visits the root URL (`/` or the bare domain e.g. `zobia.vercel.app`), they are now redirected to `/home` instead of seeing the public marketing landing page. This is enforced in `middleware.ts` — the existing JWT verification is reused; no additional DB call is made.

---

## Appendix: Version 1.80 Change Log

### v1.80 — Changelog

- **PIN verification sends plaintext (BUG-SEC-02 revised):** The store PIN submission now sends `{ pin: plaintext }` directly to the server instead of a client-side SHA-256 hash. Client-side hashing was removed because (a) the server must hash the PIN itself with a server-side salt for security, and (b) the v1.79 implementation exposed the hash over the wire with no additional benefit. Hashing is the server's responsibility.
- **Dynamic AdMob App IDs via `app.config.ts` (BUG-CFG-01):** AdMob App IDs are now driven by `ADMOB_APP_ID_ANDROID` / `ADMOB_APP_ID_IOS` env vars read in `app.config.ts`. Non-production builds fall back to Google's public test IDs. The static `react-native-google-mobile-ads` block has been removed from `app.json`.
- **Star packs purchasable via Google Play Billing (BUG-PAY-01):** `purchaseStars()` function added to `lib/payments/googlePlay.ts` following the same session/resolver/timeout pattern as `purchaseCoins()`. The global purchase listener now forwards `starsGranted` from server verification to the resolver. `store.tsx` routes star-pack purchases through Google Play Billing on Android instead of opening an external URL.
- **Change Password screen (BUG-UI-11):** `/settings/change-password` route is now implemented with a three-field form (current password, new password, confirm). The settings screen "Change Password" row navigates to this screen instead of showing a stub Alert.
- **EAS build channels + OTA targeting (BUG-CFG-02):** `eas.json` now includes `"channel"` fields (`development`, `preview`, `production`) in each build profile, enabling channel-based OTA update targeting via `expo-updates`.
- **DropRoomTimer ESLint/deps fix:** `useEffect` dependency in `DropRoomTimer` now uses `dropEndsAt` as the dependency and computes the initial value inside the effect, eliminating the `react-hooks/exhaustive-deps` warning introduced by the v1.78 timer-leak fix.
- **i18n string added:** `settings.changePasswordSuccess` — "Password changed successfully."

## Appendix: Version 1.79 Change Log

### v1.79 — Changelog

- **GameWebView security hardening (BUG-SEC-01 + BUG-WV-01):** The raw JWT is no longer injected into WebView's JavaScript scope via `injectedJavaScriptBeforeContentLoaded`. Games now communicate with the API via a **postMessage-based proxy**: the game posts `{ type: 'API_REQUEST', requestId, method, endpoint, body }` and the React Native host makes the call using the authenticated `apiClient`, then posts back `{ type: 'API_RESPONSE', requestId, data/error }`. The `originWhitelist` is derived from `API_BASE_URL` at runtime instead of being hardcoded.
- **i18n language preference persistence (BUG-I18N-01):** `resolveLocale()` now checks MMKV (`user_language` key in the `zobia_prefs` store) before falling back to device locale. This is required for Pidgin, which has no standard OS locale code and must be manually selected by the user.
- **Google Play Billing connection cleanup (BUG-PAY-02):** `disconnectGooglePlayBilling()` now clears all in-memory resolver, session, and recovery maps after `endConnection()`, preventing stale callbacks from firing after reconnect.
- **AdMob listener leak fixes (BUG-ADS-01 + BUG-ADS-02):** Interstitial ad failure path now unsubscribes the CLOSED listener before resolving. Rewarded ad EARNED_REWARD/CLOSED race condition fixed with a settle-once pattern and a 150 ms CLOSED delay.
- **PIN security (BUG-SEC-02):** PIN is now SHA-256 hashed (salted with `userId:pin`) via `expo-crypto` on device before being sent to the server.
- **Safe Area tab bar (BUG-UI-01):** Tab bar height and padding now account for Android gesture navigation bottom inset using `useSafeAreaInsets`.
- **Offline message queue (BUG-OFFLINE-01):** Send failure in room chat now queues the message to SQLite via `queueMessage()` so it syncs when connectivity resumes.
- **Home screen fixes:** Toast timer leak fixed with `useRef` cleanup (BUG-MEM-02); MMKV daily-login read guarded against pre-init crash (BUG-CRASH-01); QuestCard and NemesisXPBar progress bars clamped to `flex: 0.005` minimum to prevent flex-zero collapse (BUG-UI-02).
- **SwipeDrawer navigation (BUG-NAV-01/02/03):** Navigation no longer uses a fragile `setTimeout`; `signOut` has error handling; backdrop is always mounted with `pointerEvents` toggled instead of conditionally rendered (eliminates dual-state divergence).
- **Profile non-null crash fix (BUG-CRASH-02):** `friendMutation` and `followMutation` in `profile/[userId].tsx` guard against `profile` being undefined instead of using `!` non-null assertions.
- **Subscription API shape fix (BUG-API-01):** `fetchMe()` in subscription screen now handles `{ user: {} }`, `{ data: {} }`, and flat `{}` response shapes.
- **Wallet theme hook (BUG-THEME-01):** `wallet.tsx` now uses `useTheme()` instead of `useColorScheme()` to respect app-level theme overrides.
- **CI auth gate fix (BUG-CI-01):** `continue-on-error: true` removed from EAS credentials step so build failures surface properly.
- **Duplicate contacts fix (BUG-MINOR-02):** Phone numbers are deduplicated with `new Set()` before cross-referencing.
- **Idempotency key dedup (BUG-MINOR-01):** Redundant `_${Date.now()}` suffix removed from offline message `idempotencyKey`.
- **Duplicate capacity handler refactor (BUG-DUP-01):** Room "Increase Capacity" logic extracted into a single `handleIncreaseCapacity` `useCallback`; the duplicated `.then`/`.catch` chain in Room Powers is replaced with a single call.
- **CountdownTimer null guard (BUG-CHAT-04):** CountdownTimer only renders when `room.dropEndsAt` is set.
- **i18n string added:** `offline.queued` — "Message saved — will send when you're back online."

## Appendix: Version 1.78 Change Log

### v1.78 — Changelog

- **Pidgin added as a supported language:** Pidgin is now listed as a ninth launch language. The `isPidginLocale` helper and `getPidginSuggestions` now match both `'pcm'` and `'pidgin'` locale codes, and the settings screen language picker includes Pidgin as a selectable option.
- **Bug fixes (31 code-fixable issues):** Critical auth/session-expiry fixes (signOut clears session-expired flag; handleLogout/handleConfirmDelete now call signIn correctly); theme preference persisted synchronously via a dedicated unencrypted MMKV instance; SQLite encryption-key promise cache cleared on rejection; Google Play Billing reconnects on app foreground and initialises before purchase; push-notification route allowlist extended to cover group messages and guild chat; broadcast messages now render in MessageBubble; pending-message deduplication is content-based; KeyboardAvoidingView behaviour corrected per platform; floating notification timers cleaned up on unmount; gift spectacle detection moved from React Query `select` to a pure `useEffect`; wallet date formatting passes active locale; AppState token-refresh listener uses ref to avoid stale closure; several minor type-safety, comment, and i18n improvements.
- **Remaining external items (not fixable in code):** BUG-CRIT-04 (AdMob production IDs — requires AdMob account), BUG-MED-21 (iOS AASA deployment), BUG-LOW-23 (Telegram bot name — requires BotFather verification).

---

## Appendix: Version 1.83 Change Log

### v1.83 — Changelog

Bug fixes and security hardening across the Expo mobile app. All 28 bugs from the forensic audit (custom-bugs-report.md) resolved.

#### Critical Fixes

- **C-1 — `displayName` missing from token refresh user object:** `refreshAccessToken()` in `lib/api/client.ts` now includes `displayName` (coalescing `me.displayName ?? me.display_name`) in the `updatedUser` object written to SecureStore and broadcast via `notifyUserUpdated()`. Previously, any token rotation silently stripped `displayName` from the in-memory user, causing profile display regressions.
- **C-2 — Undefined `total` in admin payouts screen:** `AdminPayoutsScreen` in `app/admin/payouts.tsx` now declares a `total` state variable (initially 0, updated from `data.total ?? payouts.length` on each page load) so the `ListHeaderComponent` renders the payout count without crashing.
- **C-3 — MMKV `authToken` always undefined in admin refunds:** Both `loadRefunds()` and `handleIssueRefund()` in `app/admin/refunds.tsx` now use `apiClient.get()` / `apiClient.post()` (which reads the JWT from SecureStore via its request interceptor) instead of `storage.getString('authToken')` (which always returned undefined). All admin API calls are now authenticated.
- **C-4 — Cold-start notification navigates before nav tree exists:** `getLastNotificationResponseAsync()` result is now stored in a `pendingNotifAction` ref instead of calling `router.push()` immediately. A new effect keyed on `(!isLoading && storeReady && user)` fires the navigation once the nav tree is mounted and the session is confirmed.

#### High-Priority Fixes

- **H-2 — Deprecated Play Billing subscription upgrade API:** `purchaseSubscription()` in `lib/payments/googlePlay.ts` now uses `subscriptionReplacementInfo: { oldPurchaseToken, prorationMode }` (Play Billing v5+) instead of the removed `replaceSku` / `prorationMode` root fields. Purchase tokens for active subscriptions are persisted to MMKV (`STORE_KEYS.ACTIVE_SUB_TOKENS`) on successful verification. A new exported `getActiveSubscriptionToken(productId)` helper allows callers to supply the old token for upgrades.
- **H-3 — AdMob ad unit IDs missing from production EAS build:** `eas.json` production profile now includes `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`, `EXPO_PUBLIC_ADMOB_BANNER_ANDROID`, and `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID` env vars alongside the existing App ID vars.
- **H-4 — `apiFetch` reads SecureStore on every call instead of in-memory cache:** `apiFetch.ts` now imports and uses `getCachedToken()` (new export from `lib/api/client.ts`) for the Authorization header instead of `SecureStore.getItemAsync()`. A 401 response now triggers a single silent token refresh (via `refreshAccessToken()`) and retries the request, matching the behaviour of the Axios interceptor.
- **H-5 — Stale `setUser(parsedUser)` overwrites fresh user after token refresh:** After a successful token refresh at app restore, `AuthProvider` now re-reads the user from SecureStore (which `refreshAccessToken()` has already updated with the fresh `/users/me` profile) instead of calling `setUser(parsedUser)` with the pre-refresh stale object.

#### Medium-Priority Fixes

- **M-1 — Ably client leaked when error thrown after connect:** `useRealtimeChannel.ts` now tracks the Ably client reference in an outer `ablyClient` variable. The catch block calls `ablyClient.close()` when the client was created before the error, preventing WebSocket leaks.
- **M-2 — TOTP attempt count resets on app restart:** `TwoFactorScreen` now reads/writes `STORE_KEYS.TOTP_ATTEMPTS` and `STORE_KEYS.TOTP_LOCKED_UNTIL` to MMKV. Lockout state is restored on mount, and a 15-minute lockout is persisted on 5th failure.
- **M-3/M-10 — Notification listener fires for logged-out users:** A `userRef` is now maintained alongside `isLoadingRef` in `_layout.tsx`. The notification response listener guards on `!userRef.current` in addition to `isLoadingRef.current`, preventing routing to protected screens when the session has expired.
- **M-4 — Gift-send PIN lockout resets on app restart:** `gift-send.tsx` now reads/writes `STORE_KEYS.GIFT_PIN_ATTEMPTS` and `STORE_KEYS.GIFT_PIN_LOCKED_UNTIL` to MMKV. 15-minute lockout is enforced and survives restarts.
- **M-5 — Creator payout PIN lockout resets on app restart:** `creator/dashboard.tsx` now reads/writes `STORE_KEYS.PAYOUT_PIN_ATTEMPTS` and `STORE_KEYS.PAYOUT_PIN_LOCKED_UNTIL` to MMKV. Same 15-minute lockout pattern as M-4.
- **M-6 — Date of birth transmitted as URL params (PII exposure):** Onboarding step 1 (`app/onboarding/index.tsx`) now writes `{ birthYear, birthMonth, birthDay }` to `STORE_KEYS.ONBOARDING_DRAFT` in MMKV and omits these fields from the route params. `vibe-quiz.tsx` type declaration updated to remove DOB fields. `welcome-drop.tsx` reads DOB from MMKV draft and clears it after successful `/onboarding/complete`.
- **M-7 — Chat message cache grows unboundedly:** `lib/chat/messageCache.ts` now maintains a `STORE_KEYS.CHAT_CACHE_INDEX` list (max 50 entries). When the cap is exceeded, the oldest conversation's cache entry is evicted via `removeItem()`.
- **M-8 — Admin financial screen swallows load errors silently:** `app/admin/financial.tsx` now has a `loadError` state. When both API calls fail, an error message with a Retry button is shown instead of an empty screen.
- **M-9 — Store PIN lockout resets to same window on each lockout:** `app/economy/store.tsx` now tracks `PIN_LOCKOUT_COUNT` in MMKV. Each successive lockout doubles the window (30s → 60s → 120s … capped at 30 min), instead of always 30s. Count resets to 0 on successful PIN verification.

#### Low-Priority Fixes

- **L-1 — Set eviction in room screen evicts only one entry per batch:** The spectacle dedup Set eviction in `app/rooms/[roomId].tsx` now removes all excess entries in a single pass (`toRemove = size - 499`) so a large message batch cannot temporarily inflate the Set beyond the intended cap.
- **L-2 — `LANGUAGE_PREF` not in STORE_KEYS registry:** `STORE_KEYS.LANGUAGE_PREF` added so future code can reference this key without risk of typos.
- **L-5 — Birth year validation allows current year:** `validateBirthYear()` in `onboarding/index.tsx` now caps at `currentYear - MINIMUM_AGE` instead of `currentYear`, preventing a user who hasn't turned 18 yet this calendar year from passing the year-only check.
- **L-6 — Non-NGN currency uses imprecise `toLocaleString`:** `formatKobo()` in `store.tsx` now uses `.toFixed(2)` for the major-unit conversion for non-NGN currencies, eliminating floating-point representation errors.
- **L-7 — Contacts upload is fire-and-forget with premature `done` status:** `handleFindFriends()` in `onboarding/index.tsx` now awaits the `apiClient.post()` call before setting `contactsStatus('done')`. API errors are still swallowed so the flow is non-blocking, but the status now accurately reflects completion.
- **L-8 — No warning when EAS `projectId` is absent:** `registerForPushNotifications()` in `_layout.tsx` now logs a `console.warn` when `Constants.expoConfig?.extra?.eas?.projectId` is undefined, making misconfigured staging builds easier to diagnose.

#### Store Keys Added

`STORE_KEYS` in `lib/offline/store.ts` gains: `ONBOARDING_DRAFT`, `TOTP_ATTEMPTS`, `TOTP_LOCKED_UNTIL`, `GIFT_PIN_ATTEMPTS`, `GIFT_PIN_LOCKED_UNTIL`, `PAYOUT_PIN_ATTEMPTS`, `PAYOUT_PIN_LOCKED_UNTIL`, `CHAT_CACHE_INDEX`, `LANGUAGE_PREF`, `ACTIVE_SUB_TOKENS`, `PIN_LOCKOUT_COUNT`.

#### Remaining External Items (not fixable in code)

- **H-1 (Android App Links SHA256):** `apps/web/public/.well-known/assetlinks.json` contains a placeholder `REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256`. The correct fingerprint must be obtained from Play Console (Setup → App integrity → App signing → SHA-256 certificate fingerprint) and substituted before App Links verification will work on Android 12+.

---

## Appendix: Version 1.84 Change Log

### v1.84 — Changelog

Security hardening, UX improvements, and architectural cleanup across the Expo mobile app (25 issues from the second forensic audit resolved).

#### Security Fixes

- **SEC-01/HARD-04 — EAS Project ID hardcoded in `eas.json`:** All four build profiles (development, preview, staging, production) now read the project ID from the `$EAS_PROJECT_ID` environment variable instead of a hardcoded string. Push notifications now work correctly across all EAS build environments.
- **SEC-02 — Email change exposed inline in settings (PII):** A dedicated `/settings/change-email` screen is now implemented with fields for current password, new email, and confirm email. The settings screen "Change Email" row navigates to this screen. The current email is no longer displayed inline as editable text on the main settings screen. Calls `POST /auth/change-email`.
- **SEC-03 — AdMob always requests personalised ads regardless of consent:** `lib/ads/admob.ts` now tracks a `_personalizedAdsEnabled` flag. After UMP consent resolves, the flag is set to `true` only when status is `NOT_REQUIRED` or `OBTAINED`. All ad load calls pass `requestNonPersonalizedAdsOnly: !_personalizedAdsEnabled`, ensuring GDPR/CCPA compliance.
- **SEC-04 — No GIF URL validation (SSRF/content injection risk):** `lib/utils/mediaUrl.ts` introduces `isTrustedGifUrl(url)`, which validates GIF URLs against an allowlist of trusted CDN hostnames (`giphy.com`, `media.giphy.com`, `tenor.com`, `media.tenor.com`, `c.tenor.com`) and enforces `https:`. GIF messages in rooms and DMs now call `isTrustedGifUrl` before sending; untrusted URLs are blocked client-side.
- **SEC-05 — GameWebView origin validation uses first-navigation URL instead of current URL:** `components/games/GameWebView.tsx` now derives `gameOrigin` from a `currentUrlRef` that tracks the active page URL via `onNavigationStateChange`. The `originWhitelist` is rebuilt on each navigation, preventing a compromised redirect from injecting messages under the original game's origin.
- **SEC-06 — PIN lockout keys not in STORE_KEYS registry (cleared on sign-out):** `STORE_KEYS.SETTINGS_PIN_ATTEMPTS`, `SETTINGS_PIN_LOCKED_UNTIL`, `SETTINGS_PIN_LOCKOUT_COUNT`, `TOTP_LOCKOUT_COUNT`, and `GIFT_PIN_LOCKOUT_COUNT` added to the STORE_KEYS registry in `lib/offline/store.ts`. All PIN and TOTP lockout state is now named via the registry, ensuring it is cleared on sign-out.

#### Bug Fixes

- **BF-01 — TOTP lockout does not use exponential backoff:** `app/auth/two-factor.tsx` now implements exponential backoff for TOTP lockouts: 15 min → 30 min → 1 h → 2 h → 4 h → 8 h → 24 h (max). A `TOTP_LOCKOUT_COUNT` counter persisted to MMKV tracks successive lockouts. The count resets to 0 on successful verification.
- **BF-03 — Settings PIN lockout window is only 1 minute:** The PIN lockout window in `app/settings/pin.tsx` has been increased from 1 minute to 15 minutes (`PIN_LOCKOUT_MS = 15 * 60_000`), matching the lockout duration used by gift-send and creator payout flows.

#### UX Improvements

- **UX-01 — Notification rows are not tappable:** `app/notifications/index.tsx` now wraps each `NotifRow` in a `Pressable`. A `getNotificationRoute()` helper maps notification type + payload to the appropriate in-app route (DM → `/messages/:id`, guild war → `/guilds/:id`, gift → wallet, etc.). Tapping a notification also marks it read via a `POST /notifications/:id/read` API call.
- **UX-02/HARD-03 — TOTP screen shows no countdown and does not auto-unlock:** A `remainingSeconds` state and a `useEffect` with a 1-second `setInterval` have been added to `app/auth/two-factor.tsx`. The lockout message now displays a live countdown. When the timer reaches zero the lockout state is cleared automatically and the input is re-enabled.
- **UX-03 — Change-password button renders "undefined" label:** The `Button` component in `app/settings/change-password.tsx` now uses the `label` prop (correct) instead of the non-existent `title` prop.
- **UX-04 — Contacts upload status has no error state:** `app/onboarding/index.tsx` now has a distinct `'error'` contacts status (separate from `'unavailable'`). Upload failures set status to `'error'` and display an error banner; permission denials remain `'unavailable'`.
- **UX-05 — Dead `enter_remove` PIN step causes unreachable state:** The `enter_remove` step and its associated `removePin` state variable have been removed from `app/settings/pin.tsx`. The hidden-input `onChangeText` setter ternary no longer references the removed `setRemovePin` function.
- **UX-06 — Welcome-drop submit retries indefinitely on server error:** `app/onboarding/welcome-drop.tsx` now handles error responses by status class: 409 Conflict → mark onboarding complete and navigate away (no loop); other 4xx → mark complete and let server reconcile; 5xx/network → show error banner and allow retry.
- **UX-07 — Notification toggle patches entire settings object:** The notification-preference toggle in `app/settings/index.tsx` now sends a diff-only PATCH (only the changed key) instead of re-sending all notification fields. This prevents stale data overwrites when multiple toggles are changed in rapid succession.

#### Architecture & Performance

- **ARCH-01 — PIN rate-limiting logic duplicated across three screens:** `lib/hooks/usePinRateLimit.ts` is a new shared hook that implements exponential-backoff PIN rate limiting. Accepts MMKV key names for attempts, lockout timestamp, and lockout count. Used by settings PIN, gift-send PIN, and creator payout PIN screens.
- **ARCH-02 — `/users/me` query key inconsistent across screens:** The React Query key for the current user has been normalised to `['user-me']` in `app/settings/index.tsx`. All screens sharing this query now see the same cached data.
- **ARCH-03 — GameWebView has no message rate limiting:** `components/games/GameWebView.tsx` now enforces a 30-message-per-second rate limit. A counter resets every second; when the limit is exceeded, a 5-second penalty window is applied and subsequent messages from the game are dropped until the window expires.

#### Data Integrity

- **DATA-01 — `currentTier` missing from `useCallback` dependency array:** The subscription-upgrade callback in `app/settings/subscription.tsx` now includes `currentTier` in its `useCallback` dependency array, preventing stale-closure upgrades.
- **DATA-03 — Contacts uploaded in one request (payload size risk):** `app/onboarding/index.tsx` now chunks the contacts array into batches of 500 before uploading. Each batch is sent sequentially via `POST /contacts/sync`, preventing request-size errors for users with large address books.

#### Financial / Currency

- **FIN-01 — Non-NGN subscription price display:** `app/settings/subscription.tsx` now reads the user's locale currency from the manifest and formats non-NGN prices using the correct symbol and decimal format rather than defaulting to ₦.
- **FIN-02 — Minor-unit helpers coupled to Naira:** `lib/utils/currency.ts` now exports currency-agnostic `minorUnitToStr(amount, symbol, divisor)`, `minorUnitToDecimal(amount, divisor)`, and `minorUnitToInt(amount, divisor)`. The existing `koboToNairaStr`, `koboToDecimal`, and `koboToNairaInt` functions are retained as backward-compatible aliases.

#### Performance

- **PERF-02 — App manifest fetched twice (settings + currency hook):** `lib/hooks/useManifest.ts` is a new shared hook that exports `useManifest()` and `useFeatureFlags()` under the single query key `['manifest']`. The settings screen and currency hook now both consume this shared hook, eliminating the duplicate network request.
- **PERF-03 — `Image` from `react-native` used for GIF rendering:** The room screen (`app/rooms/[roomId].tsx`) now imports `Image` from `expo-image`, which has native GIF decoding and better memory management. The DM screen already used `expo-image`.

#### Internationalisation

- **MISC-01 — RTL layout not reapplied when language changes at runtime:** `lib/i18n/index.ts` now subscribes to `i18n.on('languageChanged')`. When the new language requires a different text direction, `I18nManager.forceRTL()` is called and `Updates.reloadAsync()` reloads the JS bundle so React Native rebuilds the native layout tree in the correct direction.

#### New i18n Strings (en.json)

- `settings.changeEmail` — "Change Email"
- `settings.changeEmailDescription` — "Update your account email address"
- `settings.changeEmailSuccess` — "Email updated. Please verify your new email address."
- `settings.newEmail` — "New Email Address"
- `settings.confirmNewEmail` — "Confirm New Email"
- `settings.sendVerification` — "Send Verification"
- `settings.emailReadOnly` — "Email address cannot be edited here"
- `validation.emailMatch` — "Email addresses do not match."
- `validation.invalidEmail` — "Please enter a valid email address."
- `auth.twoFaVerify.countdownPrefix` — "Try again in"
- `onboarding.contactsError` — "Could not upload contacts. You can continue."

#### New Store Keys Added

`STORE_KEYS` in `lib/offline/store.ts` gains: `SETTINGS_PIN_ATTEMPTS`, `SETTINGS_PIN_LOCKED_UNTIL`, `SETTINGS_PIN_LOCKOUT_COUNT`, `TOTP_LOCKOUT_COUNT`, `GIFT_PIN_LOCKOUT_COUNT`.

---

## Appendix: Version 1.85 Change Log

### v1.85 — Changelog

Comprehensive forensic-audit bug fix pass (55 issues identified; 54 resolved, 1 skipped — see below). Covers the Expo mobile app across security, reliability, performance, correctness, and accessibility dimensions.

#### Critical / High

- **Stars transaction history endpoint (Bug 1):** `app/economy/wallet.tsx` stars tab now calls `/economy/stars/transactions` instead of the balance endpoint, restoring the history list.
- **Duplicate PIN verification logic (Bug 2):** `app/economy/store.tsx` now has a single `verifyPin()` callback replacing the two previously-divergent PIN code paths (auto-submit on 4 digits, manual submit button).
- **`endBillingConnection` stale promise (Bug 4):** `lib/payments/googlePlay.ts` clears `_initPromise = null` alongside `initialised = false` so a subsequent `initGooglePlayBilling()` call gets a fresh promise, not a stale resolved one.
- **`pendingRecovery` lost on restart (Bug 34):** `pendingRecovery` Map is now persisted to SecureStore (key `PENDING_RECOVERY`) with a 72-hour expiry timestamp per entry, and loaded back on `initGooglePlayBilling`. Unacknowledged IAP purchases survive app restarts.
- **`SlugRedirect` infinite re-resolve loop (Bug 23):** `toInternalPath` prop is stored in a ref and excluded from the `useEffect` dependency array, preventing infinite `/public/resolve` calls when callers pass inline arrow functions.
- **Gift-send zero stars balance (Bug 27):** Gift-send screen now parallel-fetches both `/economy/coins/balance` and `/economy/stars/balance` so the stars field is populated correctly.

#### Medium

- **EAS Project ID placeholder in production builds (Bug 5):** `app.config.ts` now throws on missing `EAS_PROJECT_ID` when `APP_VARIANT === 'production'`, falling back to `'dev-placeholder'` in non-production builds only.
- **Non-NGN floating-point currency (Bug 3):** All non-NGN minor-unit → major-unit conversions in `app/economy/store.tsx` now use `new Decimal(kobo).div(100).toFixed(2)`.
- **Duplicate session-expired modal (Bug 11):** `_notifiedUnauthenticated` flag in `lib/api/client.ts` no longer resets via a 5-second `setTimeout`. A new `resetUnauthenticatedFlag()` export is called from auth context on explicit sign-in, ensuring exactly one session-expiry modal per logout cycle.
- **`myUserId` empty-string own-message rendering (Bug 9):** `app/messages/[conversationId].tsx` guards against rendering before auth is ready; `myUserIdOrEmpty` is now correctly defaulted.
- **GameWebView postMessage origin (Bug 22):** Injected JavaScript wraps each postMessage with a `{ __origin, __data }` envelope; the React Native handler validates `__origin` before processing, replacing the page-URL-based check.
- **GameWebView navigation block (Bug 48):** `onShouldStartLoadWithRequest` now intercepts navigation at the request level instead of the `onNavigationStateChange` + `stopLoading()` approach.
- **Notification mark-read optimistic update (Bug 24):** `markReadMutation` in `app/notifications/index.tsx` uses `cancelQueries` + `setQueryData` for optimistic update and rolls back on error, instead of fire-and-forget.
- **Notification route path for gifts (Bug 25):** Gift/gift_received notifications now route to `'/(tabs)/wallet'` (correct) instead of `'/(tabs)/economy/wallet'`.
- **Notification route UUID sanitisation (Bug 55):** All payload IDs are validated against a UUID regex before route string construction in `getNotificationRoute`.
- **Notification pagination (Bug 38):** `app/notifications/index.tsx` migrated to `useInfiniteQuery` with cursor pagination; FlatList triggers `fetchNextPage` via `onEndReached`.
- **Friend toggle API path (Bug 26):** `app/profile/[userId].tsx` now calls `POST /friends` with `{ targetUserId }` body, matching the `ContactsImporter` pattern.
- **Notification toggle debounce (Bug 28):** `app/settings/index.tsx` debounces notification preference PATCH calls 400 ms via `notifDebounceRef`.
- **Delete-account PIN error feedback (Bug 29):** Invalid PIN format on account deletion now sets a visible `deletePinError` state instead of silently returning.
- **DOB keyboard type (Bug 30):** Date-of-birth field uses `keyboardType="numeric"` (was `numbers-and-punctuation`, unreliable on Android).
- **RTL reload before save confirmation (Bug 53):** `I18nManager.forceRTL()` and `Updates.reloadAsync()` are now called inside `patchMutation.onSuccess`, so the RTL reload only fires when the server confirms the language save.
- **TOTP MMKV read during render (Bug 32):** Lockout state in `app/auth/two-factor.tsx` is now read in a deferred `useEffect` guarded by `lockoutInitialized`, preventing synchronous MMKV access during the initial render.
- **Presence heartbeat continues when backgrounded (Bug 35):** Heartbeat interval in `app/rooms/[roomId].tsx` is now managed by `useFocusEffect` so it stops when the screen is out of focus.
- **Gift balance not re-verified after PIN delay (Bug 40):** Gift-send screen invalidates and re-checks the balance query after the PIN modal resolves before firing `sendMutation`.
- **Gift PIN flat lockout (Bugs 45, 46):** Gift-send PIN lockout now uses exponential backoff (15 min × 2^n, capped at 24 h) using the previously-unused `STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT`.
- **Contacts importer re-import duplicates (Bug 49):** `ContactsImporter` tracks a `hasImported` flag and disables the button after first import to prevent duplicate friend requests.
- **Android keyboard / inverted FlatList (Bug 41):** `app.json` sets `softwareKeyboardLayoutMode: "adjustResize"` for Android, ensuring the viewport shrinks on keyboard open and the message input remains visible on API 35 devices.
- **Ad reward server-side cap (Bug 52):** `RewardedAdButton` now handles `429` from `/economy/rewards/ad-reward` by syncing the local MMKV cap to `AD_DAILY_CAP`. The server endpoint must independently enforce the cap per user per day (Redis counter with UTC-midnight TTL) — the client-side MMKV cap is a UX hint only.

#### Low / Accessibility

- **MMKV LRU eviction order (Bug 8):** `lib/chat/messageCache.ts` removes the existing index entry before re-inserting to maintain correct LRU order.
- **Telegram bot name in dev/preview (Bug 13):** `EXPO_PUBLIC_TELEGRAM_BOT_NAME` added to `development` and `preview` EAS profiles.
- **PIN_MAX_ATTEMPTS constant exported (Bug 15):** `lib/hooks/usePinRateLimit.ts` exports `PIN_MAX_ATTEMPTS = 5`; `store.tsx` no longer defines a local copy.
- **Pidgin autocomplete endsWith (Bug 19):** `lower.endsWith(key)` clause removed from `getPidginSuggestions`; only prefix-match is used.
- **Announcement dismiss key collision (Bug 20):** `getSessionKey` now incorporates `modal.id + (modal.version ?? 'v1')`, eliminating collisions from shared content prefixes.
- **RTL reload guard in dev builds (Bug 14):** `Updates.reloadAsync()` in `lib/i18n/index.ts` is wrapped in `Updates.isEnabled` (the correct expo-updates SDK ~0.25.0 / SDK 51 API; `isAvailable` does not exist in this version) and falls back to an informational `Alert` in dev.
- **`__DEV__` guard for push route warnings (Bug 12):** Invalid push route logging is now gated behind `__DEV__` to avoid noise in production.
- **MMKV storage proxy deprecation (Bug 33):** `storage` direct-proxy export in `lib/offline/store.ts` is annotated `@deprecated`.
- **O(n) message ID eviction (Bug 10):** `prevMessageIdsRef` in `app/rooms/[roomId].tsx` is now a `Map<string, true>` allowing O(1) oldest-entry eviction via `map.keys().next().value`.
- **Binary search for delta merge (Bug 43):** `mergeNewestFirst` in `lib/chat/delta.ts` uses binary search insertion instead of O(n log n) full resort.
- **OfflineBanner cold-start state (Bug 44):** `NetInfo.fetch()` is called at mount to immediately reflect offline state before the async event listener fires.
- **OfflineBanner null reachability comment (Bug 50):** Strict `=== false` check is documented to clarify that `null` (unknown state) is treated as connected.
- **SwipeDrawer state desync (Bug 36):** `setIsOpen` in `components/layout/SwipeDrawer.tsx` is now called only in the `withSpring` completion callback when `finished === true`, preventing desync between Reanimated shared value and React state.
- **TOTP duplicated lockout logic (Bug 51):** `handleFailedAttempt` extracted from two catch blocks in `app/auth/two-factor.tsx`.
- **`accessibilityHint` on RewardedAdButton (Bug 16 partial):** Main `TouchableOpacity` now has `accessibilityHint`.
- **FlatList `accessibilityLabel` (Bug 47):** Room messages, DM conversation, and notification list FlatLists now have descriptive `accessibilityLabel` props for TalkBack.

#### Skipped

- **Bug 42 — Pidgin dictionary offensive terms:** Intentionally skipped per product team decision.

---

## Appendix: Version 1.86 Change Log

### v1.86 — Changelog

#### Android 15 (API 35) White-Screen Fix

> **Correction (v1.89):** This section previously said "Android 16 (API 36)". The actual `expo-build-properties` config in `app.json` sets `targetSdkVersion: 35` (Android 15), NOT 36. The SDK-level references below have been corrected.

Resolved a permanent blank white screen that appeared after the splash screen on Android 15 (API 35) devices when running non-production EAS builds (preview / staging). Three independent root causes were identified and fixed:

- **Android SDK 35 forced edge-to-edge enforcement (primary cause):** Android 15 (API 35) and later force every app into full-screen edge-to-edge window mode regardless of whether the app handles insets. Apps not adapted for this end up with the root view sized or positioned incorrectly, rendering a blank white screen. The XML opt-out attribute `android:windowOptOutEdgeToEdgeEnforcement` was initially added via a config plugin but was subsequently removed because the EAS build image's AAPT2 cannot find the attribute in its `android.jar`, causing a build failure. The correct approach is to embrace edge-to-edge and rely on `react-native-safe-area-context` for proper inset handling. The `apps/expo/plugins/withAndroidEdgeToEdge.js` file is retained in the repo for reference but is not registered in `app.json`.

- **`return null` loading state exposed white background:** While `isLoading` (auth) or `!storeReady` (MMKV) was true, `RootLayoutNav` returned `null`, leaving the GestureHandlerRootView empty after the splash screen hid (which the edge-to-edge enforcement caused to happen earlier than expected). Fixed by replacing `null` with an `ActivityIndicator` spinner on a white background, matching the splash colour so the transition is seamless.

- **`DebugOverlay` hidden behind Android navigation bar:** The floating debug badge was anchored to `bottom: 70/90`, which placed it behind the system navigation bar on various Android navigation modes (gesture nav, 3-button, API 35 edge-to-edge). Fixed by moving the badge to `top: topOffset` (using safe area insets via `useSafeAreaInsets`), where it is always visible. `SafeAreaProvider` was hoisted above `RootErrorBoundary` in `_layout.tsx` so `DebugOverlay` (a sibling of `RootErrorBoundary`) inherits insets context without needing its own provider.

#### Documentation Corrections (v1.86)

- **`app.config.ts` → `app.config.js`:** References to `app.config.ts` in BUG-REL-10 and Bug 41 corrected to `app.config.js` / `app.json`. The dynamic Expo config file uses the `.js` extension in this codebase; there is no `.ts` variant.
- **OTA runtimeVersion policy corrected:** BUG-SEC-07 previously stated `"policy": "sdkVersion"`. The actual `app.json` uses `"policy": "fingerprint"`. Entry updated to reflect the correct value and clarify what fingerprint-based versioning means.

---

## Appendix: Version 1.87 Change Log

### v1.87 — Changelog

#### Android APK Build Fix — Duplicate i18n Keys

Resolved an Android release build failure caused by duplicate property keys in `apps/expo/lib/i18n/locales/en.json`. The Kotlin/JS bundler treats duplicate object keys as an error during release compilation.

**Root cause:** `en.json` contained two separate blocks defining the same friend-request translation keys, introduced when a more complete second block was added without removing the original. The duplicated keys were:

- `friends.requests.received`
- `friends.requests.sent`
- `friends.requests.withdraw`
- `friends.empty.noReceivedRequests`
- `friends.empty.noSentRequests`

**Fix:** The first (older, less complete) block was removed. The retained second block includes the additional `friends.requests.withdrawing` key and uses the more descriptive string values (`"No received friend requests."`, `"No sent friend requests."`).

No runtime behaviour change — the final resolved strings are identical to what the app displayed before in any locale that was already using the second block's values.

---

## Appendix: Version 1.88 Change Log

### v1.88 — Changelog

#### Android APK White-Screen (Root Cause Chain) — Full Resolution

This version closes the multi-root-cause chain that produced a permanent white screen after
the splash, with no debug chip and no native alert, on Android API 35 release/preview builds.

---

##### Root cause 1 — `SafeAreaProvider` null-child guard (fixed in v1.85 / PR #403)

`react-native-safe-area-context` 4.10.x renders `{insets != null ? children : null}`. On
Android SDK 35 with edge-to-edge enforcement the native inset callback can be delayed or
never fire, so the provider stays on `null` and the entire tree (including `DebugOverlay`
and `RootErrorBoundary`) is never rendered — white screen, no chip, no red box.

**Fix:** pass `initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}` to
`SafeAreaProvider` so `insets` is non-null on the very first render.

---

##### Root cause 2 — `expo-updates` native controller gating the JS bundle (fixed PR #404)

`expo-updates` owns `getJSBundleFile()` in release builds. If the controller cannot resolve
a launchable bundle (runtime-version mismatch, malformed config) it returns nothing — JS
never runs, splash fades, permanent white screen, no chip, no alert.

The config was also malformed: `runtimeVersion` and `projectId` were passed as _plugin
props_ (`["expo-updates", { "projectId": "...", "runtimeVersion": ... }]`). The
`expo-updates` config plugin ignores plugin props for these fields; they must be top-level
Expo config keys. So the effective `runtimeVersion` was unset, causing the controller to
fail every bundle resolution.

**Fix:**
- Top-level `"updates": { "enabled": false }` and `"runtimeVersion": "1.0.0"` in
  `app.json` so the updates controller is bypassed and React Native loads the embedded
  bundle directly.
- Replace `["expo-updates", { … }]` with the plain string `"expo-updates"` in the plugins
  list.

**RULE FOR FUTURE WORK:** `expo-updates` top-level config keys (`runtimeVersion`, `updates`,
`projectId`) belong at the `expo.*` level in `app.json`, NOT inside plugin props. Plugin
props for `expo-updates` are only for native-only settings like `launchWaitMs`.

---

##### Root cause 3 — React import order causes null crash in Hermes (fixed PR #406)

After the two fixes above, logcat still showed a crash at 12ms after "Running main":

```
TypeError: Cannot read property 'useMemo' of null
```

**Root cause:** In Hermes, ES `import` statements compile to CommonJS `require()` calls
executed in _source-file order_. `app/_layout.tsx` had NativeWind (`global.css`) at
position 2 and `expo-router` at position 3, both **before** `import … from 'react'` at
position 4. NativeWind and expo-router access React internals (e.g. `useMemo`) during their
own module evaluation. Because React hadn't been required yet at that point, the CommonJS
module cache still held `null` for `'react'` — crash.

**Fix 1 — import order in `app/_layout.tsx`:**
```ts
import '@/lib/polyfills';                    // 1. polyfills (always first)
import { useEffect, ... } from 'react';      // 2. React (MUST be before NativeWind)
import { ..., Dimensions, ... } from 'react-native'; // 3. React Native
import '../global.css';                      // 4. NativeWind (now gets initialised React)
export { ErrorBoundary } from 'expo-router'; // 5. expo-router (same)
```

**Fix 2 — `resolveRequest` in `metro.config.js`:**
Replace `extraNodeModules` with a `resolveRequest` hook that intercepts _every_ resolution
call (including nested requires inside node_modules) and pins `'react'` and `'react-native'`
to a single physical path. `extraNodeModules` only covers top-level resolution and can be
bypassed by nested requires from within packages.

**RULE FOR FUTURE WORK:**
- In any Expo/React Native entry file, `import 'react'` and `import 'react-native'` MUST
  appear before any library that wraps React (NativeWind CSS imports, expo-router,
  react-navigation, etc.).
- Use `resolveRequest` in `metro.config.js` to deduplicate React in monorepos; do NOT rely
  on `extraNodeModules` alone.

---

##### How to diagnose a white-screen-no-chip failure

The absence of the `EXPO_PUBLIC_DEBUG_OVERLAY=1` chip proves React never mounted. Work
backwards through the layers:

1. **Check logcat** for `AndroidRuntime` / `FATAL EXCEPTION` / `Running main`. A JS crash
   at < 100ms after "Running main" is a module-evaluation error (import order, dual React).
2. **Check expo-updates**: is it enabled? Does the manifest runtime version match the
   controller's expectation? Disable OTA (`"updates": { "enabled": false }`) to rule it out.
3. **Check import order** in the entry layout: polyfills → React → React Native → NativeWind
   → everything else.
4. **Check metro.config.js**: does `nodeModulesPaths` list multiple node_modules roots? If
   so, add a `resolveRequest` hook to deduplicate `'react'` and `'react-native'`. Crucially,
   also cover `react/jsx-runtime` and `react/jsx-dev-runtime` — React 18's automatic JSX
   transform imports these as separate module strings, bypassing a `'react'`-only intercept
   and allowing a second React instance to be loaded just for JSX rendering.
5. **Check for a stray `react-native` in the root `devDependencies`.** If the root
   `package.json` lists a different `react-native` version than `apps/expo/package.json`,
   npm installs two copies. Subpath imports such as `react-native/Libraries/AppRegistry`
   bypass the `resolveRequest` hook and load from whichever copy `nodeModulesPaths` resolves
   first — potentially the wrong one. Remove the root-level entry and rely on the version
   declared inside `apps/expo/package.json` only.
6. **Check babel.config.js**: does the expo-router Babel plugin load silently as `undefined`?
   If `expoRouterBabelPlugin` is not found and Babel ignores the `undefined` entry,
   `EXPO_ROUTER_APP_ROOT` is never inlined and `require.context(undefined, ...)` fails at
   runtime — `AppRegistry` never registers, n=0.

---

##### Android SDK version config rule (from v1.86)

`android.compileSdkVersion`, `android.targetSdkVersion`, and `android.minSdkVersion` are
**NOT** valid top-level Expo Android config keys — Expo silently ignores them. The only
supported way to set Android SDK levels in an Expo prebuild project is the
[`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/)
plugin. Always configure SDK levels via:

```json
["expo-build-properties", { "android": { "compileSdkVersion": 35, "targetSdkVersion": 35, "minSdkVersion": 24 } }]
```

---

---

## Appendix: Version 1.89 Change Log

### v1.89 — Changelog

#### AppRegistry n=0 White-Screen Fix (Root Cause Chain Continued)

After the fixes in v1.88, the app still crashed on launch with:

```
Invariant Violation: Failed to call into JavaScript module method AppRegistry.runApplication().
Module has not been registered as callable. Bridgeless Mode: false.
Registered callable JavaScript modules (n = 0):
```

This error means `AppRegistry.registerComponent` was never called — the JS bundle evaluated
but expo-router never registered the root component. Three new root causes were identified:

---

##### Root cause 4 — `react/jsx-runtime` and `react/jsx-dev-runtime` bypass Metro deduplication (fixed)

The `resolveRequest` hook in `metro.config.js` intercepted `'react'` and `'react-native'`
but not the JSX runtime paths. React 18 uses the automatic JSX transform: every file with
JSX compiles to imports of `'react/jsx-runtime'` (prod) or `'react/jsx-dev-runtime'` (dev)
rather than calling `React.createElement` directly. These are separate module strings that
bypassed the `'react'` intercept entirely. If Metro resolved them from a different physical
React copy than the one pinned by the hook, two React internal registries existed in the same
bundle — hooks crossed the registry boundary and `AppRegistry` registration failed silently.

**Fix (`metro.config.js`):** Extended the `resolveRequest` hook to also cover
`react/jsx-runtime` and `react/jsx-dev-runtime`, pointing both to the same `REACT_PATH`
that already governs `'react'` itself.

```js
if (moduleName === 'react/jsx-runtime') {
  return { filePath: path.join(REACT_PATH, 'jsx-runtime.js'), type: 'sourceFile' };
}
if (moduleName === 'react/jsx-dev-runtime') {
  return { filePath: path.join(REACT_PATH, 'jsx-dev-runtime.js'), type: 'sourceFile' };
}
```

---

##### Root cause 5 — Unguarded expo-router Babel plugin import in `babel.config.js` (fixed)

`babel.config.js` imported the expo-router Babel plugin via:

```js
require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
```

If `expoRouterBabelPlugin` is `undefined` (e.g. after a `babel-preset-expo` upgrade renames
the export), Babel silently skips the `undefined` entry. `process.env.EXPO_ROUTER_APP_ROOT`
is never inlined in `expo-router/_ctx.*.js`, so Metro's `require.context` transform rejects
the non-string argument, expo-router cannot build the route tree, and `AppRegistry.registerComponent`
is never called — n=0 crash, even though the build succeeds.

**Fix (`babel.config.js`):** Wrapped the plugin import in an IIFE that validates the export
is a function. If it is not found, it tries the `expo-router/babel` fallback (SDK 52+).
If neither path works, it throws a descriptive error **at build time** so the APK is never
shipped with a broken bundle:

```js
(() => {
  const mod = require('babel-preset-expo/build/expo-router-plugin');
  if (typeof mod.expoRouterBabelPlugin === 'function') return mod.expoRouterBabelPlugin;
  // fallback for SDK 52+
  const p = require('expo-router/babel');
  if (typeof p === 'function') return p;
  if (typeof p?.default === 'function') return p.default;
  throw new Error('[babel.config.js] expo-router Babel plugin not found — EXPO_ROUTER_APP_ROOT will not be inlined, causing n=0 at runtime.');
})()
```

---

##### Root cause 6 — Stray `react-native@0.74.0` in root `devDependencies` (fixed)

The root `package.json` declared `"react-native": "0.74.0"` in `devDependencies`, while
`apps/expo/package.json` uses `react-native@0.74.5`. npm installed both, placing
`react-native@0.74.0` at the workspace root and `react-native@0.74.5` inside
`apps/expo/node_modules`. Metro's `nodeModulesPaths` lists both roots, so subpath imports
such as `react-native/Libraries/AppRegistry` could resolve from the wrong version (0.74.0)
while the main `react-native` import resolved from 0.74.5 — two distinct copies of
React Native's internal registry in the same bundle.

**Fix (`package.json` root):** Removed `"react-native": "0.74.0"` from root
`devDependencies`. The single canonical copy is now `react-native@0.74.5` inside
`apps/expo/node_modules`, consistent with what the `resolveRequest` hook already pins.

---

#### Additional Bug Fixes (v1.89)

- **`Updates.isAvailable` wrong API (`lib/i18n/index.ts`):** expo-updates SDK ~0.25.0 (Expo SDK 51)
  does not expose an `isAvailable` property — the correct API is `Updates.isEnabled`. The
  `languageChanged` handler was guarded by `Updates.isAvailable` which was always `undefined`
  (falsy), so the RTL layout reload after switching to Arabic was silently never triggered.
  Fixed: changed to `Updates.isEnabled` and made the `expo-updates` import lazy (moved to a
  `require()` inside the handler) so the module is not evaluated at i18n module init time.

- **Duplicate `import '@/lib/i18n'` removed (`app/_layout.tsx`):** Line 44 imported
  `applyStoredLanguagePref` from `@/lib/i18n`, which evaluates the module. Line 48 had a
  redundant side-effect `import '@/lib/i18n'` — a no-op since the module was already cached,
  but a source of confusion and a maintenance hazard. The duplicate was removed.

---

#### Documentation Corrections (v1.89)

- **Android API level corrected throughout:** Multiple sections previously stated
  "Android 16 (API 36)" or "Target Android API Level 36". The actual `expo-build-properties`
  config in `app.json` uses `targetSdkVersion: 35` (Android 15). All references corrected.
- **`Updates.isAvailable` → `Updates.isEnabled`:** v1.85 changelog entry for Bug 14 corrected
  to reflect the proper expo-updates SDK 51 API.

---

---

## Appendix: Version 1.90 Change Log

### v1.90 — Changelog

#### AppRegistry n=0 White-Screen Fix (Root Cause Chain Continued)

After the v1.89 fixes, a fresh device logcat still showed the same launch crash:

```
Invariant Violation: Failed to call into JavaScript module method AppRegistry.runApplication().
Module has not been registered as callable. Bridgeless Mode: false.
Registered callable JavaScript modules (n = 0):
```

The native side is fully healthy in the trace — Hermes and every `.so` load,
ExpoModulesCore initialises, view managers register — and only then does the JS
bundle fail. `n = 0` means the bundle threw at the very top, before React Native
finished registering its bridge modules. This is the same family of failure as
v1.88/v1.89, with a previously-missed cause.

---

##### Root cause 7 — React pinned to 18.3.1 via root `overrides` forced into the Expo bundle (fixed)

The root `package.json` declared a global override:

```json
"overrides": { "react": "18.3.1", "react-dom": "18.3.1", "scheduler": "0.23.2" }
```

npm `overrides` are **global to the workspace** — they ignore the per-package
`react: 18.2.0` that `apps/expo` declares for React Native 0.74.5. A plain
`npm install` therefore resolves React `18.3.1` into the Expo subtree, and the
`metro.config.js` dedup hook (correctly pinning to "a single React") then pins
every import to that wrong `18.3.1` copy. RN 0.74's renderer reads mismatched
React internals at init and throws before `AppRegistry` is registered → n=0,
silent white screen, no debug chip.

The override had also **drifted out of sync with the lockfile** (the committed
`package-lock.json` only pinned `scheduler`), so the bug was latent: builds using
the existing lockfile happened to get `18.2.0`, while any environment that
re-ran `npm install` got the broken `18.3.1` layout. This non-determinism is why
the crash appeared to come and go across rebuilds.

**Fix (`package.json` root):** Removed `react` and `react-dom` from `overrides`,
leaving only `scheduler` (compatible with both React copies). `package.json` now
matches the lockfile, which already nests the two versions correctly (web
`18.3.1`, expo `18.2.0`). The web app is **not** downgraded. This is the same
lesson as v1.89's root cause 6 (a stray root `react-native`), applied to React
itself: the canonical Expo React lives only in `apps/expo/node_modules`.

**Fix (`metro.config.js`) — fail-loud guard:** Added a build-time assertion that
throws if the resolved React is not `18.2.x`, converting a silent white-screen
APK into an obvious build failure:

```js
const RESOLVED_REACT_VERSION = require(path.join(REACT_PATH, 'package.json')).version;
if (!/^18\.2\./.test(RESOLVED_REACT_VERSION)) {
  throw new Error('[metro.config.js] resolved react@' + RESOLVED_REACT_VERSION +
    ' but react-native@0.74.5 requires react@18.2.x — would cause AppRegistry n=0.');
}
```

---

##### Root cause 8 — `unstable_enablePackageExports` footgun removed (hardening)

`metro.config.js` set `config.resolver.unstable_enablePackageExports = true` to
support `@zobia/shared` subpath imports. On Expo SDK 51 this flag is opt-in and
"unstable": it globally changes module resolution for **every** package and is a
known cause of broken release bundles when native libraries ship malformed
`exports` maps (a mis-resolved module throws at init → n=0). The Expo app only
imports `@zobia/shared/types` and `@zobia/shared/utils`, both plain directory +
`index.ts` subpaths that resolve under Metro's **standard** resolution. The
remapped exports (e.g. `@zobia/shared/schemas/auth` → `schemas/api/auth.ts`) are
used only by the web app, which has its own bundler.

**Fix (`metro.config.js`):** Removed the `unstable_enablePackageExports` flag,
returning to the SDK 51 default. Shared imports still resolve; the global
resolution footgun is gone.

---

#### Diagnostics Guidance (v1.90)

Non-production EAS builds were being used to chase this crash, and a release APK
swallows the real JS error as a blank screen. To break the guess cycle, build the
**`development`** EAS profile (`developmentClient: true`, non-minified bundle with
a red box) — `eas build --profile development --platform android` — so any
remaining top-level init error surfaces an actual stack trace instead of a white
screen. The new `metro.config.js` guard also surfaces the React-version variant of
this failure at build time.

---

---

## Appendix: Version 1.91 Change Log

### v1.91 — Changelog

#### AppRegistry n=0 White-Screen Fix (the actual root cause: duplicate `react-native`)

After v1.90 (which removed the React `overrides` landmine and added a build-time
React-version guard), a fresh device build **still** crashed identically:

```
Invariant Violation: Failed to call into JavaScript module method AppRegistry.runApplication().
Module has not been registered as callable. Bridgeless Mode: false.
Registered callable JavaScript modules (n = 0):
```

The v1.90 guard passing proves React resolved correctly to 18.2.0 — so React
duplication was **not** the live cause. The decisive detail is `n = 0`: not even
React Native's own core modules (`AppRegistry`, `RCTDeviceEventEmitter`,
`JSTimers`) registered. That is the fingerprint of **two copies of
`react-native` in one bundle** → two `BatchedBridge` instances → the native side
calls into bridge A while the JS registers `AppRegistry` on bridge B, so native
sees zero callable modules and the launch aborts.

---

##### Root cause 9 — Stale lockfile shipped a duplicate `react-native`, and the Metro hook only pinned the bare specifier (fixed)

Two compounding problems:

1. **Stale `package-lock.json`.** v1.89 removed `react-native` from the root
   `package.json`, but the lockfile was never regenerated. The committed lockfile
   therefore still carried a phantom root `node_modules/react-native@0.74.0`
   **and** resolved `apps/expo/node_modules/react-native` to `0.74.0` even though
   `apps/expo/package.json` declares `0.74.5`. `npm ci` (used by EAS) installs
   exactly what the lockfile says, so every build got two react-native copies.

2. **Bare-specifier-only Metro dedup.** The `resolveRequest` hook in
   `metro.config.js` pinned only the exact strings `'react'` and `'react-native'`.
   React Native's own internals and hoisted RN libraries import deep subpaths
   such as `react-native/Libraries/BatchedBridge/BatchedBridge` and
   `react-native/Libraries/ReactNative/AppRegistry`. Those bypassed the bare
   intercept and resolved from whichever `node_modules` came first in
   `nodeModulesPaths` — pulling the second (root) copy into the bundle.

**Fix (`metro.config.js`):** The `resolveRequest` hook now pins `react`,
`react-native`, **and all of their subpaths** to the single canonical copy in
`apps/expo`. It rewrites each `react/*` and `react-native/*` request to an
absolute path inside the canonical package and delegates to Metro's default
resolver, so platform extensions (`.android.js` / `.native.js`), Haste, and
asset handling still apply correctly:

```js
const pinToCanonical = (context, moduleName, platform, pkg, baseDir) => {
  const subpath = moduleName === pkg ? '' : moduleName.slice(pkg.length);
  return context.resolveRequest(context, baseDir + subpath, platform);
};
// react + react/<subpath>
if (moduleName === 'react' || moduleName.startsWith('react/')) {
  return pinToCanonical(context, moduleName, platform, 'react', REACT_PATH);
}
// react-native + react-native/<subpath>  (react-native-* and @react-native/* are left alone)
if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
  return pinToCanonical(context, moduleName, platform, 'react-native', REACT_NATIVE_PATH);
}
```

**Fix (`package-lock.json`):** Regenerated the lockfile (`npm install
--package-lock-only`) so it matches `package.json`. `apps/expo` now correctly
resolves `react-native@0.74.5` (was `0.74.0`). A transitive `react-native@0.74.0`
remains in the root tree (pulled by RN CLI tooling), but the subpath dedup above
guarantees it can never enter the Expo bundle.

**Rule for future work:** A monorepo React/React Native dedup hook MUST cover
subpaths (`pkg` and `pkg/*`), not just the bare specifier — deep imports are the
exact path a second copy uses to slip in. And after any change to a dependency in
`package.json`, **regenerate the lockfile** so `npm ci`/EAS installs what you
actually declared.

---

---

## Appendix: Version 1.92 Change Log

### v1.92 — Changelog

#### EAS Gradle build fix — restore the `react-native-google-mobile-ads` key in `app.json`

A cleanup that removed the root-level `react-native-google-mobile-ads` key from `app.json`
(to silence the Expo warning *"Ignoring extra key in Expo config:
react-native-google-mobile-ads"*) broke the native build:

```
* Where: node_modules/react-native-google-mobile-ads/android/build.gradle line: 82
> Cannot get property 'googleMobileAdsJson' on extra properties extension as it does not exist
...
> compileSdkVersion is not specified. Please add it to build.gradle   (cascading failure)
```

**Root cause:** there are two independent consumers of that key. (1) The Expo config schema
ignores it because it sits beside the `expo` object — hence the warning. (2) The
`react-native-google-mobile-ads` Gradle script reads it **directly from `app.json` via a
`JsonSlurper`**, and requires it to exist. The warning is a false positive; the key is
load-bearing for the native build.

**Fix:** restored the root-level `react-native-google-mobile-ads` key in `app.json`. The
redundant (and genuinely ignored) duplicate block in `app.config.js` stays removed — the
Gradle slurper reads `app.json`, never the evaluated `app.config.js` output, so that block
never reached the build. Section 22.0.1 rule 4 was corrected (it had stated the key must
*not* be in `app.json`, which is what triggered the bad cleanup).

---

## Appendix: Version 1.93 Change Log

### v1.93 — Changelog

#### Android App — Google OAuth Cookie Fix (Issue #2)

**Root cause:** The Expo app was fetching `/api/auth/google?platform=mobile&redirect=...` via Axios and then opening the returned Google URL in a Chrome Custom Tab. Axios has no persistent cookie jar on Android, so the `zobia_csrf_state` and `zobia_mobile_redirect` cookies set in that response were never stored in the browser's cookie store. When Google redirected back to `/api/auth/google/callback`, the Custom Tab sent no cookies, causing the CSRF check to fail with a `session_expired` error. The user was bounced to the web error page and ended up logging into the web version instead of the app.

**Fix:**
- The Expo login screen now opens `/api/auth/google?platform=mobile&redirect=<deep-link>` **directly** inside `WebBrowser.openAuthSessionAsync`. The Custom Tab (Chrome) navigates to this URL itself, receives and stores the Set-Cookie headers natively, and carries them to the callback — exactly as a normal browser would.
- The server's `GET /api/auth/google` route now always responds with a `302` redirect to Google (removing the JSON response special-case for mobile). Both web and mobile flows use the same redirect pattern; the `mobileRedirect` cookie distinguishes them in the callback.
- `ALLOWED_REDIRECT_SCHEMES` updated to include `exp+zobia:` and `exp+zobia-social:` so Expo Go development builds can also complete the OAuth flow.
- `WebBrowser.warmUpAsync()` called on login screen mount for faster Chrome Custom Tab startup on Android.

#### Android App — Session Expired on Startup (Issue #1) and Sign-In Button Navigation

**Problem 1 — Session expired modal on fresh open:** When a server-side session was evicted (e.g. after a server restart or explicit invalidation), the stored JWT was still valid as a signed token. The app restored the user from SecureStore, the home tabs mounted and made their first API call, which returned 401. The `notifyUnauthenticated()` path set `sessionExpired: true`, causing the "Session Expired" modal to appear immediately — even on a fresh install with no prior session.

**Fix:** `AuthProvider` now tracks `hasBeenAuthenticatedRef`. The `sessionExpired` modal is only set to `true` in the `onUnauthenticated` handler when the user was previously authenticated in this session. For truly fresh installs (no stored tokens), `notifyUnauthenticated()` is never called during startup, so the modal never fires.

**Problem 2 — "Sign In" button in modal does nothing:** The `auth/login` screen had `presentation: 'modal'`, causing it to slide up from the bottom as a sheet. When the `SessionExpiredModal` (a React Native `Modal` overlay) was dismissed, the login sheet was behind it but not obviously visible. Additionally, `handleSignIn()` called `router.replace('/auth/login')` while already on that screen, which is a no-op.

**Fix:**
- `auth/login` screen presentation changed from `'modal'` to a standard full-screen card.
- `SessionExpiredModal.handleSignIn()` now only calls `clearSessionExpired()` — the auth gate in `_layout.tsx` already navigates to `/auth/login` when `user` becomes `null`.

#### Android App — Google Button UI (Issue #4)

The Google sign-in button now uses a styled native `TouchableOpacity` with an inline Google "G" logo (multi-colour ring) matching the standard Google sign-in button specification, instead of a plain `Ionicons logo-google` icon that rendered as a simple text-style glyph on some Android devices.

#### Android App — "Don't have an account? Sign up" (Issue #5)

Added a "Don't have an account? Sign up." row below the auth buttons on the login screen. Tapping "Sign up" triggers the native Google OAuth flow (same as "Continue with Google") — no web browser redirect. Google OAuth handles account creation on first sign-in: if no matching account exists the backend creates one automatically. The old behaviour (opening `/auth/register` in an external browser) has been removed. The `auth.signUp` i18n key remains for the link label.

#### Debug Overlay — Export Button (Issue #3)

Added an "⬆ Export" button to the debug overlay panel (alongside Clear and Close). Tapping it invokes `Share.share()` with all captured log entries formatted as timestamped text, allowing developers to copy or share the full log without needing a Metro/CLI connection.

#### Pre-existing Bug Fix — Missing `displayName` in Mobile Auth Token

`/api/auth/google/callback` was not including `displayName` in the `authUser` payload stored in the Redis mobile exchange code. The `AuthUser` interface requires `displayName: string`. Fixed: `displayName: user.display_name ?? user.username ?? ""` is now included in the payload.

#### `auth.signUp` i18n key added

New key `"auth.signUp": "Sign up"` added to both `apps/expo/lib/i18n/locales/en.json` and `apps/web/lib/i18n/locales/en.json`. New key `"debug.exportLogs": "Export logs"` added to the Expo locale file.

---

## Appendix: Version 1.94 Change Log

### v1.94 — Changelog

#### Android — Notification Permission Requested at Install (Issue #1 — Permissions)

Previously, the `POST_NOTIFICATIONS` permission dialog (required on Android 13+ / API 33+) was only triggered after the user completed Google OAuth and a user session was established. On a fresh install, the dialog never appeared, leaving notifications disabled.

**Fix:** A new `useEffect` in `_layout.tsx` fires as soon as `storeReady` is true (immediately after MMKV initialises). It calls `Notifications.getPermissionsAsync()` and, if the status is `undetermined`, calls `Notifications.requestPermissionsAsync()`. This shows the system dialog on first launch, before login. The full push-token registration (`registerForPushNotifications()`) still fires after login as before, since the Expo push token requires an authenticated user to associate with.

#### Android — SQLite Offline Queue: `crypto.subtle` Removed (Issues #4b, #4c)

**Root cause:** `lib/offline/sqlite.ts` used `crypto.subtle.importKey`, `crypto.subtle.encrypt`, and `crypto.subtle.decrypt` for AES-256-GCM at-rest encryption. `crypto.subtle` is part of the Web Crypto API and is **not available in Hermes** (the React Native JS engine). Only `crypto.getRandomValues` and `crypto.randomUUID` are polyfilled via `expo-crypto`. The missing API caused:
- `[offline] SQLite offline-queue init failed TypeError: Cannot read property 'importKey' of undefined`
- `[offline:sync] Sync failed Error: Offline DB not initialised — call initOfflineDB() first`

**Fix:**
- Added `@noble/ciphers: "^2.2.0"` to `apps/expo/package.json`.
- `lib/offline/sqlite.ts` fully rewritten: all `crypto.subtle` calls replaced with `gcm()` from `@noble/ciphers/aes` (pure JavaScript, no native dependencies). The encryption key is stored as a raw base64 `Uint8Array` in SecureStore instead of a `CryptoKey`. The wire format (`v1:${base64url(iv)}.${base64url(ciphertext)}`) is unchanged — existing encrypted rows migrate automatically.
- Added `isOfflineDBReady()` export from `sqlite.ts`.
- `lib/offline/syncQueue.ts` now calls `isOfflineDBReady()` at the start of `syncPendingMessages()` and returns early if the DB is not yet initialised, eliminating the race condition with the NetInfo reconnection event.

#### Android — Google OAuth Returns 302 Redirect Instead of JSON (Issue #2)

The deployed Vercel backend was an older version returning `{"url":"..."}` JSON for `GET /api/auth/google`. The repo code already contained the correct fix (a `302` redirect directly to Google). This release includes that server-side fix so the Custom Tab follows the redirect instead of displaying raw JSON.

#### Android — Sign-Up Triggers Native Google OAuth (Issue #3)

Tapping "Sign up" on the Android login screen previously called `Linking.openURL(API_BASE_URL + '/auth/register')`, opening the web app in an external browser. The fix changes `onPress` to call `handleGoogleLogin()` so the sign-up flow uses the native Chrome Custom Tab OAuth flow — matching how most modern apps handle first-time account creation via Google. The backend creates the account automatically when it sees a new Google subject ID.

#### Android — i18next Intl.PluralRules Warning (Issue #4d)

`compatibilityJSON: 'v4'` in `lib/i18n/index.ts` requires `Intl.PluralRules`, which is absent in Hermes on some Android versions. Changed to `compatibilityJSON: 'v3'`, which uses i18next's built-in plural resolver (no `Intl` API required). All existing translation strings already use the v3 plural suffix convention.

#### Android — Daily Login XP 401 (Issue #4a)

The daily-login `useEffect` in `app/(tabs)/index.tsx` was firing with empty `[]` dependencies, meaning it executed on the very first mount of the home tab — which can happen for one frame before the auth gate redirect fires (the auth gate is in a `useEffect`, not synchronous). This sent a `POST /api/gamification/daily-login` with no auth token, resulting in a 401.

**Fix:** `user?.id` added as the sole dependency; a guard `if (!user?.id) return;` is added at the top of the effect. The mutation only fires once a valid authenticated user is confirmed.

#### i18n — New `home.dailyLoginXP` String

Added `"home.dailyLoginXP": "Daily login: +{{xp}} XP"` to both `apps/expo/lib/i18n/locales/en.json` and `apps/web/lib/i18n/locales/en.json`. This string is displayed in the home screen toast when the daily XP reward is first awarded.

---

## Appendix: Version 1.95 Change Log

### v1.95 — Changelog

#### Friends Page — New Request Blue Dot, Clickable Profiles, Recent Chats Tab

- **New friend request indicator.** `POST /api/friends` now writes an unread `notifications` row (`type: 'friend_request'`) to the addressee via the existing `insertNotification()` helper (`lib/notifications/insert.ts`). The Friends page (`/friends`) checks `GET /api/notifications?type=friend_request&unread=true&limit=1` on load and renders a small blue dot on the **Requests** tab when one exists. Opening the Requests tab calls `POST /api/notifications/read-all` with `{ "type": "friend_request" }`, clearing only friend-request notifications (a `type` filter was added to the read-all route, backward compatible — omitting `type` still marks everything read as before).
- **Clickable friend rows.** Every avatar/name across My Friends, Requests (Received + Sent), Discover, and the new Recent tab now links to `/profile/:userId`, using the shared `Avatar` component (`components/ui/Avatar.tsx`) instead of a page-local emoji-circle implementation.
- **New "Recent" tab (🕐).** Shows people the user has recently direct-messaged, most-recent-first, reusing the existing `GET /api/messages/dm` conversation list (no new table or endpoint) — the same data that already powers the Messages inbox. Each row links to the sender's profile and to the DM conversation.
- **i18n:** the page's static strings were wired up to the `friends.*` keys already present in `apps/web/lib/i18n/locales/en.json` (they existed but the component had never been migrated off hardcoded English). New keys added: `friends.tabs.recent`, `friends.newRequestBadge`, `friends.recent.empty`, `friends.recent.emptyHint`, `friends.recent.message`.

#### Gifts — Fixed 500 Error on `/gifts` and Gifts Hub History

`GET /api/economy/gifts` joined `gift_types gt ON gt.id = gi.gift_type_id`, but `gift_type_id` was added to the `gifts` table by migration `0001_consolidated_schema.sql` — not to `gift_items` (aliased `gi` in this query). Every call threw `column gi.gift_type_id does not exist`, so the `/gifts` page and both Received/Sent history tabs always showed "An unexpected error occurred." Fixed the join to reference `g.gift_type_id` (the `gifts` row alias), matching the working join in `/api/economy/gifts/send`.

#### Gifts — Fixed "Gift" Button Leading to "User Not Found"

The profile page's 🎁 Gift button linked to `/gift/:userId`, which called two API routes that were never implemented in this codebase: `GET /api/users/:userId/public` and `GET /api/economy/gift-items`. Every visit to this page showed "User not found," regardless of whether the target user existed. Rather than re-implement a second, parallel gift-sending flow, `/gift/:userId` now resolves the target's username via the existing `GET /api/users/:userId` endpoint and redirects to `/gifts?recipientId=<id>&username=<name>` — handing off to the fully-featured Gifts Hub send flow (catalogue browsing, wallet balance, PIN verification) that already exists and is exercised from `/gifts` itself. The profile page's Gift button now links directly to `/gifts?recipientId=...&username=...`, skipping the extra redirect hop; the `/gift/:userId` route is kept (now working) for external deep links (share cards, `zobia://gift/:userId`).

#### Gifts — More Prominent "Browse Gift Catalog"

On `/gifts`, "Browse gift catalog" was a bare underlined text link next to the primary "🎁 Send a Gift" button. It now renders as a secondary button (same style as the page's other secondary actions, e.g. the history list's "Retry" button) so it reads as a real action rather than fine print.

**Note:** none of the above are ported to the Capacitor Android app yet — `apps/android/src/routes/` has no `friends.tsx` or `gifts.tsx` today, so this release is web/PWA only. See `docs/HOW-IT-WORKS.md` § Android App for the current screen coverage list.

---

## Appendix: Version 1.96 Change Log

### v1.96 — Changelog

#### New Feature: Answers — Mini Forum (Q&A)

Added a Reddit-style community Q&A feature (§31): users ask questions
(gated by an admin-configurable minimum level, default Level 2), others
answer with nested/indented replies (a separate, lower comment-level gate
that can be bypassed by spending Credits), everyone can upvote/downvote and
favorite. Ships on web/PWA (`/answers`) and the Capacitor Android app
(`apps/android/src/routes/answers/**`), reusing the platform's existing
economy (`lib/economy/coins.ts`, `safeAwardXP`), content-moderation
(`lib/moderation/contentFilter.ts`), reporting (`moderation_reports`,
AI classifier), and admin-panel patterns rather than introducing parallel
infrastructure. New admin/moderator control panel at `/admin/forum/*`
(dashboard, moderation queue, post management, settings) — moderators get
scoped access to this section only, not the full admin panel. New DB tables:
`forum_questions`, `forum_answers`, `forum_votes`, `forum_favorites`,
`forum_moderation_log`; two new nullable columns on `reports`/
`moderation_reports` for forum-target reports. New manifest config block
(`ZobiaManifest.forum`) covering level gates, comment-bypass cost, and
per-action XP/Credit rewards with a daily reward cap to bound farming.

---

## Appendix: Version 1.98 Change Log

### v1.98 — Changelog

#### New Feature: User Profile Stats Page

Added a dedicated Stats page (§15) — a single hub for a user's badges,
levels, achievements, created rooms, leaderboard positions, guild, and
social counts (friends/followers/following/referrals). Visible only to
the profile owner and to moderators/admins; loaded only when "Stats" is
clicked (never eagerly fetched with the profile page). Two depths — Basic
(Free, default) and Full (Plus/Pro/Max, default) — gated by a new
admin-configurable `profile_stats_full_plans` manifest key, editable at
`/admin/settings/profile-stats`; the master on/off switch
(`feature_profile_stats`) is picked up automatically by the existing
Feature Flags panel. New endpoint `GET /api/users/[userId]/stats`. Ships
on web/PWA (`/profile/[userId]/stats`) and the Capacitor Android app
(`apps/android/src/routes/profile/$userId/stats.tsx`), reusing the
existing leaderboard engine, rank engine, and a new shared plan/prestige
eligibility helper (`lib/plans/eligibility.ts`) extracted from the
profile-privacy gates rather than duplicating that logic a third time.

#### Enhancement: Creator rooms on public profile

The Creator card on a user's public profile (§15) now lists that
creator's top 3 rooms by member count (previously only the single largest
room), with a "see all N rooms by this creator" link that filters the
existing Rooms discovery page (`/rooms?creator_id=<id>`) — reusing
`GET /api/rooms` with a new optional `creator_id` filter rather than
building a separate rooms-by-creator endpoint.

#### Enhancement: Wallet page — rank/badges summary + paginated history

The Wallet page (§11) now shows a compact rank/badges/prestige summary
linking to the full Stats page, and paginates transaction history to the
10 most recent per currency tab with a "Load more" control, reusing the
cursor-based pagination `GET /api/economy/coins/balance` already exposed
(`cursor`/`star_cursor`) but the Wallet UI never wired up — no new backend
pagination logic required.

---

## Appendix: Version 1.99 Change Log

### v1.99 — Changelog

#### New Feature: Subscription Grace Period (personal + business)

When a personal plan (Plus/Pro/Max) or Business tier (Starter/Growth/
Enterprise) subscription does not renew, the account is downgraded
immediately, but a **grace period** keeps admin-selected data from being
deleted for a while: **30 days for Max, 14 days for Pro, 7 days for Plus**
(mirrored for the equivalent Business tiers), all admin-configurable at
`/admin/config` → "Grace Periods & Save Slots". Admin also picks, per
plan/tier, *which* grace-gated features are preserved during the grace
period via an extensible registry (`lib/plans/graceFeatures.ts` —
currently `saved_games`, with `galleries` reserved for the future Image
Galleries feature; adding a new grace-gated feature is a one-array-entry
change, no migration needed). Swept daily by the existing `daily-economy`
CRON (`lib/plans/subscriptionSweep.ts`): lapsed subscriptions move to a new
`grace` status (`subscriptions.grace_period_ends_at` /
`business_accounts.grace_period_ends_at`), then to `lapsed` (purging
preserved data) once the grace period elapses. New `x_manifest` keys:
`grace_period_days_<plan>`, `grace_period_features_<plan>` (personal and
`business_<tier>` variants) — see migration `0042`.

#### New Feature: Save Slots for Games

Users can pause an in-progress game and resume it later, gated by plan:
**Free 0 / Plus 1 / Pro 3 / Max 5** slots (admin-configurable, `x_manifest`
`save_slots_<plan>`). New `game_saves` table (migration `0042`) holds an
opaque, engine-serialized JSON state blob per save. Backed by
`GET/POST /api/games/saves`, `GET/DELETE /api/games/saves/[saveId]`, and
`POST /api/games/saves/reconcile`. The Save Slots feature is a
`grace_period_features` entry (`saved_games`, on by default) — see above.

- **In-game**: `GameRunner` shows a "💾 Save & Quit" action in the pause
  overlay for engines that opt in (see `SAVE_SUPPORTED_ENGINES` in
  `components/games/GameRunner.tsx` and the `initialState`/`onStateChange`
  contract in `components/games/types.ts`). Reference implementation:
  `components/games/engines/g2048`. Other engines can opt in by
  implementing the same two props — no GameRunner change required. A
  resumed-and-finished game's save slot is freed automatically once the
  score is submitted.
- **Management**: `/games/saved` (web/PWA) and
  `apps/android/src/routes/games/saved.tsx` (Capacitor — "Resume" opens the
  web play page in the in-app browser, since Android doesn't host gameplay
  engines in-app).
- **Downgrade reconciliation**: if a plan downgrade (or a lapsed
  subscription past its grace period) drops the slot limit below the
  current save count, `/games/saved` shows an overage banner. The user can
  either select specific saves to delete or confirm "delete the oldest
  automatically" — both paths require an explicit "Proceed?" confirmation
  before anything is deleted (`POST /api/games/saves/reconcile`). The same
  trim-to-limit logic runs non-interactively from the grace-period CRON
  sweep when nobody is present to choose.

#### Fix: Settings — Password section blank-current-password handling

The password form on `/settings` always rendered a required-looking
"Current password" field even for accounts with no password set yet
(Google/Telegram-only signups), and always required a new password ≥ 8
characters, making it impossible to leave the fields blank. Fixed:

- Leaving "Current password" blank now works whenever the account has no
  password set (the field is relabeled "Current password (leave blank —
  not set)" in that state, with matching guide copy).
- Leaving **all** password fields blank and submitting now **disables**
  password login entirely — only allowed when the account has a Google or
  Telegram login linked (`PUT /api/users/me/password` returns 400
  otherwise, so a user can never lock themselves out).
- `GET /api/users/me` now returns `has_password` / `has_oauth_login` so the
  client can render the right copy and guide text without guessing.

#### New: PIN gate on the Settings page

If the user has a PIN set (`hasPIN`), `/settings` now requires PIN
verification (`POST /api/auth/pin/verify`, the same 5-minute
`pin_ok:<userId>:<sessionId>` Redis guard used by gifts/payouts/transfers —
see `lib/auth/pinGuard.ts`) before rendering any settings content. The
verified state is remembered client-side (sessionStorage, 5-minute TTL
matching the server-side guard) so navigating within Settings doesn't
re-prompt on every render.

**Note:** the Android app's `/settings` screen has no password or PIN UI
at all yet (it currently only covers language, wallet/stats links, and
logout) — that's a pre-existing gap independent of this fix, not addressed
here since it's a net-new screen rather than a bug fix.

---

## Appendix: Version 2.00 Change Log

### v2.00 — Changelog

#### Rename: "Zobia Answers" → "Answers"

The mini forum / Q&A feature (§31) is now labelled just **"Answers"** in
the main nav (web/PWA sidebar and navbar, and the Capacitor Android app's
top bar), the admin nav, the `/answers` page and its sub-pages, the
`/admin/forum` dashboard and settings pages, the `/admin/config` grouping,
public SEO metadata for `/a/<slug>`, and XP-ledger activity descriptions
(e.g. "Posted a question on Answers"). The underlying feature name in code
(`lib/forum/*`, `forum_*` tables, `feature_forum` flag, `/admin/forum`
routes) is unchanged — this is a display-string rename only, applied via
the `answers.title` i18n key (`shared/i18n/locales/en.json` and
`apps/web/lib/i18n/locales/en.json`) plus the handful of pages/components
that hardcoded the old name instead of reading the key. Also fixed while
touching the web locale file: a ~40-key duplicate block of `answers.*`
entries that had been accidentally pasted twice into
`apps/web/lib/i18n/locales/en.json` (harmless — JSON, last write wins —
but wasteful and confusing to maintain).

#### Migration Consolidation: 42 files → 1

`apps/web/db/migrations/0001_consolidated_schema.sql` through `0042_*.sql`
have been squashed into a single `0001_consolidated_schema.sql` that
produces an identical database (verified schema-diff-clean against the
42-file sequence, plus matching table/constraint/index/policy counts and
seed-data row-for-row). All later bug-fix/backfill migrations are baked
into the final column definitions and seed values directly — e.g.
`gift_items` no longer round-trips through a `coin_price` column that gets
added then dropped, `x_manifest.deep_link_base_url` and
`captcha_provider` are seeded with their final (already-fixed) values, and
the games catalog seed reflects the final `engine_key`/`category`
assignments. The file remains fully idempotent (`CREATE TABLE IF NOT
EXISTS`, `DROP CONSTRAINT IF EXISTS` + re-`CREATE`, `DROP POLICY IF EXISTS`
+ re-`CREATE`, `ON CONFLICT DO NOTHING`) so `db/migrate.ts` and a direct
`psql < 0001_consolidated_schema.sql` both stay safe to re-run. New schema
changes going forward should land as new `0002_*.sql`, `0003_*.sql`, ...
files rather than editing `0001` in place. See `docs/SETUP.md` → "Database
setup" for the updated run instructions.

While validating this against `db/seed.sql` (demo data), found and fixed a
latent bug unrelated to the consolidation itself: all 8 sample rooms are
`is_public = true` but never set a `slug`, violating the
`rooms_public_requires_slug` CHECK constraint added in what was migration
`0015` — `db/seed.sql` had never been updated to match and so failed on
any fresh database. Added slugs (`welcome-to-zobia`, `lagos-vibes`,
`study-hall`, `music-culture`, `business-corner`, `sports-arena`,
`tech-talk`, `crypto-finance`) matching the convention used elsewhere
(`lib/slug.ts`).

---

## Appendix: Version 2.02 Change Log

### v2.02 — Changelog

#### Identity KYC audit fixes (Tiers 1-3)

- **RLS on `kyc_submissions`/`kyc_documents` (new migration `0001_consolidated_schema.sql`):**
  these tables (added in `0001_consolidated_schema.sql`) never had row-level
  security, unlike the pre-existing `creator_kyc` table which carries PII of
  the same sensitivity (BVN digits, encrypted ID numbers, full legal names,
  document storage keys). Added `kyc_submissions_self_or_admin` /
  `kyc_documents_self_or_admin` policies, exact mirrors of the existing
  `creator_kyc_self_or_admin` policy shape. This also corrects the changelog
  entry above (v1.74, "SQL migration fix 0025") which is stale — see its
  inline note.
- **KYC PII purge on account deletion:** `DELETE /api/users/me` now
  hard-deletes `kyc_submissions` and `kyc_documents` (and best-effort purges
  the underlying storage objects) alongside the pre-existing
  `creator_bank_accounts`/`creator_wallet_addresses`/`creator_kyc` cleanup —
  previously KYC PII silently survived account deletion.
- **Ledger reference persistence:** `kyc_submissions.credit_ledger_reference_id`
  is now written when the verification fee is charged (was defined in the
  schema but never populated).
- **Paystack failure clarity:** a failed Paystack BVN validation request now
  sets `paystack_verification_status = 'failed'` (previously left `NULL`/
  stuck at `'pending'`), so admins can distinguish "never contacted
  Paystack" from "genuinely pending" in the review queue.
- **Double-submit race fix:** a unique-violation on
  `kyc_submissions_one_active_per_tier_idx` from concurrent submissions is
  now converted to the same `KYC_ALREADY_PENDING` conflict the pre-check
  already returns, instead of a raw 500.
- **Tier 3 physical-verification scheduling:** `physical_verification_scheduled_at`
  / `physical_verification_notes` (defined in the schema since `0005`, never
  used) are now set via a new `PATCH /api/admin/kyc/[id]/schedule` route and
  a scheduling form in the `/admin/kyc` detail drawer.
- **Rate-limit consistency:** `GET /api/admin/kyc` now uses `RATE_LIMITS.admin`
  (was `apiRead`), matching every other admin KYC route.
- **i18n:** ~65 new English `kyc.*` keys registered in
  `shared/i18n/locales/en.json` — the user-facing `/kyc` flow previously
  rendered entirely via inline `t(key, "default")` fallback strings with no
  keys actually registered. Also fixed a bug where `TierCard`'s status label
  was rendered through a dummy translator that always short-circuited to the
  English default, bypassing i18n entirely even when a key was registered.
- **Android (Capacitor):** the `/ads` hub's inert "Identity verification
  (KYC) is completed on web or PWA" text is replaced with a working button
  that opens the web `/kyc` flow in the in-app browser (`Browser.open`,
  same pattern as the Business Account checkout flow) — previously there
  was no way to reach KYC from the Android app at all.

---

## Appendix: Version 2.04 Change Log

### v2.04 — Changelog

#### Presence heartbeat was never sent (root cause of stale "Last Active" / empty Online Friends)

`POST /api/presence` (which sets `users.last_active_at` and a 5-minute Redis
TTL key — see §2.2) has existed since presence was built, but no client
anywhere ever called it. The only place `last_active_at` was ever written
was at login (`app/api/login/daily/route.ts`). In practice this meant a
user's presence went stale within an hour of signing in regardless of how
active they actually were, which broke two features that read
`last_active_at`: the admin Users page's "Last Active" column
(`/admin/users`) and the Home page's Online Friends row
(`GET /api/friends/online`, §4 Relationship Types → Privacy Controls).
Fixed by adding an app-wide presence heartbeat: `PresenceHeartbeatProvider`
(web, mounted in `app/(app)/layout.tsx`) and `usePresenceHeartbeat` (the
Capacitor Android app, mounted in `routes/__root.tsx`) call `POST
/api/presence` on mount and every 3 minutes while the app is foregrounded/
visible — no new endpoint, no new Redis calls, just correctly invoking the
one that already existed. **This is unrelated to CRON** — the fix only
requires a normal deploy, not a CRON run.

To be clear, "Online Friends only shows friends who opted in" is **not** a
bug — see §4's Privacy Controls: "Show online status" is an opt-in toggle
(Pro/Max, or Prestige 1+), off by default, and friends who haven't enabled
it never appear regardless of their actual activity. The Home page now
shows a one-line hint under "Online Friends" (`home.friends.privacyHint`)
explaining this so it isn't mistaken for a bug.

#### Capacitor Android app was missing the Presence Layer entirely

The Android app (`apps/android`) is a separate React/TanStack Router app
(not a WebView wrapper of the Next.js site), and it had none of §2.2's
Presence Layer: no online rings, no Room pulse bars, no Online Friends row,
and no room-presence heartbeat (so Android users never counted toward a
room's live/soft-capacity admission). Added, mirroring the web
implementations 1:1: `components/ui/OnlineRing.tsx`,
`components/ui/RoomPulseBar.tsx` + `LiveRoomPulseBar.tsx`, an Online
Friends row on `routes/home.tsx`, a pulse bar on each room card
(`routes/rooms/index.tsx`) and inside the room screen
(`routes/rooms/$roomId.tsx`), and a room-presence heartbeat (`POST
/api/rooms/:roomId/presence` every 45s, matching the web room screen).

#### Admin panel: mobile table overflow, Users page rework, KYC deep-link

- **Admin tables unusable on mobile (all `/admin/*` pages):** every admin
  table page already wrapped its `<table>` in `overflow-x-auto`, but
  `AdminLayoutShell`'s content column was a flex child without `min-w-0` —
  a classic flexbox trap where the child's implicit `min-width: auto` lets
  wide content force the *whole page* wider instead of scrolling inside its
  own wrapper. Fixed once in `AdminLayoutShell.tsx`, which fixes every
  admin table page at once. Also wrapped the five tables that were missing
  `overflow-x-auto` entirely (`/admin/gift-drop`, `/admin/footer-scripts`,
  `/admin/kyc`, `/admin/games`, `/admin/ads`).
- **`/admin/users` reworked:** the search box now auto-searches ~350ms
  after typing stops (debounced server-side search — a live autocomplete
  dropdown was intentionally skipped as unnecessary overhead for a
  moderation tool); the Make Mod / Revoke Mod button sent
  `make_mod`/`revoke_mod` while the API only accepted
  `upgrade_moderator`/`downgrade_moderator`, so it always failed — action
  names now match; pagination was broken (the API moved to keyset/cursor
  pagination for `/admin/users` and stopped returning `total`, but the page
  still sent `page=N` and read `data.total`) — rewritten to cursor-based
  Prev/Next; added "View Profile" and "View KYC Submissions" links on the
  user detail panel. "Verify Account" was renamed "Mark Email Verified" and
  a caption clarifies it only flags the login email, since it is unrelated
  to identity KYC — the identity verification queue is now one click away
  via "View KYC Submissions" → `/admin/kyc?userId=<id>` (new `userId` query
  param on both the page and `GET /api/admin/kyc`, showing that user's full
  submission history instead of only the in-progress queue).

---

## Appendix: Version 2.05 Change Log

### v2.05 — Changelog

#### Capacitor Android CI build was broken (root cause of "most pages error or don't load")

`.github/workflows/android-build.yml` had been failing on every recent
commit to `main`. The npm build script ran `tsc -b && vite build && cap
sync android` — but `routeTree.gen.ts` (the TanStack Router file listing
every route, regenerated by the Vite plugin during `vite build`) is
committed to git and had gone stale relative to the actual route files
(missing the `/ads` and `/business/ads` routes), so `tsc -b`, running
*before* `vite build` ever got a chance to refresh it, failed on every
build. Reordered to `vite build && tsc -b && cap sync android` (`tsc -b`
is a type-check-only step, `noEmit: true`, so this is safe) and
regenerated `routeTree.gen.ts`. Also fixed two smaller type errors that
were piling up behind the build failure (`lib/ads/admob.ts` used the
wrong exported type for the banner-size parameter; `routes/business/ads/
index.tsx` had an unused prop). Anyone who built/sideloaded the app from a
recent commit was running a stale or broken bundle — this most likely
explains "games page does not even load" / "most pages error," on top of
the real per-page bugs below.

#### Android native project was missing standard Capacitor scaffolding

`apps/android/android` was missing `variables.gradle` (the single source
of truth for `compileSdkVersion`/`minSdkVersion`/library versions that
every native plugin submodule's own `build.gradle` reads, falling back to
stale defaults like `compileSdk 34` when absent) and never included
`capacitor-cordova-android-plugins` in `settings.gradle`. `app/build.gradle`
manually duplicated the list of native plugin dependencies instead of
`apply from: 'capacitor.build.gradle'` (the standard Capacitor pattern) —
which is exactly how `@capacitor-community/admob` ended up compiled into
the JS bundle but never linked into the native APK (`capacitor-community-
admob` was missing from `app/build.gradle`'s `dependencies {}`, so calling
any AdMob method at runtime would have thrown "plugin is not implemented
on android"). Added `variables.gradle`, wired `settings.gradle`, and
switched `app/build.gradle` to the standard `apply from:` pattern so this
class of bug can't recur when a new native plugin is added. Also added the
AdMob Application ID `<meta-data>` (Google's public test App ID — required
even in test mode, or `AdMob.initialize()` crashes with
`IllegalStateException`; swap for the real one per §17 before shipping,
see docs/SETUP.md).

#### Top of the app rendered under the status bar (edge-to-edge cut-off)

Android 15+ (API 35+, this app targets 36) forces edge-to-edge rendering
for all apps — content draws behind the system status/nav bars unless the
app explicitly pads for `env(safe-area-inset-*)`. `TopBar`/`BottomNav`/
`OfflineBanner` were `position: fixed`, which is positioned relative to the
viewport and is **not** affected by an ancestor's padding — so `body`'s
existing `padding-top: env(safe-area-inset-top)` never reached the fixed
header, and its content rendered partly under the status bar. Fixed by
making `TopBar`, `BottomNav`, and `OfflineBanner` normal (non-fixed) flex
children of the `__root.tsx` AppShell column instead — the WebView lays
them out in-flow, so nothing needs a hardcoded height/margin to offset
against, and each component's own `env(safe-area-inset-*)` padding just
works. Removed the `mt-14`/`mb-14` magic-number offsets on `main` that this
made unnecessary (and that were never quite correct in the first place —
`BottomNav`'s real height, content + `env(safe-area-inset-bottom)`, didn't
match the hardcoded `mb-14`, so the last bit of scrollable content could
sit behind the nav on devices with a bottom gesture inset).

#### Ten genuine per-page runtime bugs (independent of the CI build issue above)

An API-response-shape audit across every Android route found real bugs
beyond the build failure — mostly "double-unwrap" mistakes (code did
`res.data.data.x`, but `apiClient`'s response interceptor already unwraps
the backend's `{success, data, error}` envelope down to `data`, so the
extra `.data` always read `undefined`) and endpoint/shape mismatches:

- **`routes/home.tsx`** — `GET /api/home/feed` doesn't exist on the
  backend at all; the Home page's feed section always errored. Repointed
  at `GET /api/moments` (this app's actual public post feed). Also fixed
  `fetchOnlineFriends`'s double-unwrap, which silently hid the Online
  Friends row.
- **`routes/games/$slug.tsx`** — the API wraps the game as `{ game }`, not
  a bare `GameSummary`; every field read (`avgRating.toFixed`, etc.) came
  from `undefined` and crashed the page on render. This is almost
  certainly the reported "games page does not even load" bug.
- **`routes/blogs/$slug/index.tsx`, `blogs/$slug/$postSlug.tsx`,
  `blogs/new.tsx`** — five double-unwrap bugs; blog posts permanently
  showed "not found," comments crashed on load, and creating a blog
  crashed after a successful save.
- **`routes/answers/index.tsx`, `answers/$questionId.tsx`, `answers/
  ask.tsx`** — eight double-unwrap bugs across the question list, question
  detail, voting, thread expansion, and question creation — the entire
  Answers feature was silently or fatally broken.
- **`routes/profile/$username.tsx`** — there is no `GET /api/users/
  :username` endpoint; the only profile route takes a UUID (400s
  otherwise) and returns a bare `{ profile }` body with different field
  names than the stale shared `PublicProfile` type assumed. Rewritten to
  resolve username → userId via `GET /api/users/search` (with a shortcut
  for viewing your own profile, since search excludes the caller) then
  fetch the real profile endpoint, remapped to its actual field names.
- **`routes/auth/two-factor.tsx`** — `POST /api/auth/2fa/verify` was
  called without `?platform=mobile`, so the backend took the cookie-based
  web branch and never returned `accessToken`/`user` in the body. Every
  2FA code — correct or not — showed "invalid code"; 2FA users could never
  log in on Android.

#### Business Account creation/upgrade now uses Google Play Billing on Android

`routes/business/index.tsx` opened a Paystack checkout URL in the in-app
browser — against §18's policy that Google Play Billing is the *only*
in-app purchase mechanism allowed on Android. Replaced with real Play
Billing: `capacitor-plugin-cdv-purchase` (a native Capacitor plugin, not a
WebView or a Cordova-bridge shim) drives the purchase sheet for three new
subscription products (`biz_starter_monthly`, `biz_growth_monthly`,
`biz_enterprise_monthly`, grouped so switching tiers replaces the current
one), verified server-side against the Google Play Developer API via a new
`POST /api/business/iap/verify` (creates the Business Account on first
purchase, upgrades/downgrades the tier on subsequent ones, records a
`payments` row with `provider = 'google_play'` for revenue-by-provider
reporting parity with Paystack/crypto). The same Play Billing client
(`apps/android/src/lib/payments/googlePlay.ts`) also covers coin packs,
star packs, and Plus/Pro/Max subscriptions — wired into a new "Buy Credits
& Stars" panel on `routes/wallet.tsx` — reusing (and, for star packs,
completing — see below) the existing `POST /api/economy/iap/verify`
Google Play Developer API verification path.

**Star packs were never actually verifiable via IAP:** `POST
/api/economy/iap/verify`'s product schema only recognised coin and
subscription product IDs — a star-pack purchase would have failed
validation outright. Added `stars_starter`/`stars_regular`/`stars_big`/
`stars_boss` to the schema and a `creditStars()` branch, reusing the same
Google Play Developer API verify/consume calls (extracted to `lib/
payments/googlePlayVerify.ts`, shared with the new business-IAP route
instead of being duplicated a third time). `GOOGLE_PLAY_PACKAGE_NAME`'s
default also changed from the stale `com.zobia.app` placeholder to
`com.zobiasocial.app` (the Capacitor app's real `applicationId` — the Expo
app is discontinued and no longer published).

#### Push notifications wired for the Capacitor Android app

`@capacitor/push-notifications` was a dependency with zero lines of code
using it. Added `apps/android/src/lib/push/index.ts` — requests
permission, registers for a token, and POSTs it to the existing `POST
/api/users/push-token` endpoint (unchanged from the Expo app's contract:
`{ token, platform, deviceId }`), with tap-to-navigate gated by an
allowlist of routes that actually exist in this app.

This surfaced a server-side gap: `lib/notifications/push.ts` (the single
choke point every notification-triggering code path already calls through)
only ever sent to Expo push tokens — Capacitor's plugin registers a
Firebase Cloud Messaging (FCM) token, a completely different format, which
would have been silently filtered out (`isValidExpoToken()`) and never
delivered. Added an FCM sender (`lib/notifications/fcm.ts`, HTTP v1 API)
and routed each stored token to the matching provider by format, so no
notification-sending call site anywhere in the codebase needed to change.
The Google service-account JWT-signing/OAuth exchange this needs is
identical in shape to the one Google Play Billing verification already
does, so it's a shared helper (`lib/google/serviceAccountAuth.ts`) instead
of a third copy. Requires a Firebase project + `FCM_PROJECT_ID` +
`FCM_SERVICE_ACCOUNT_JSON` to actually deliver in production — see
docs/SETUP.md "Push Notifications (Capacitor Android / FCM)"; without it,
sends are skipped (logged, not thrown) and the in-app notification list
(`GET /api/notifications`) still works.

#### Advert slots wired: in-house native ads + AdMob were both built but never rendered anywhere

`components/ads/AdSlot.tsx` (in-house ad serving, `GET /api/ads/serve`)
and `lib/ads/admob.ts` (AdMob) both existed with zero call sites. Wired
the in-house in-stream native ad into free Rooms' message stream (`routes/
rooms/$roomId.tsx`, gated on `room.type === "free_open"`, every N
messages per the admin-configured `ad_room_instream_interval` — the exact
placement/cadence apps/web's room screen already uses, via a new `use
AdsConfig` hook mirroring the web one), and an AdMob banner on the Games
list (additive to the in-house ads, matching "Admob ads show in the
capacitor/android app in addition to other ads"). Also fixed `AdSlot`'s
click handling: it used a plain `<a target="_blank">`, which in a
Capacitor WebView has no "new tab" to open — it would have navigated the
app itself away to the ad's destination. Switched to `Browser.open()`,
the in-app-browser pattern already used everywhere else in this app
(OAuth, purchase fallbacks).

#### Not yet done (Android user pages)

This pass covered the app-shell bug fixes, IAP/billing, and notification/
ad infrastructure above, plus every *existing* Android page. It did not
port the remaining web/PWA pages the Android app is still missing (Friends,
Guilds, Quests, Seasons, Prestige, Nemesis, Council, Elder, Classroom,
Creator tools, Events, Gifts, Inbox, KYC, Leaderboards, Merch, Message
Groups, Referrals, Room creation, Business/Subscription settings,
Community Notes) or the Admin panel (intentionally deferred to a later
session per scope). Follow-up work should port these using the same
patterns established here (TanStack Router file routes under `routes/`,
`apiClient` + React Query, Tailwind classes matching existing screens,
i18n keys from `shared/i18n/locales/en.json`).

#### v2.06 — Android user-page parity, Batch 1 (Core social/engagement)

Ported the first batch of the pages listed above to the Capacitor app:
Quests (`routes/quests.tsx`), Friends (`routes/friends.tsx`), Gifts
(`routes/gifts.tsx`), Events (`routes/events.tsx`), Inbox
(`routes/inbox.tsx`, later renamed to `routes/announcements.tsx` — see
v2.18 changelog), Elder (`routes/elder.tsx`), Referrals
(`routes/referrals.tsx`), Classroom (`routes/classroom.tsx`),
Leaderboards (`routes/leaderboards.tsx`), and an own-profile redirect
(`routes/profile/index.tsx`, resolves the logged-in user to
`/profile/$username`). `BottomNav.tsx`'s six-tab bar now matches web's
`bottomTabItems` exactly (Home, Quests, Games, Friends, Wallet,
Profile); `TopBar.tsx`'s drawer now lists every top-level route that
exists on Android (20 items, everything except Seasons, which has no
Android route yet). Added the `classroom.*` i18n namespace (the web
Classroom page had none — it was all hardcoded English) plus a handful
of `events.*` and `android.pin.title` keys.

Also fixed, since it blocked Classroom on every platform: `GET
/api/classroom/enrolled` was called by the web Classroom page (and now
Android's) but the route never existed server-side, so "My ClassRooms"
silently rendered empty everywhere. Added
`app/api/classroom/enrolled/route.ts`, joining `classroom_enrolments`
with `rooms` and the best `classroom_quiz_attempts` score per room.
`completedLessons` is reported as `0` — there is no per-lesson
completion tracking table in the schema yet, only per-quiz attempts;
adding real lesson-progress tracking is a separate follow-up.

Known gaps carried forward: Gift Drop purchase (Events page) has no
Google Play Billing product yet (`lib/payments/googlePlay.ts` only
defines coins/stars/business-tier products), so the buy button is
disabled on Android with an "open on web" message rather than faking an
IAP flow. Remaining pages (Guilds, Guild Discovery, Council, Community
Notes, Nemesis, Economy, Prestige, Seasons, Creator, Merch, single
Gift, Stickers, KYC) and the Admin panel are still not ported — see
follow-up batches.

#### v2.07 — Android user-page parity, Batch 2 (Guilds & community)

Ported: My Guild hub (`routes/guild.tsx`), Guild directory
(`routes/guilds/index.tsx`), public Guild profile
(`routes/guilds/$guildId.tsx`, sharing a `GuildDetailView` component
with the hub), Council (`routes/council.tsx`), Community Notes
(`routes/community-notes.tsx`), and Nemesis (`routes/nemesis.tsx`).
Added `lib/guilds/tiers.ts` (Guild Tier XP thresholds, matching §13's
table) shared by the rewritten `GET /api/guilds/[guildId]` endpoint.

This batch surfaced and fixed several pre-existing bugs that had left
these features non-functional on **every** platform, not just Android
(the pattern from v2.06's Elder/Classroom fixes repeated here):

- `GET /api/guilds/[guildId]` returned a raw snake_case DB row; both
  the web guild pages and the new Android pages need a flat camelCase
  shape with `isMember`/`isCaptain`/`tierXpRequired`/`activeWar`/
  `warHistory`/`allianceHistory`/`activeQuests`. Rewrote the endpoint.
- `guild/page.tsx` called `GET /api/guild/mine` and
  `GET /api/guilds/nearby`, neither of which exists — the dashboard
  never loaded for anyone. Rewired to `GET /api/users/me` (for
  `guild_id`) + `GET /api/guilds/:id`, the same pattern
  `profile/page.tsx` already uses successfully. A follow-up fix during
  review: the rewrite initially read `me.guild_id` directly off
  `/api/users/me`'s response, but that endpoint returns `{user: {...}}`
  — fixed to read `me.user.guild_id`.
- `guilds/page.tsx` unconditionally redirected to `/guild-discovery`,
  whose own "Browse All Guilds" link pointed back to `/guilds` — an
  infinite redirect loop. `/guilds` is now a real searchable directory.
- `DELETE /api/guilds/[guildId]/members` only ever allowed the guild
  captain to remove a member and explicitly rejected removing oneself
  — there was no way for a regular member to leave a guild through any
  UI, on any platform. Now allows a member to remove themselves (leave)
  in addition to a captain removing someone else (kick); a captain
  still cannot remove themselves (must transfer ownership first).
  Wired an actual "Leave Guild" button into both `guild.tsx` (own
  guild) and `guilds/$guildId.tsx` (someone else's), disabled when the
  caller is the captain.
- `GET /api/guilds/[guildId]` returned the full member roster
  (usernames, contribution scores) to any authenticated caller even
  for invite-only guilds — non-members now only see the aggregate
  `memberCount` for those; the roster itself is member/captain-only.
- `GET /api/council` selected a nonexistent `avatar_url` column
  (schema has `avatar_emoji`) and neither Council endpoint joined the
  idea author's username; `POST /api/council/ideas/[id]/vote` expected
  `{helpful: boolean}` but the web page sent `{direction}` — member
  list, idea list, and voting never worked. Fixed the query, added the
  author join + `hasVoted`, and matched the vote contract.
- `web/api/auth/me`'s `isCouncilMember` field never existed —
  "Submit Idea" was permanently disabled even for real council
  members. Now derived from the actual membership list.
- `GET /api/community-notes` required `targetType`+`targetId` on every
  call, so the platform-wide feed (as opposed to a single message's
  notes) always 400'd. Added an optional global/cursor-paginated mode
  (with cursor validation — a malformed cursor now 400s instead of
  silently resolving to the Unix epoch). The vote endpoint expects
  `{helpful: boolean}`, not `{vote: ...}`, and its status vocabulary is
  `needs_review`/`shown`/`hidden`, not `pending`/`visible`/`removed` —
  fixed the web page's request/response handling to match.
- `GET /api/nemesis` omitted `username` for both `me` and `nemesis`,
  so profile links on that page had nothing but a raw id to work with.

Two Android-only bugs found in this batch's own new code during
review, both fixed before merge: `council.tsx` and
`community-notes.tsx` double-unwrapped the `apiClient` response
envelope (`data.data.x` instead of `data.x` — the client's response
interceptor already unwraps `{success,data,error}` to `data`), which
crashed the Council screen on load and silently dropped vote-count
updates on Community Notes.

**Known gap left unfixed (documented in code, not a rename/reshape):**
`POST /api/community-notes` requires attaching every note to a
specific message/room/user/guild UUID, but no client has a
target-picker UI to supply one — submission always 400s. Android's
Community Notes screen is read+vote only as a result; building a
target picker is a real missing feature for a later batch, not a
contract bug.

Remaining pages (Economy, Prestige, Seasons, Creator, Merch, single
Gift, Stickers, KYC) and the Admin panel are still not ported.

#### v2.08 — Android user-page parity, Batch 3 (Economy & progression)

Ported: Prestige (`routes/prestige.tsx`), Seasons (`routes/seasons.tsx`),
Stickers (`routes/stickers.tsx`), the Creator hub (`routes/creator/
{index,bank-account,broadcasts,marketplace,wallet}.tsx`), Merch
(`routes/merch/{index,$creatorId}.tsx`), and a KYC screen
(`routes/kyc.tsx`) that opens the existing web KYC flow in a Custom Tab
rather than recreating the identity-capture/liveness/AI-review flow
natively — consistent with this document's existing guidance that KYC
stays web/PWA territory (§22.0.1). `creator/bank-account.tsx` and
`creator/wallet.tsx` are read-mostly with a "manage on web" handoff,
since both are two-phase, PIN/2FA-gated, irreversible-if-wrong payout
flows not worth a fragile from-scratch native rebuild. There is no
dedicated `/gift/$userId` Android screen — `zobia://gift/:userId`
deep links now resolve the target user and preselect them on the
existing `/gifts` screen (via a new `recipientId`/`username` search
param), mirroring the web `/gift/[userId]` page's own
resolve-and-redirect behavior rather than duplicating a screen.
`profile/$username.tsx` also gained a "🎁 Gift" action button (shown
whenever viewing another user's profile) that links into the same
`/gifts?recipientId=&username=` flow — previously that flow was only
reachable via a deep link on Android, with no in-app entry point from a
profile page itself, unlike web/PWA.

As with the prior two batches, building this surface out surfaced
several pre-existing contract bugs, all fixed:

- `creator/dashboard` (`GET /api/creator/dashboard`) never returned an
  `isCreator` flag, so the web Creator dashboard silently redirected
  real creators away from their own dashboard. Added the flag.
- The Creator Marketplace page called `/api/quests/sponsored` and
  `/api/quests/sponsored/:id/apply`, neither of which exists — fixed
  to the real `/api/creator/sponsored-quests` endpoints. A follow-up
  fix during review: the apply endpoint requires a `roomId` (a creator
  applies to run a sponsored quest in one of *their* Rooms) that
  neither the "fixed" web page nor the new Android page ever
  collected — every apply attempt 400'd. Added a Room picker to both.
  Review also caught a unit bug in the same fix: `creatorPayout` was
  computed in coins (`reward_coins × creator_share_percent ÷ 100`) but
  displayed via `Intl.NumberFormat(..., {currency:"NGN"})` as if it
  were Naira — understating the true payout by ~100x. Now displayed as
  coins, matching the "User Reward" figure beside it.
- Merch (`/merch`, `/merch/[creatorId]`) called `/api/merch/stores*`,
  which doesn't exist — fixed to the real `/api/merch` /
  `/api/merch/:creatorId/products/:id/purchase`. A follow-up fix
  during review: the purchase endpoint requires shipping fields
  (`shippingName/Address/City/Country`) for physical products, but
  neither page ever collected or sent them — buying any physical item
  always 400'd with digital items unaffected. Added a shipping form to
  the purchase-confirmation modal on both platforms, gated on the
  product's `product_type`.
- `stickers.tsx` posted to `/api/stickers/:packId/unlock`, which
  doesn't exist — fixed to `POST /api/stickers` with `{packId}`.

Two Android-only issues found in this batch's own new code during
review, both fixed: `gifts.tsx`'s `SendGiftPanel` seeded its
`recipient` state from a `preselectedRecipient` prop only on first
render, so opening a second `zobia://gift/:userId` deep link while the
Send Gift modal was already open kept sending to the first recipient —
now keyed by recipient id so a new deep link remounts the panel with
fresh state.

**Known gap left unfixed (documented in code, not a rename/reshape):**
`seasons.tsx` omits the milestone reward track and Gift Pass modal
present on web — the real `GET /pass` endpoint returns `{pass,
season}`, not the `{milestones, currentXp, hasPaidPass}` shape the web
page assumes, and there's no bulk milestones-list endpoint to build a
correct Android version against. This is the same class of "web page
itself has a contract bug" found elsewhere in this effort, but fixing
it requires either a new backend endpoint or a larger reshape of the
existing one — bigger than a targeted fix, left for a follow-up. The
legacy, unlinked `apps/web/app/(authenticated)/creator/merch/page.tsx`
(calls a nonexistent API, superseded by `/merch`) was left unported.

`/economy/purchase/callback` (the web-only Paystack/crypto
redirect landing page) was intentionally not ported — Android
purchases always go through Google Play Billing (`lib/payments/
googlePlay.ts`, already built), which has no equivalent redirect step.

Remaining: Message Groups, Room creation, Business/Subscription
settings, and the Admin panel are still not ported. (Message Groups
were ported in v2.19 — see that changelog.)

#### v2.09 — Notifications, Rewarded Ads, and a full Android bug audit (final batch of the user-page parity effort)

This batch closes out the user-facing phase: rather than a new page,
it wires up in-app notifications and advert slots properly across
both platforms, and audits the entire pre-existing `apps/android`
codebase (not just the pages added in v2.06–v2.08) for the same class
of contract bugs found repeatedly in prior batches.

**Notifications:**
- `POST /api/notifications/read` (mark specific ids read) never
  existed server-side, even though it was already assumed to by the
  Android notifications page's file header — every per-item mark-read
  tap 404'd. Added the route (`user_id`-scoped `UPDATE`, matching the
  existing `read-all` route's authorization pattern).
- Neither platform showed an unread-count badge on the notification
  bell — a genuine gap, not an Android-catch-up item. Added a small
  red-dot badge to both `apps/web/components/layout/Navbar.tsx` and
  `apps/android/src/components/layout/TopBar.tsx`, backed by a shared
  TanStack Query cache entry (`apps/android/src/lib/notifications/
  queries.ts`, `apps/web/lib/notifications/useUnreadCount.ts`) so the
  badge and the notifications list page read from the same fetch
  rather than polling independently — consistent with this project's
  "minimize Redis/backend calls" constraint.
- Web's notifications page had no per-item mark-read handler at all
  (only "mark all") — added one, wired to the new `/read` endpoint,
  with optimistic UI and a revert-on-failure path.
- Web's "mark all read" applied its optimistic UI unconditionally
  without checking the response was actually successful — a failed
  request (expired session, 5xx) left the user believing everything
  was cleared when nothing happened server-side. Fixed to bail out on
  a non-2xx response.
- Android's per-item mark-read handler recomputed the badge count by
  filtering only the currently-loaded page of notifications, silently
  undercounting whenever more unread notifications existed outside the
  fetched window. Fixed to decrement the server-supplied `unreadCount`
  instead.
- `apps/android/src/lib/push/index.ts`'s `VALID_PUSH_ROUTES` allowlist
  was missing `/home`, `/nemesis`, `/friends`, `/guilds`, `/inbox`,
  `/seasons`, and `/council` — all routes the backend's re-engagement
  and daily-notify jobs actually send as push `action` payloads, and
  all of which now have real Android screens (post v2.06–v2.08). Taps
  on those notification types previously silently no-opped; added them
  plus an alias map for two non-path action tokens the backend sends
  (`open_council`, `/economy/coins`).

**Rewarded Ads:** `components/ads/RewardedAdButton.tsx` (web) and the
`POST /api/economy/rewards/ad-reward` endpoint it targets were fully
built but never rendered anywhere on either platform — a real,
PRD-specified feature (§17, §3 Plans table: free/Plus users can watch
a rewarded ad and earn Credits, capped per day) sitting completely
unused. Wired a "Watch an ad, earn Credits" button into the Wallet
page on both platforms. Android drives the native AdMob rewarded unit
(`lib/ads/admob.ts`'s existing `showRewarded()`) rather than web's
in-house "watch for N seconds" placement, then claims through the same
endpoint; on a 429 (daily cap reached) it caches the cap-reached state
locally for the rest of the UTC day, mirroring the Expo app's MMKV cap
hint (a pattern already described in an earlier bug-fix entry in this
document) — including re-validating that cached date periodically so
the button un-caps itself if the Wallet screen stays open across a UTC
midnight rollover, rather than requiring a navigate-away/back.

Fixed while wiring the gating logic (free/Plus plans only see the
button): the web Wallet page parsed `GET /api/economy/subscriptions`'s
response as `{data: {plan, subscription}}`, but the route actually
returns `{currentSubscription: {plan, ...} | null, availablePlans}`
with no `data` wrapper — `activePlan` was always `undefined` from this
call and silently fell back to the balance endpoint's plan field. Also
simplified a confusing double-fallback condition
(`(A??B??"free")==="free" || (A??B)==="plus"`, which was always true
whenever both `A` and `B` were `undefined`) into a single unified
plan-derivation check.

**Bug audit of pre-existing Android code:** `__root.tsx`, `TopBar.tsx`,
and `BottomNav.tsx` were read end-to-end — every nav href resolves to
a real route file, no dead links found. Nine older route files
(`home.tsx`, `rooms/index.tsx`, `messages/index.tsx`,
`business/index.tsx`, `settings.tsx`, `moments/index.tsx`,
`quests.tsx`, `friends.tsx`, `games/index.tsx`) had every `apiClient`
call cross-checked against the real backend route tree — all clean.
Confirmed the offline-persistence story is real, not dead
infrastructure: `apps/android/src/lib/query/client.ts` wires a
per-query IndexedDB persister (`idb-keyval`) as the default TanStack
Query `queries.persister`, consumed via a plain `QueryClientProvider`
in `main.tsx` (a stale comment there referencing
`PersistQueryClientProvider`, which isn't actually used, was fixed).

---

## Appendix: Version 2.06 Change Log

### v2.06 — Changelog

#### Capacitor Android app gains full admin-panel parity (36/36 pages)

The Android app (`apps/android`) had zero admin pages — `is_admin` users
had no way to reach `/admin/*` functionality at all from the app, unlike
web/mobile-web/PWA (all served by the same Next.js `(admin)` route group)
which already had the complete §20 admin panel. Built all 36 pages
natively in `apps/android/src/routes/admin/**` (TanStack Router,
card-list UI, not a WebView wrapper of the web admin panel — the KYC
review queue is the closest thing to an exception, and even that renders
submitted document images with a plain `<img>` rather than embedding a
browser), matching the web `AdminLayoutShell` nav 1:1 (see
`apps/web/components/admin/AdminLayoutShell.tsx`'s `adminNavItems`
vs. the new `apps/android/src/components/admin/adminNav.ts`):

Users, Moderation, Answers (forum), Community Notes, Financial, Payouts,
Payout Appeals, Refunds, Announcements, Messages, Alerts, Config,
Privacy Settings, Profile Stats, AI Settings, Feature Flags, Business
Accounts, Identity KYC, Rooms, Branded Rooms, Leaderboards, Leaderboard
Banners, Footer Scripts, Events, Flash XP, Actions Log, Auto Actions,
Creator Spotlight, Gifts Catalog, Gift Drop, Seasons, Sponsored Quests,
Ads, Games, Blogs, and the Dashboard overview.

**New shared foundation** (`apps/android/src/components/admin/`):
`AdminShell.tsx` (drawer nav + header, replaces `TopBar`/`BottomNav` for
the `/admin/*` subtree — mirrors `AdminLayoutShell`'s mobile drawer, no
desktop sidebar variant needed since this app has no desktop breakpoint),
`AdminGuard.tsx` (client-side nav gate on `user.is_admin` — a UX
convenience only; the real authorization boundary remains server-side
`withAdminAuth`, re-checking `is_admin` against the database on every
`/api/admin/*` call, so a stale/spoofed client claim can never grant real
access), and `AdminUI.tsx` (the shared stat-card/badge/toast/confirm-
dialog/tabs/toggle kit every page below is built from, so the 36 pages
share one visual language instead of 36 bespoke implementations).

**"🛡️ Admin" nav link** added to `TopBar.tsx`'s drawer (first item,
`is_admin`-gated), matching web `Navbar.tsx`'s `MobileDrawer` exactly —
same position, same icon, same conditional. No separate "admin login"
screen was added for Android (unlike web's `/admin/login`, which exists
specifically to force mandatory TOTP entry when there's no existing
browser session): the Android app already authenticates via Bearer JWT
through its regular login+2FA flow, and any resulting session with
`is_admin = true` is independently sufficient for every `/api/admin/*`
call (`extractToken` in `lib/api/middleware.ts` accepts a Bearer header
before falling back to the cookie) — confirmed by reading
`withAdminAuth`'s implementation rather than assumed.

Backend: **zero API changes were required** — all 36 pages consume
`/api/admin/*` endpoints that already existed and were already used by
the web admin panel, so this was purely a new frontend surface. No new
Redis calls, no new CRON jobs.

#### Nine real bugs found and fixed while porting (web + Android)

Building each Android page against its web counterpart's actual API
contract (reading the Zod schema in `app/api/admin/**/route.ts` directly,
not just copying the web page's `fetch` calls) surfaced bugs that had
been silently broken on web itself — the Android pages were built
against the *correct* contract from the start, and the same fix was
applied back to web:

1. **Moderation Suspend/Ban buttons always 400'd** — `admin/moderation/
   page.tsx` sent `action: "suspend_24h"` / `"suspend_7d"` / `"ban"`, none
   of which are valid values in the backend's Zod enum (`suspend_user`
   with `duration_hours`, or `ban_user`). Only Dismiss/Warn/Remove Content
   ever actually worked. Fixed both the web page and the Android port to
   send `suspend_user` + `duration_hours` (24 or 168) and `ban_user`.
2. **`/admin/payouts` and `/admin/payouts/appeals` showed "X of undefined"**
   — `GET /api/admin/payouts` moved to keyset (cursor) pagination and
   stopped returning `total`, but both web pages still read `data.total`.
   Fixed to use `hasMore` / list length instead.
3. **Payout Bank Account column always showed "—"** — `bank_account_last4`
   is a real `creator_payouts` column but `api/admin/payouts/route.ts`'s
   `SELECT` never fetched it. Added it to the query and response.
4. **Flash XP "Create" form failed on its own defaults** — the backend
   requires `fires_at` ≥ 6 hours after `announced_at` (§2.4), but the web
   page's client-side validation only enforced 1 hour, and its own
   prefilled defaults only had a 5-hour gap — so submitting the form
   exactly as first opened always 400'd. Fixed validation, error copy, and
   defaults to match the real 6-hour minimum.
5. **Gift Drop's "Gift Item" dropdown was always empty** — `GET /api/
   economy/gifts/catalogue` returns `{ tiers: [{ gifts }] }`, but the web
   page read a nonexistent top-level `items`/`gifts` key. Fixed to
   flatten `tiers`, making the Schedule Drop form usable for the first
   time.
6. **Admin Events "Create" always 400'd** — the web page posted
   `{ type: "xp_boost" | "seasonal" | "challenge" | "community" | "other" }`,
   none of which match the backend's actual `event_type` enum (`cultural`
   / `season_launch` / `flash_xp` / `guild_war_event` / `mystery_drop` /
   `platform`). It also read the POST response as a bare event object
   instead of unwrapping `{success, data: {event}}`, corrupting the event
   list on the rare case a create somehow succeeded. Fixed both.
7. **Announcements silently dropped all targeting/scheduling on save** —
   the web page's save payload used `{status, audience: {plans, roles},
   startAt, endAt}`, but the Zod schema expects `{targetPlans,
   targetRoles, startsAt, endsAt}` — every field it sent was simply
   ignored by validation, and required `title` was only filled in for
   modals, so banner creation additionally 400'd outright.
8. **Admin broadcast messages always failed to send** — the web compose
   form posted `{recipientMode, plans, roles, userIds}` with
   `recipientMode: "specific"`, but `SendMessageSchema` expects
   `{broadcastType, targetPlans, targetRoles, targetUserIds}` and
   `"specific"` isn't a valid `broadcastType` value (`"direct"` is) — no
   admin broadcast could ever be sent from the web UI.
9. **AI Settings "Test Connection" always looked like it failed** — the
   test endpoint returns HTTP 200 with no `success` field on its body, but
   the reference UI code checked `.success` (always falsy, regardless of
   whether the test actually passed). The Android page infers success from
   the absence of an error / presence of a `model` field instead.

Bugs 1, 2, 3, 4, 5, 6, and 9 were fixed in both `apps/web` and the new
Android pages (same commit). 7 and 8 (Announcements and Messages) were
caught and built correctly in the Android pages, but the two web pages
themselves were deliberately left as-is: both need more than a field
rename — the GET response is raw snake_case DB rows (`is_active`,
`target_plans`, `starts_at`, …) that don't remotely match the page's own
`AnnouncementItem`/`recipientMode` state shape, and a confident fix means
re-deriving the whole form/list against the real schema, not a one-line
patch — flagged here rather than risking a blind rewrite of ~500-line
pages with no live database available to verify against. Recommended
follow-up: rebuild both to the same contract the Android pages already
use correctly (`apps/android/src/routes/admin/announcements.tsx`,
`apps/android/src/routes/admin/messages.tsx`).

#### Pre-existing bug: `axios` was never a declared Android dependency

`apps/android/src/lib/api/client.ts` and `apiFetch.ts` import `axios`
directly and every route in the app depends on it transitively through
`apiClient` — but `apps/android/package.json` never listed it as a
dependency. Any fresh `npm install` + `vite build` failed outright
("Rollup failed to resolve import axios"), independent of anything in
this change. Added as a direct dependency (`^1.7.7`, matching the version
already pinned in `apps/web` and `apps/expo`).

---

## Appendix: Version 2.07 Change Log

### v2.07 — Changelog

#### Android forensic bug audit — 15 findings fixed (ZB-AND-01 through ZB-AND-15)

A dedicated audit of `apps/android` against web/PWA (the parity source of
truth) found 15 real, verified gaps — none required architectural change;
every fix reused a pattern already present elsewhere in the codebase.

1. **Nav chrome was hardcoded English, bypassing i18n entirely** — the
   6-item bottom tab bar (`BottomNav.tsx`) and 25-item drawer
   (`TopBar.tsx`) built their labels from plain string literals instead of
   `t()` calls, so a Hausa/Swahili/etc.-preferring user still saw English
   everywhere except the rest of the app. Wired both through
   `useTranslation()` against existing keys where one already matched the
   concept (`home.title`, `wallet.title`, …) and 17 new `nav.*` keys
   (added to all 9 locale files) where none did. **The identical gap was
   found on web's own `components/layout/Navbar.tsx`** — its bottom tab
   bar, drawer, and profile dropdown were equally hardcoded despite being
   the audit's own "already correct" baseline — and fixed the same way,
   including wiring up the `profile.dropdown.*` i18n keys that already
   existed in every locale file but were never called from anywhere.
2. **Referral deep-link capture was complete, dead code** — `lib/deeplinks/
   referral.ts`'s `useReferralCaptureFromLink()` hook was fully
   implemented but never mounted anywhere in the app (`grep` across
   `apps/android/src` found it referenced only inside the file that
   defines it), so every `?r=CODE` referral link opened via the Android
   app silently failed to attribute. Mounted at the app root
   (`routes/__root.tsx`'s `AppShell`), mirroring the (discontinued) Expo
   app's identical call site.
3. **No onboarding flow existed on Android at all (critical)** — a
   brand-new Google/Telegram signup was dropped straight onto `/home`
   with an auto-generated username, no avatar/city, no welcome XP/coins,
   and any referral code never redeemed. Added `routes/onboarding.tsx` (a
   single-page condensed version of web's 5-step wizard — username,
   avatar, display name, city, birth year, and the referral code captured
   in #2 — same `POST /api/onboarding/complete` contract, no server
   changes needed) and fixed the OAuth callback in `__root.tsx` to branch
   on `onboardingCompleted` (already returned top-level by
   `POST /api/auth/mobile-token`, per `apps/expo/app/auth/login.tsx`'s
   identical pattern) instead of always navigating to `/home`.
4. **Auth tokens stored unencrypted with app backup enabled (security)** —
   `android:allowBackup="true"` with no `dataExtractionRules`/
   `fullBackupContent` meant `adb backup` (or Android Auto Backup to
   Google Drive) could extract the JWT/refresh token wholesale from
   plaintext `SharedPreferences`. Added `res/xml/data_extraction_rules.xml`
   + `full_backup_content.xml` excluding the Capacitor Preferences
   storage file from both cloud backup and device transfer.
5. **Hardcoded `versionCode 1`/`versionName "1.0.0"` would block every
   future Play Store release** after the first (Google Play rejects any
   upload whose `versionCode` doesn't strictly increase). Now derived
   from CI (`-PversionCode=${{ github.run_number }}`), with a safe
   `hasProperty` fallback for local `./gradlew` runs.
6. **Games could not actually be played (critical)** — the Play button on
   the game detail screen had no `onClick` at all, and no
   `/games/$slug/play` route existed. Wired it to
   `Browser.open(universalLink('/g/<slug>/play'))`, the same in-app-browser
   hand-off already used for KYC and Business/Ads, rather than
   reimplementing every game engine natively.
7. **Games search fired one API call per keystroke** — no debounce,
   unlike web's explicit 250ms one. Added the same debounce.
8. **Adaptive chat poll didn't reliably pause when backgrounded** — relied
   solely on `visibilitychange`, which a sibling hook in the same
   directory (`usePresenceHeartbeat.ts`) already documents as unreliable
   inside a Capacitor WebView. Added a `@capacitor/app` `appStateChange`
   listener alongside it.
9. **"Restore Purchases" had no UI entry point** — `restorePurchases()`
   was fully implemented in `lib/payments/googlePlay.ts` but never
   imported anywhere. Added a Settings → Account action.
10. **Zero automated test coverage for the Android app** — added a
    baseline Vitest suite (13 tests: token-refresh single-flight lock,
    push-notification route allowlist, referral-capture round-trip) plus
    an ESLint flat config (the app had none at all, so `npm run lint`
    from the repo root was silently skipping it).
11. **Ad impression/click events were unbatched** — one POST per event,
    unlike web's queue-and-flush pattern. Ported the same approach
    (`lib/ads/adEventQueue.ts`, using `idb-keyval` + a `@capacitor/app`
    background-flush trigger instead of `sendBeacon`).
12. **No pull-to-refresh anywhere in the app (web, PWA, or Android)** —
    added a dependency-free `components/ui/PullToRefresh.tsx` wrapper
    (touch-delta gesture, no new native dependency) around Rooms,
    Moments, Notifications, and Messages.
13. **The on-device debug log overlay was force-enabled with no
    release-safe build path** — `.github/workflows/android-build.yml` had
    only a debug job with `VITE_DEBUG_OVERLAY=1`. Added a manual-only
    `release` job (`workflow_dispatch` input) producing a signed release
    AAB with `VITE_APP_ENV=production` and the overlay explicitly off,
    plus `signingConfigs.release` in `build.gradle` reading from
    CI-injected Gradle properties (no keystore ever committed).
14. **Chat poll "did anything change?" used a length-only compare** — a
    same-length add+remove (e.g. a new message arrives the same moment a
    moderator removes another) was silently missed. Now also compares the
    newest message id.
15. **AdMob config cached forever with no expiry** — unlike every other
    manifest-driven setting in the app (`useManifest()`'s 5-minute
    react-query `staleTime`). Replaced the bespoke module-level cache with
    a `queryClient.fetchQuery()` call against the same cache key.

#### Pre-existing bugs found and fixed during the audit (beyond the 15)

- **Web onboarding's error-response parsing never matched anything.**
  `app/onboarding/page.tsx`'s submit handler compared `data.error` against
  string literals (`"age_requirement"`, `"captcha_failed"`,
  `"username_taken"`), but every API error response is actually shaped
  `{ error: { code, message, params? } }` per `lib/api/errors.ts` — so
  none of those branches could ever match, and every onboarding failure
  (age gate, CAPTCHA, taken username) fell through to
  `setError(data.error ?? …)`, assigning a raw error *object* into a
  `string | null` state. Fixed to read `data.error?.code` /
  `data.error?.message`, and added a `params: { minAge }` payload to the
  age-gate error so the client can render the server's actual configured
  minimum age instead of a hardcoded `18` fallback.
- **The root `npm run lint` script hard-failed instead of completing.**
  `npm run lint --workspaces` (no `--if-present`) aborts the whole command
  the moment it hits a workspace without a `lint` script — `shared` never
  had one (and `apps/android` didn't either, until this change added
  one), so the command always exited non-zero after linting `apps/web`
  and `apps/android`/`apps/expo`, never reporting a clean pass. Added
  `--if-present` so a workspace with no matching script is skipped
  instead of failing the run.
- **The root `npm run typecheck` script silently never checked
  `apps/web` at all.** It runs `npm run typecheck --workspaces`, but
  `apps/web/package.json`'s equivalent script was named `type-check`
  (hyphenated) — a different string — so npm workspaces simply had
  nothing matching `typecheck` to run there, and the command reported
  success while only ever having typechecked `apps/android`/`apps/expo`.
  Added a `typecheck` alias script to `apps/web/package.json` (kept
  `type-check` as-is, since `.github/workflows/integration-tests.yml`
  calls it by that name directly) so the root command now covers all
  three workspaces.

---

### v2.08 — Changelog

#### Custom forensic audit — 25 findings fixed (ZSB-01 through ZSB-25)

A cross-platform audit (Capacitor Android as primary target, cross-
referenced against web/PWA for parity) found 25 confirmed issues spanning
one severe live crash, one real security regression, several "the plumbing
exists but nothing connects it" reliability gaps, systemic cache-
invalidation gaps, and i18n coverage gaps. All 25 were independently
re-verified against the actual code before being fixed.

**Security / severe:**
1. **Web Creator Dashboard crashed for every creator.**
   `app/(app)/creator/page.tsx` read field names (`revenue.thisWeek`,
   `dailyRevenue`, `revenueStreams` as an array, `totalMembers`,
   `payoutBalance`, `topGifters[].userId`) that don't exist anywhere in
   `GET /api/creator/dashboard`'s actual response shape — `.map()` on the
   undefined `revenueStreams` threw on every load. Rewrote the page
   against the real contract (`revenue.week/month/byStream`,
   `members.total/active/churnRate`, `topGifters[].user_id/avatar_emoji/
   total_coins`) and against the separate, PIN-gated `/api/creator/
   payouts` endpoint for balance/history/request, mirroring the
   already-correct Android contract.
2. **Register screen still used the insecure `zobia://` OAuth callback**
   that Login was specifically patched away from — any other installed
   app can register the same custom scheme and race to intercept the
   OAuth exchange code. Extracted a shared `OAUTH_CALLBACK_LINK` constant
   (`lib/deeplinks/routes.ts`) built from the verified HTTPS App Link so
   the two screens can't drift apart again.
3. **"Open in browser" hand-offs (KYC, creator bank account/wallet, admin
   KYC review, resume/play a game) had no authenticated session at all** —
   the mobile OAuth flow intentionally never sets browser cookies, so the
   Custom Tab always landed on the web login page. Added a short-lived,
   single-use "mobile bridge" endpoint (`POST /api/auth/mobile-bridge` to
   mint a code, `GET /api/auth/mobile-bridge/consume` to exchange it for a
   real HttpOnly cookie session and redirect) and an Android-side
   `openAuthenticatedWebLink()` helper that replaced every raw
   `Browser.open()` call across the six affected screens.

**Reliability — session/auth:**
4. Wired up the previously-dead `onUnauthenticated` event system
   (`lib/api/client.ts`) to `AuthProvider`, and fixed both `client.ts`'s
   and `apiFetch.ts`'s failed-refresh branches to clear the cached token
   through one shared `signalUnauthenticated()` — a user whose refresh
   token expired now actually gets signed out instead of sitting in a
   silently-broken "looks logged in, nothing loads" state.
5. Push token lifecycle now survives an account switch on one device:
   `clearAuth()` unregisters the last token server-side (new
   `DELETE /api/users/push-token`) and resets the push module's init
   latch so the next login re-registers instead of silently no-op'ing.
6. 2FA login now persists the `refreshToken` the server returns (was
   omitted from the `setAuth()` call), so 2FA users no longer get bounced
   back to login far more often than everyone else.
7. `VITE_REALTIME_PROVIDER` is now forwarded in the Android CI build
   workflow — every shipped APK/AAB previously defaulted realtime off and
   silently fell back to polling.

**Cache correctness (systemic pattern, fixed everywhere found):**
8. Coin/star-spend actions (gifts, sticker unlocks, paid Classroom
   enrolment, merch purchases) now invalidate the shared `['users','me']`
   balance query, so the Wallet screen reflects a spend immediately.
9. Buying coins/stars now also invalidates the wallet transaction-history
   query, so a purchase appears in the list without an unrelated refetch.
10. Fixed a friend-request race (`friends.tsx` read the shared mutation
    hook's `.variables` instead of the callback's own argument — accepting
    one request and declining another in quick succession could read each
    other's outcome).
11. Serialized the ad-event queue's read-modify-write (`adEventQueue.ts`)
    through an in-memory promise chain so concurrent impressions/clicks
    can no longer clobber each other.

**New capability — Web Push for PWA:** the installed PWA previously had
*zero* background push notification support regardless of what the
backend sent (`app/sw.ts` had no `push` handler at all). Added a full
VAPID Web Push implementation: `push`/`notificationclick` listeners in
`app/sw.ts`, a client subscribe/unsubscribe flow (`lib/push/webPush.ts`,
surfaced as a "Browser notifications" toggle in Settings → Notifications),
a server-side sender (`lib/notifications/webPush.ts`, using the `web-push`
package), and a third `platform: "web"` branch through the existing
`lib/notifications/push.ts` fan-out — see `docs/SETUP.md`'s new
"Push Notifications (Web/PWA)" section for the `VAPID_*` env vars.

**New capability — notification tap-to-navigate:** neither the Android
notifications list nor (it turned out, once checked) the web one actually
navigated anywhere on tap — web's `Notification.actionUrl` field was read
by the UI but never populated by `GET /api/notifications`. Added
`lib/notifications/actionRoute.ts` to derive an in-app route from each
notification's `type`/`metadata`, wired it into the API response, and
ported tap-to-navigate to Android (`lib/notifications/routing.ts`, shared
with the push-tap-handler's existing route allowlist).

**i18n coverage (keys added to all nine locales):** the Business Ads Hub
and Business Pages screens (Android) and the web Classroom page were
entirely/effectively unlocalized despite the rest of the app being fully
wired for all 9 supported locales; the Friends screen's "Recent chats" tab
was self-documented as omitted pending the missing `friends.tabs.recent`/
`friends.recent.*` keys. All wired through; the Classroom keys already
existed in every locale (Android's own port had added them) and just
needed the web page to actually call `t()`.

**Also fixed:** the onboarding CAPTCHA hang (a still-loading `grecaptcha`
script left `getCaptchaToken()`'s promise unsettled forever — now races
against an 8s timeout, both Android and web), Admin KYC's "Save schedule"
action giving zero feedback, the OAuth loading spinner clearing the
instant the Custom Tab *opened* instead of when the flow actually
finished, `PullToRefresh` failing to arm when a gesture scrolls to the top
mid-drag instead of starting there, the Android referral code never
expiring (30-day TTL added, matching web), `applyStoredLanguagePref()`
being fully implemented but never called, and a dead `VITE_ABLY_API_KEY`
env var removed before it could accidentally ship a real key into the
public APK bundle.

Also replaced the Android CI workflow's hand-maintained `push.branches`
allow-list with a `pull_request`-triggered build (plus `push` on `main`/
`android` only), so a new working branch gets a debug APK automatically
instead of silently never building until the workflow is edited.

---

## Appendix: Version 2.10 Change Log

### v2.10 — Changelog

**Session-expiry visibility.** The web "you've been signed out" modal
existed but 158 pages called `fetch()` directly against `/api/*` with no
401 handling at all, so a dead session on those pages just failed every
click silently — the modal never had a reason to fire. `window.fetch` is
now patched once at root-layout mount to catch any such 401 platform-wide
(§ Session Management); `authFetch`/`apiClient` are unaffected since they
now go through the pre-patch `rawFetch`. On Capacitor, an involuntary
sign-out now carries a reason into the login redirect and shows a banner,
instead of silently dropping the user at login.

**i18n key parity.** `shared/i18n/locales/*` (used by the Capacitor app)
and `apps/web/lib/i18n/locales/*` (used by web/PWA) had drifted apart —
1071 keys existed only in `shared`, 61 only in `web` — so raw keys like
`nav.wallet`/`admin.link` rendered literally on whichever platform was
missing them. Merged per-locale in both directions (never cross-language);
both trees now carry the same 2902 keys, each with its own locale's real
translation. `apps/expo` was left untouched (frozen, being retired).

**Blog subscribe redirect**, **Answers Share button**, **mini-badges**
(XP-level dot, Prestige diamond, verified checkmark after usernames in
chats/Moments/profiles), the **Moderation Center**, **Creator Fund**
per-activity split + manual top-up, **Android Keystore-backed token
storage**, and **in-app game playback** on the Capacitor app are each
described in their own sections above (Session Management; §31.0; §9
Mini-Badges; Moderation Architecture → Moderation Center; §14 Creator
Fund; Two-Factor Authentication → JWT storage; §30.1) rather than repeated
here.

---

## Appendix: Version 2.11 Change Log

### v2.11 — Changelog

**Staff area moved off `/admin` to `/gate44`.** The admin/moderator login and
management panel is no longer at a guessable path — the whole route tree
(`app/(admin)/admin/*` → `app/(admin)/gate44/*`), `middleware.ts`
`ADMIN_PREFIXES`/`ADMIN_LOGIN_URL`, and every internal link were moved
together. `robots.txt` no longer lists it at all (a disallow rule would
itself advertise the path), and it carries `robots: noindex`. The login
screen dropped every "ADMIN" label/badge for logged-out visitors — it now
reads as a generic sign-in screen — and `AdminLayoutShell` no longer renders
the full staff nav menu on the login/2FA-setup screens (previously a
logged-out visitor who found the URL saw the entire admin menu). Credentials
+ mandatory TOTP 2FA is unchanged (PRD §20 — still no Google OAuth for
staff), and the existing "session expired" popup/redirect flow
(`components/auth/SessionExpiredModal.tsx`) now correctly round-trips
through `/gate44/login`.

**Anti-brute-force lockout + Secret Magic Word.** Three failed attempts
(wrong password OR wrong TOTP code) on the same staff email locks that
account (`lib/auth/adminLockout.ts`, Redis-only counter, 24h fallback
auto-expiry). The only real unlock path is the "Secret Magic Word" the
admin sets in advance while logged in (`/gate44/settings/security`,
`POST /api/admin/auth/magic-word`, hashed like a password) via
`POST /api/admin/auth/unlock`. A red reminder bar
(`components/admin/AdminLayoutShell.tsx` → `AdminStatusBar`) nags any admin
who hasn't set one yet.

**Maintenance mode.** New `/gate44/config` → "Maintenance Mode" group
(`maintenance_mode_enabled`, `maintenance_message` in `x_manifest`; see
`ZobiaManifest.maintenance` in `lib/manifest/index.ts`). Enabling it prompts
a "Do you really want to enable maintenance mode?" confirm dialog. While on,
every non-staff visitor — on the landing page, `/auth/login`, and every
authenticated app page — sees the maintenance notice
(`components/maintenance/MaintenancePage.tsx`) instead of the app; staff
still get full access plus an amber reminder bar. `/auth/login?staff=1` is
a hidden (unlinked, not in any sitemap) bypass so admins/moderators can
still reach the real sign-in form during maintenance — logging in through
it grants nothing extra to a non-staff account, which still hits the same
maintenance gate post-login.

**`/admin/events` crash fixed + full event tooling.** The page crashed with
"can't access property 'replace', e.type is undefined" because
`GET /api/admin/events` returned raw snake_case columns while the page
expected camelCase — fixed by mapping the API response properly (both admin
and public `/api/events`). Event creation now supports "start immediately"
vs. "schedule for later", duration presets (1h/6h/1d/3d/7d/14d/30d/custom),
XP-multiplier presets (1/1.5/2/3/4/5×), and monthly recurrence alongside the
existing annual-anchor recurrence (`recurrence_interval` column, migration
`0010`; cron `daily-platform` clones monthly events one calendar month
forward). Active/upcoming events are now promoted near the top of every
authenticated page (`components/events/ActiveEventStrip.tsx`, sourced from
the existing public `/api/events`) and a one-time "New Event" popup fires
the first time a viewer sees a newly-live event — tracked entirely in
`localStorage`, no new server calls.

**Admin impersonation.** "Impersonate this user" in `/gate44/users`'
per-user detail panel logs the admin in as that user for up to 15 minutes
(`POST /api/admin/users/[userId]/impersonate`) while stashing the admin's
own session in a short-lived cookie pair; "Return to Admin"
(`components/admin/ImpersonationBanner.tsx`, shown app-wide via a
non-HttpOnly marker cookie so it costs zero extra Redis reads for everyone
else) restores it (`POST /api/auth/impersonate/end`). Both endpoints also
serve Bearer-JWT clients: detected the same way withAdminAuth/withAuth
already tell a mobile client apart from a cookie client (an `Authorization:
Bearer` header on the request), each returns a fresh access/refresh token
pair in the JSON body instead of Set-Cookie headers — the target's on
start (plus the admin's own id via the token's `impersonated_by` claim so
the client knows who to restore), the admin's own on end. The Android app
(`apps/android/src/lib/auth/store.ts`'s `impersonate()`/`endImpersonation()`,
wired into `routes/admin/users.tsx`, `routes/admin/data-management.tsx`, and
`components/admin/ImpersonationBanner.tsx`) uses this to switch its own
stored session natively — no in-app browser involved. Cannot target another
admin account. Both start and end are written to `admin_audit_log`.
**Capacitor Android:** the impersonate endpoint is cookie-session-based, not
Bearer-JWT-based, so `admin/users.tsx`'s "Impersonate" button opens the
web admin in the app's existing authenticated in-app browser bridge (the
same one used for KYC) rather than switching the native client's own
session; `components/admin/ImpersonationBanner.tsx` (Android) is wired into
`AdminShell` and will start rendering automatically once/if the backend is
extended to also expose `impersonated_by` over Bearer sessions.

**Mods/admins can edit forum content.** `/gate44/forum/posts` gained an
Edit action (question title+body, or answer body) via a new `edit` action
on `PATCH /api/admin/forum/posts/[id]`, available to both moderators and
admins (unlike restore/lock/unlock, which stay admin-only).

**Currency name is no longer hard-coded "coins".** `/gate44/refunds` (was
"Coin Refunds") and the Financial Monitoring anomaly alerts/headings now
read from the existing admin-configurable currency name
(`lib/hooks/useCurrency.ts` client-side, `manifest.currency` server-side)
instead of a literal "coins" string.

**Admin test payments.** `/gate44/config` → "Test Payments" starts a real
₦1 checkout with whichever Paystack keys are currently
configured (`POST /api/admin/payments/test`), so an admin can confirm a
provider integration end-to-end without a real customer transaction. Marked
`payment_type = 'admin_test'` and explicitly excluded from both coin/star
crediting and Creator Fund revenue in both webhook handlers.

**`/gate44/games` stats + responsive table.** The "Stats" button no longer
dumps raw JSON at the bottom of the page — it opens a formatted popup with
stat tiles. The games list table collapses less-critical columns on narrow
screens and scrolls properly within its own bounded wrapper instead of
appearing cut off with no visible scrollbar on mobile web/PWA.

**Announcements: 400 on every banner, 500 on every save — fixed.** Banner
creation always 400'd because `title` was required for both modals and
banners even though the banner form never sends one. Every create/update
(both types) always 500'd because `target_plans`/`target_roles` — native
Postgres `text[]` columns — were being `JSON.stringify()`'d into a malformed
array literal instead of passed as real arrays. Both fixed in
`app/api/admin/announcements/{route,[id]/route}.ts`, and the request/response
shape now matches what the admin page actually sends end-to-end
(`audience{plans,roles}`, `startAt`/`endAt`, `status`). The recipients
picker's plan list ("basic"/"vip", neither a real plan) is replaced by
`lib/plans/allPlanOptions.ts`, sourced from the platform's actual personal
plans (free/plus/pro/max) and business tiers (starter/growth/enterprise) —
adding or removing a tier in that shared module updates the picker
automatically. New announcements default to every non-business plan + every
role selected.

**Follow-up not in this batch:** `app/(app)/layout.tsx` resolves the
announcement-targeting `plan_id`/`role` as hard-coded `null` for every user,
so plan/role-scoped announcement targeting (not the recipients *picker*
fixed above, but who actually receives it) doesn't yet work end-to-end —
worth a dedicated pass.

**New migrations to run:** `db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.12 Change Log

### v2.12 — Changelog

**Admin Audit Logs viewer.** `admin_audit_log` (config/KYC/payout/feature-flag/
etc. writes made through the admin panel) and `audit_log`
(login/2FA/PIN/ban-suspend security events, `lib/audit/auditLog.ts`) were
write-only — no page ever read them back. New `/gate44/audit-logs`
(`GET /api/admin/audit-logs?source=admin|security`, admin-only, linked from
the staff nav) with source tabs, action/actor/date filters, and a detail
modal (before/after diff, metadata, IP/user-agent). Both tables are
keyset-paginated (`created_at, id`) — see `db/migrations/0001_consolidated_schema.sql`
for the supporting indexes — so listing stays fast at any table size, no
OFFSET scans. **Retention:** to keep these tables from growing forever,
`app/api/cron/daily-platform/route.ts` now also prunes rows older than 365
days in bounded batches (`lib/audit/pruneAuditLogs.ts`) — added to the
existing daily-platform slot rather than a new cron entry, since Vercel
Hobby only allows daily crons and this project's cron-slot budget is
already spent. If longer retention is ever needed for compliance, archive
to cold storage before deleting rather than raising the window indefinitely.

**Footer scripts fixed (were silently no-ops).** Two independent bugs: (1)
the `<script src="/api/static/footer-script/[id]">` tag in `app/layout.tsx`
carried no nonce, and the page's CSP is `script-src 'nonce-<nonce>'
'strict-dynamic'` with no `'self'` (`'strict-dynamic'` makes host allowlists
inert per CSP3) — browsers silently dropped the tag. Now nonce'd. (2) The
admin form's own placeholder told admins to paste a full `<script>...
</script>` tag, but the content is served as a raw JS file
(`Content-Type: application/javascript`) — a literal `<script>` token is a
JS syntax error, so anything pasted that way (the common case for
analytics/embed snippets) failed silently. `lib/admin/footerScriptNormalize.ts`
now parses whatever is pasted (bare JS, one `<script>` tag, or several,
inline and/or with `src=`) into a flat executable JS body at save time — a
`src` tag becomes a dynamically-inserted `<script>` element, which
`'strict-dynamic'` trusts regardless of host because a nonce'd script
inserted it.

**Eligibility gating extended to business tiers + staff roles.**
`lib/plans/eligibility.ts`'s `isPlanEligible` allow-list previously
understood only plan slugs and `prestige_N` entries. It now also matches
`business_starter`/`business_growth`/`business_enterprise` (against the
user's active `business_accounts.tier`) and `role_admin`/`role_moderator`
(against `users.is_admin`/`is_moderator`) — same flat-array-in-x_manifest
mechanism, just a richer vocabulary. `/gate44/settings/privacy` and
`/gate44/settings/profile-stats` now offer every prestige level (1–10, was
a hardcoded 1/2/5/10 subset), all three business tiers, and both staff
roles as selectable options, with defaults changed to "everyone except
free" (hide sections / disable friend requests / Profile Stats full view)
or "everyone except free and plus" (lock profile) — previously only a
narrow plan+prestige_1 subset was selected by default. `app/api/features/route.ts`
had its own second copy of the eligibility check (missing business/role
support entirely); it now calls the shared helper instead of duplicating it.

**`/gate44/config` categories collapse by default.** Every settings
category now starts minimized; expanding/collapsing one is remembered in
`localStorage` (`zobia_admin_config_open_groups`) — a per-device UI
preference, not platform config, so it isn't written to `x_manifest`.

**`/gate44/moderation` Resolved/Escalated tabs fixed.** `GET
/api/admin/moderation` returned raw snake_case rows (`report_type`,
`ai_category`, …) with no camelCase mapping and no derived `targetType`,
so the page's own `Report` interface never matched what it actually got —
crashing on `report.reportType.replace(...)` the moment a report existed
(the Pending tab only avoided it by usually being empty). Also, `escalated`
wasn't in the status route's validation allow-list, so the Escalated tab
silently fell back to Pending. Both fixed with a proper row→camelCase
mapper (also now returns the resolving action's type) and defensive
`?? "other"` fallbacks in the UI.

**`/gate44/messages` list + detail crash fixed.** Same root cause as
moderation: `GET /api/admin/messages` and `GET
/api/admin/messages/[id]` returned raw snake_case rows/an unmapped
`{message, receipts}` shape while the page's `SentMessage`/`MessageDetail`
types expected camelCase (`recipientsCount`, `deliveredCount`, `deliveries`,
…) — fixed with proper mappers on both routes, plus defensive `?? 0`
guards on the `.toLocaleString()` call sites.

**`/gate44/events` crash hardened.** The camelCase mapping fixed in v2.11
was already correct; added a defensive `event_type ?? "platform"` fallback
server-side and `(event.type ?? "unknown")` client-side in case of stale
rows or a degraded response from the database circuit breaker
(`lib/payments/circuit.ts`) — a null/undefined `type` should render as
"unknown", never crash the page.

**`/gate44/games` milestones: full CRUD + the 400 explained.** The
Games-played milestones manager only supported add/delete. Add now
validates the threshold client-side before submitting (the reported
`POST /api/admin/game-milestones` 400s were simply the Add form being
submitted with the threshold left at its default of 0, which fails the
`min(1)` schema — there's no cron involved). Edit is now supported inline
(rewards + active flag, via the existing `PUT /api/admin/game-milestones/[id]`
that already existed but had no UI) with a delete confirmation.

**`/gate44/creator-spotlight` username search.** Replaced the raw
"paste the creator's UUID" field with the same debounced username-typeahead
component used by the admin Messages composer (`GET /api/admin/users?q=`),
so admins no longer need to look up a UUID manually.

**User Management modal.** Action buttons in the user detail panel are
taller (44px min height) and every mutating action (suspend, ban, restore,
mod status, password reset, force-2FA, mark-verified, impersonate) now
requires an explicit confirm step. On success the panel stays open,
refreshed with the post-action user row, instead of closing back to the
bare list — admins commonly take several actions on one user in a row.

**New migrations to run:** `db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.13 Change Log

### v2.13 — Changelog

**Answers admin area renamed** `/gate44/forum` → `/gate44/answers` (301
redirects kept for old links), with a persistent tab bar across
Overview/Queue/Posts/Settings so navigating between tabs no longer strands
you without a way back to the others. Posts-management and moderation-queue
tables now show an icon link to the live post and a link to the author's
profile, both opening in a new tab. Admins can hard-delete a post (distinct
from the existing soft "remove"), gated behind a confirmation dialog; soft
removal now also confirms before acting.

**Generalised feature-flag gating pattern** — `useFeatureFlags`/
`useFeatureEnabled` (`lib/hooks/useFeatureFlags.ts`) plus a `NotFoundGate`
component (`components/shared/NotFoundGate.tsx`): when an admin turns a
feature off, its nav entry disappears for regular users while admins still
see it with a warning icon, and the page itself shows a not-found view to
non-admins with an explanatory banner for admins. Wired up for Answers as
the reference consumer; other optional features should adopt the same
pattern as they're touched.

**Ads: prepaid Ad Wallet, advertiser identity, granular admin eligibility.**
A new Ad Wallet (`users.ad_wallet_balance` + `ad_wallet_ledger`, mirroring
the main Credits ledger's idempotent pattern) is a distinct prepaid balance
for running ads — campaign funding now draws from it instead of the main
Credits balance. Fundable by transferring from the main wallet or buying
Credits directly (the existing purchase flow gained a `destination` flag
routing the webhook credit into the Ad Wallet). Campaigns can be created,
previewed, and submitted for moderation with an empty Ad Wallet — they
simply won't serve impressions until funded, with a notification on
activation if still unfunded. Admin can now configure, from a new Settings
tab on `/gate44/ads`: whether personal (non-business) accounts may
advertise, whether KYC is required at all, a level gate for free-plan
advertisers, and an optional level floor for paid/business advertisers too.
Advertisers choose which identity is shown as the advertiser — their
personal profile, their Business Account, or one of their Business Pages —
and campaign ownership is now keyed on `created_by` (the user) rather than
`business_account_id`, so a personal-advertiser campaign works the same as
a business one. When a campaign's business account/page stops qualifying
(subscription lapses, verification pulled), its ads keep running under the
stale advertiser identity for an admin-configurable grace period (default
14 days) instead of stopping immediately, swept from the existing
daily-economy cron. The `/ads` hub now shows KYC verification and Business
Account setup as a connected two-step todo list with checkmarks, showing
only whichever steps the admin config actually requires. "Run Ads" added to
Business Account (Starter) benefits.

**AI: Groq added as a 3rd fallback tier; generic provider registry; 48-hour
call-monitoring log.** The hand-rolled, duplicated-per-provider DeepSeek/
Gemini circuit breaker in `lib/ai/client.ts` is now a generic factory
(`lib/ai/circuit.ts`) driven by a provider registry (`lib/ai/config.ts`
`AI_PROVIDERS`) — adding a new provider or model is a config entry plus one
adapter function, not a copy-pasted block. Fallback chain is now DeepSeek →
Gemini → Groq (default model GPT-OSS-120B, Llama 3.1 8B Instant selectable),
with the chain order and each provider's model admin-configurable from
`/gate44/ai-settings`. New `ai_call_log` table (rotated by an external-cron
`rotate-ai-call-log` route — Vercel Hobby only allows daily crons) records
every AI-backed feature call (report moderation, Sponsored Quest review, ad
creative review, KYC name matching, KYC document analysis) with provider,
model, confidence, latency, and outcome, surfaced in a "Recent AI Calls"
panel on the AI Settings page. Ad image creatives now always route through
an image-capable model (Gemini Vision) rather than the text classifier,
which cannot see images; admin can set text and image ad auto-approval
independently.

**Answers: hidden 3rd-level replies fixed; tabs reordered; category pages;
related posts.** Real bug: `listAnswers()` only computed reply counts for
top-level questions' direct (depth-1) replies, so every depth-1 reply
always got `replyCount=0` — the "view N more replies" affordance (which
already existed in the UI, backed by an already-correct recursive-CTE
thread-expand endpoint) could never fire, making 3rd-level-and-deeper
replies unreachable. Fixed by also counting each depth-1 reply's own
children. Homepage tabs reordered to Trending, Popular, New, Faves with
Trending as the default (the "trending" sort already existed server-side).
Added a "Religion and Spirituality" category and split "School & Career"
into "Schools and Education" (renamed in place, keeping existing
questions' category) and "Career and Jobs"; admin can now create, rename,
and delete categories (with icon) from `/gate44/answers/settings` — deleting
a category that still has questions is blocked rather than orphaning them.
New reusable `CategoryList` component (horizontal/vertical, with question
counts) on the Answers homepage and on new public, indexable
`/answers/category/<slug>` pages (Latest/New/Trending/Popular tabs scoped
to one category, `CollectionPage` JSON-LD). Related posts (5), new posts
(3), and recently-answered posts (3) mini-lists added below the answers
list on both the public SEO page (`/a/<slug>`) and the authenticated
question detail page. The "write an answer" composer now starts minimized
and expands into the full form on click, matching the existing reply-box
pattern.

**New: old-school BB-style forum stub** at `/forum` (boards/sub-boards) with
short, SEO-friendly canonical thread URLs at `/f/<title-slug>` — distinct
from the Answers Q&A feature. New tables (`bb_boards`, `bb_threads`,
`bb_posts`); all three page types are public SSR with metadata/OG tags and
`DiscussionForumPosting` JSON-LD on thread pages, added to the sitemap and
to `middleware.ts`'s public-route allowlist. Starting a thread or replying
requires sign-in and an admin-configurable minimum account level (default
1). Gated by a new `bbforum` feature flag, with its own "Forum" nav entry
distinct from "Answers". This is a functional stub — real schema, working
navigation and posting, seeded with 3 starter boards — moderation tooling,
reactions, and rich text are left for a follow-up iteration.

**New migrations to run (in order):** `db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`, `db/migrations/0001_consolidated_schema.sql`.

**Not done in this pass** (flagged rather than silently skipped): forum
auto-moderation remains rules-based (profanity/duplicate detection) and was
not wired to the AI classifier — investigate as a separate follow-up if
AI-assisted forum moderation is wanted; the Answers homepage's "sitewide
notices/highlights" banner and a platform-wide "newly answered" digest were
not built (no existing sitewide-notices system was found to hook into, and
building a parallel one was judged out of scope for this pass).

---

## Appendix: Version 2.14 Change Log

### v2.14 — Changelog

**Blogs: markdown/plain-text editor mode, per-post reward pots, nav menu
builder, quota nag, theme engine v2, auto-created default pages, and
Rewarded Gifts.** See § 32.4.1 and §§ 32.6–32.12 for full detail; summary:

- Authors can now write a post in plain text as well as Markdown
  (`blog_posts.content_format`) — no forced Markdown syntax for authors
  who don't want it (§ 32.7).
- Blog owners can fund a Credits reward pot for a specific post; the first
  N readers to comment or share it split it evenly (§ 32.8), backed by new
  `blog_post_shares`/`blog_post_treasuries`/`blog_post_treasury_claims`
  tables.
- Owner-configurable navigation menu (`blogs.menu_config`) rendered as a
  horizontal or vertical bar on desktop web (always a hamburger accordion
  on Android/mobile), plus a visitor-invisible owner toolbar on the public
  pages and a first-6-words slug-generation rule with redirect-on-rename
  (§ 32.9).
- Dashboard and new-post editor show a live "N articles left" nag driven
  by the existing per-plan post-count manifest keys, never hardcoded
  (§ 32.10).
- The theme system moved from a 3-skin cosmetics-store afterthought to a
  proper `blog_themes` catalogue with 5 themes across 4 structurally
  distinct layouts, plan/tier-gated and admin-editable without a redeploy
  (§ 32.4.1); the old cosmetics-equip path still no-ops harmlessly for old
  clients.
- Every new blog is auto-seeded with About/Privacy/Contact pages
  (resettable to template, survive rename); Contact renders a live,
  captcha-protected form instead of static content, feeding an owner inbox
  (§ 32.11).
- **Rewarded Gifts**: owner-defined per-blog gift tiers (VIP comment badge,
  paywall-style section-access unlock, or a custom reward combining a
  blog-level treasury payout and/or a revealed text blob) purchasable with
  Credits or Stars, plus a sitewide `blog_monetization_enabled`
  kill-switch that also covers the existing paywall/treasury features in
  one flip, and a narrower `feature_blog_gifts` flag for Gifts alone
  (§ 32.12).
- Also fixed as part of final QA on this batch: `t("blogs...")` calls in
  several dashboard/editor/treasury/quota components referenced i18n keys
  that existed in the Android locale file but not the web one (silently
  falling back to the hardcoded default string) — added the missing keys
  verbatim to `apps/web/lib/i18n/locales/en.json`; and the public comments
  list showed a moderator-visible pending comment with no visual
  difference from an already-approved one — added a "pending" badge next
  to the existing VIP badge.

**New migrations to run (in order):** `db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`. All 7 were verified end-to-end against
a fresh local Postgres 16 database (run cleanly in order with no errors,
right after `0001_consolidated_schema.sql`).

**Not done in this pass**: the web "Start a Blog" page still doesn't
surface the extra-blog-slot purchase currency choice or business-blog
creation inline (the API and Android already support both) — flagged in
§ 32.1 as a follow-up UI phase rather than built here, to keep this pass
to verification/bugfixing of what already shipped.

---

## Appendix: Version 2.15 Change Log

### v2.15 — Changelog

**Business Accounts: payment redirect fix, per-tier signup, working plan
expiry, renewal flow, broadcasts, and a real control-panel hub.** See §17
for full detail; summary:

- **Fixed**: business signup/upgrade Paystack checkout never passed a
  `callback_url`, so a successful payment left the user stranded on
  Paystack's own success page instead of returning to Zobia. Now redirects
  to `/settings/business/callback`, mirroring the existing subscription
  flow.
- **Fixed**: the Business hub and settings page only ever offered a single
  "Create Business Account" button, which always signed up on Starter.
  Both now show a separate button per tier (Starter/Growth self-serve,
  Enterprise "Contact Us"); `POST /api/business` accepts a `tier` field.
- **Fixed a deeper bug this surfaced**: `business_plan_ends_at` was always
  `NULL` — nothing ever populated `business_accounts.subscription_id`
  (and the personal `subscriptions` table is unique-per-user, so reusing it
  for a concurrent business subscription would have collided with a
  business owner's own personal plan). The "business plan nearing expiry"
  reminder could never fire, and the grace-period sweep for business tiers
  was dead code that would have thrown a CHECK-constraint violation the
  first time it ran (`status = 'grace'`/`'lapsed'` weren't valid values).
  Added `business_accounts.current_period_ends_at`, set on signup/upgrade/
  renewal; fixed the status constraint; the sweep and the expiry reminder
  now both actually work.
- Added a manual **renewal** flow (`POST /api/business/renew`,
  "Renew Now"/"Renew Early" on `/settings/business`) since Paystack/
  DodoPayments checkout is a one-off charge with no native recurring
  billing — closes the loop the expiry reminder opens. Android/Capacitor
  is unaffected (Google Play Billing renews natively there).
- Added a **Cancel Pending Transaction** action
  (`DELETE /api/business/pending`) for the existing "you already have a
  payment in progress" guard, and the error now states when it expires —
  addresses the abandoned-checkout edge case where a user closes the
  Paystack tab mid-payment and previously had to wait out the 30-minute
  TTL to retry.
- Added **Business Broadcasts** (`/business/broadcasts`,
  `/api/business/broadcasts`) — opt-in followers only, metered per month by
  tier (Starter 3, Growth 10, Enterprise unlimited), tagged with
  `business_account_id` in `creator_broadcasts` so it can never bleed into
  a user's separate personal creator-tier broadcast quota.
- Expanded the Business hub (`/business`) into a fuller control panel: a
  Business Pages preview (top 3 + slot usage), a Broadcasts link, and a
  tier-gated "More Features" row (Sponsored Quests, Custom Room Theming,
  API Access) shown dimmed with an upgrade chip when the account's tier
  doesn't qualify. Settings → Business Account → **Manage** now links to
  `/business` (the hub) instead of straight to the billing sub-page.
- Android/Capacitor business hub mirrored: added Stats and Broadcasts
  links (Stats didn't exist there before) and the business plan expiry
  banner.

**New migrations to run (in order):**
`db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`.

**Not done in this pass**: full Paystack/DodoPayments *native* recurring
billing for Business Accounts (a Plans/subscription-object integration
mirroring the personal Plus/Pro/Max flow) — the manual renew action above
closes the immediate gap (the expiry reminder now has something to link
to), but an auto-charge-on-renewal flow is a larger, separate payments
feature and was intentionally left alone here rather than rushed.

---

---

## Appendix: Version 2.16 Change Log

- **New: Old-School Forum, fully built out (§33).** The `/forum` and `/f/<slug>`
  BB-style forum introduced as a minimal stub in v2.14 (boards/threads/posts
  CRUD only) is now feature-complete:
  - Plain text/Markdown post editor with paragraph-preserving plain-text
    rendering (blank-line runs collapse to one), sanitized server-side via
    a new `sanitizeForumPostContent()` dispatcher in `lib/security/htmlSanitizer.ts`
    that reuses the existing blog-post sanitization pipeline rather than
    adding a new one.
  - Optional image attachments (`POST /api/forum/uploads/image`), costing
    admin-configurable Credits and/or Stars, charged atomically with the
    thread/post write.
  - A quote system (`bb_posts.quoted_post_id`) and toggleable emoji
    reactions (`bb_post_reactions`).
  - XP/Credit rewards for posting and replying (default 1 XP / 0 Credits),
    daily-capped and awarded post-commit — mirrors Answers' reward pipeline.
  - A reply "pot"/treasury: the OP can fund a fixed Credits payout to the
    first N repliers, debited up front and paid out per qualifying reply;
    unclaimed balances auto-refund after 14 days of thread inactivity via a
    new step folded into the existing `/api/cron/daily-economy` aggregator
    (no new Vercel Cron entry).
  - Full admin surface: `/gate44/forum` (board CRUD), `/gate44/forum/queue`
    (moderation, wired into the shared `moderation_reports` pipeline via new
    `reported_bb_thread_id`/`reported_bb_post_id` columns), `/gate44/forum/settings`.
  - Auto-moderation (duplicate-post + profanity filtering) reusing
    `lib/moderation/contentFilter`, extended with `bb_thread`/`bb_post`
    targets rather than duplicated.
  - Edit/delete for post authors and moderators, thread lock/pin for
    moderators.
  - Mirrored in the Capacitor Android app at `/forum`, `/forum/<boardSlug>`,
    `/forum/thread/<slug>`, calling the same REST API as web/PWA.
  - ~40 new `bbforum.*` English i18n keys registered in both
    `apps/web/lib/i18n/locales/en.json` and `shared/i18n/locales/en.json`
    (the Android app's translation source) plus a `nav.bbforum` entry that
    was previously only defined on the web side.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql`.

**Not done in this pass**: full Drizzle ORM typings for the `bb_*` tables in
`lib/db/schema.ts` (the raw-SQL migrations remain the source of truth, as
they already were for the v2.14 stub — this is a typing-convenience gap,
not a functional one); in-app Markdown rendering on the Capacitor Android
client (bodies render as plain `whitespace-pre-wrap` text there, matching
the existing Answers detail route's own simplification); translating the
new `bbforum.*` keys into the platform's other supported locales (only
English was added — the existing locale files already lag this way for
several other recent features).

---

## Appendix: Version 2.17 Change Log

### v2.17 — Changelog

#### New Feature: Support Ticket System (§33)

A full staff-worked support ticket queue: admin-configurable eligibility
(plan/prestige allow-list, reusing `lib/plans/eligibility.ts`) with a
paid-access fallback (one-time Credits/Stars cost), four selectable
message-charging models, a new sitewide `is_support` role (grantable
exactly like `is_moderator`) plus a `is_senior_support` flag, a
support→senior-support→admin escalation path, and optional AI-first
triage via the platform's existing DeepSeek→Gemini client with a "talk to
a real person" hand-off. Ships on web/PWA (`/support/*`) and the Capacitor
Android app (`apps/android/src/routes/support/**`). New tables:
`support_tickets`, `support_ticket_messages`, `support_ticket_events`
(audit log — no separate escalation table); two new boolean columns on
`users`. New admin panel at `/gate44/support/{queue,settings}` and
`/gate44/support/tickets/:id`, reachable by support/moderator/admin per an
admin-configurable role allow-list, not admin-only. New migration:
`db/migrations/0001_consolidated_schema.sql`.

#### New Feature: Help Center Expansion (§34)

The static `/help` FAQ became a database-backed Help Center: SEO-friendly
`/help/<category>/<doc>` URLs with stable slugs (retired slugs 301 via the
existing `slug_redirects` mechanism, widened to cover `help_doc`/
`help_category`), difficulty tiers (First Time/Beginner/Intermediate/
Advanced), Postgres full-text search (`/help/search`), and an "Ask AI"
block on every doc page that hands off to a Support Ticket (prefilled with
the AI transcript) gated by the same eligibility/cost rules as §33 — with
an admin override to make the Help Center's human hand-off always free.
No AI call is made for logged-out visitors, client- or server-side. New
admin CRUD at `/gate44/help-center`; browsing (not the CRUD) mirrored on
Android at `apps/android/src/routes/help/**`. New tables:
`help_categories`, `help_docs` (with a trigger-maintained `tsvector`
search column). New migration: `db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.18 Change Log

### v2.18 — Changelog

#### Bug fix: DM "new conversation" flow

Clicking a user in the "New Message" search dialog navigated to
`/messages/<userId>` and treated the recipient's user id as a
`dm_conversations` id — which never matched, so the page always showed
"Conversation not found". Fixed with a "draft mode": the client now
navigates to `/messages/<userId>?draft=1`, loads the recipient's public
profile directly instead of a (nonexistent) conversation, and the first
send goes through `POST /api/messages/dm` (which atomically creates the
conversation and now returns its real `conversation_id`), after which the
client swaps the URL to the real conversation id. Mirrored on the
Capacitor Android app, which previously had no "New Message" flow at all
(added one). Also fixed along the way: the DM gift picker was calling
`POST /api/economy/gifts/send` without the required `recipientId` field
(sent `context`/`conversationId` instead, which the endpoint doesn't
accept), so sending a gift from an open DM was completely broken; and the
group-create page rendered a server error object directly as a React
child (`{error}`) instead of its `.message`, which would crash the page
on any validation error.

#### Bug fix: Inbox unread state reverting on refresh

`POST /api/inbox/[messageId]/read` updated `admin_message_receipts` using
columns (`message_id`, `recipient_id`) that don't exist on that table (the
real columns are the receipt's own `id` and `user_id`), so the read
timestamp was never actually persisted — the optimistic UI showed "read"
until the next page load reverted it. Fixed to match the receipt's real
primary key.

#### Rename: Inbox → Announcements

`/inbox` is now `/announcements` (route, API routes, nav entry, i18n
namespace) on web/PWA and Android, with a permanent redirect from the old
path/API routes for existing bookmarks and already-sent push notification
deep links. The name changed because "Inbox" was easily confused with the
two-way Messages feature; this is a one-way admin-broadcast view.

#### New Feature: Group Chat hardening (concurrent capacity, creation
gating, moderation, invitations)

- **Concurrent capacity cap** (default 20, admin-configurable, separate
  from the existing 300–1000-member total-membership cap): mirrors the
  Room presence-cap mechanic exactly, including a paid capacity upgrade
  (creator spends Coins per step, admin sets cost/step and a hard
  ceiling). New shared primitive `lib/presence/generic.ts`, used by both
  `lib/presence/room.ts` (refactored, same public API) and the new
  `lib/presence/group.ts`.
- **Who can create group chats**, admin-configurable per plan/business
  tier (`manifest.groupChatCreationLimits`): Free/Plus blocked by default,
  Pro 3, Max 10, Business Starter/Growth/Enterprise 5/10/20 concurrently-
  active groups; Guild owners (founders) always get at least one
  regardless of plan.
- **No rewards for posting** in a group chat (XP, quest progress, and
  guild-war contribution were all removed from the send path) — the one
  exception is a Business account group creator's configurable one-time
  join credit (never on rejoin) and/or first-N-messages credit, both paid
  via the existing Coins ledger with idempotent references.
- **Moderation:** admin can suspend ("mute") a member for a fixed duration
  (30m/1h/3h/1d/3d/7d/30d) or lift it early; admin can remove any member;
  a member can leave; a user can block a group entirely (new
  `group_chat_blocks` table, mirrors `user_blocks`).
- **Invitations:** admin + admin-selected participants can invite by
  default, or any member if the group/manifest allows; gated by a new
  per-user privacy setting (`users.group_invite_privacy`: anybody/friends/
  nobody, default friends) with the PRD-specified denial copy.
- **Grace-period deactivation & reactivation:** "group_chats" joins the
  grace-preservable feature registry — a creator's groups deactivate once
  their subscription's grace period fully elapses (not immediately on
  lapse), and on renewal they're prompted to reactivate each one
  individually.
- New admin config section at `/gate44/config` ("Group Chats") for all of
  the above numeric/boolean settings, seeded with defaults by the
  migration below.
- New migration: `db/migrations/0001_consolidated_schema.sql` (new columns on
  `users`, `group_chats`, `group_chat_members`; new tables
  `group_chat_blocks`, `group_chat_reactivation_choices`; seeded
  `x_manifest` rows for the new admin settings).
- **Not ported to Android in this pass** — group chats have no Capacitor
  screens at all yet (pre-existing gap, tracked in the "Not yet done"
  list above); this hardening work is backend + web/PWA only.

---

## Appendix: Version 2.19 Change Log

### v2.19 — Changelog

#### Group Chats ported to the Capacitor Android app

Closes the gap called out in v2.18: group chats had no Android screens at
all. Added `apps/android/src/routes/messages/groups/{index,create,$groupId}.tsx`,
mirroring the web/PWA pages feature-for-feature — group list with the
renewal-time reactivation prompt, group creation (name/tag/friend picker),
and the group chat screen itself (message feed with realtime + adaptive
poll, live-presence heartbeat driving the "chat is full" notice, a members
panel with admin mute/remove actions, and a header menu for leave/block
group). A "Groups" entry point was added next to "New Message" on the
Android Messages screen, matching web. No backend changes — this pass
consumes the same `/api/messages/group/*` endpoints added in v2.18.

---

## Appendix: Version 2.20 Change Log

### v2.20 — Changelog

#### New Feature: Polls & Quizzes (§36)

Users can create custom Polls (others vote) and custom Quizzes (others take
and get scored), at public SEO-friendly `/poll/<slug>` and `/quiz/<slug>`
URLs, following the exact same feature-flag → eligibility → level-gate →
atomic-write → best-effort-reward pipeline as Answers/Blogs/Forum.

- Baseline XP/Credits for creating a poll/quiz and for voting/taking one
  (default 1 XP, 0 Credits each), admin-configurable with a rolling-24h
  Credits cap — same shape as the Answers reward config.
- Optional creator-funded reward pots: the first N voters/sharers (polls)
  or passers/sharers (quizzes) split a Credits pot the creator (or an
  admin) funds. Generalises Blogs' per-post treasury mechanic
  (`blog_post_treasuries`) into two shared tables
  (`content_treasuries`/`content_treasury_claims`, a `content_type`
  discriminator) instead of a third bespoke implementation, plus a shared
  `content_shares` table for idempotent share tracking. New
  `lib/contentTreasury.ts`.
- Site admins can CRUD/disable individual polls/quizzes
  (`/gate44/polls`, `/gate44/quizzes`), configure baseline rewards
  (`/gate44/polls/settings`, `/gate44/quizzes/settings`), and
  independently kill-switch each feature and its monetization sub-feature
  (`feature_polls`, `feature_quizzes`, `poll_monetization_enabled`,
  `quiz_monetization_enabled`).
- Mirrored feature-for-feature in the Capacitor Android app
  (`apps/android/src/routes/polls/*`, `.../quizzes/*`, plus the two new
  admin screens), and registered in the PWA-served nav/sitemap the same
  way as Answers/Blogs.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.21 Change Log

### v2.21 — Changelog

#### New Feature: Tweets (§37)

A lightweight, Twitter-style social primitive at `/tweets` — short text
posts with an optional Credits-charged image, an optional free YouTube/
TikTok video embed, replies, retweets (plain and quote), likes, pinning,
and four feed tabs (For You/Friends/Following/Mentions).

- **Creation**: Level 2+ by default (`tweets_min_level`), master toggle
  `feature_tweets`. `@username` mentions parsed and routed through the
  existing notifications pipeline; a stable `/tweets/<id>` deep link on
  both web and the Capacitor app.
- **Media**: an image upload costs `tweets_image_cost_credits` (default 5,
  admin-configurable to 0), charged atomically with the Tweet in one
  transaction, same shape as `createMoment()`. A video embed (YouTube or
  TikTok) is always free — see §37.1 for the TikTok short-link resolution
  approach and the Capacitor WebView rendering caveat (native `embed.js`
  hydration on web; a "Watch on TikTok" external-open card on Android).
- **Configurable length** (§37.3): replaces a flat character cap with an
  admin-configured default (`tweets_default_max_length`, 280 chars), a
  role-or-level long-form exemption (`tweets_long_min_role` reusing
  `lib/plans/eligibility.ts`'s existing role/plan allow-list pattern,
  OR'd with `tweets_long_min_level`) that unlocks free long Tweets up to a
  per-user personal length setting, an admin ceiling on that personal
  setting expressed in words (`tweets_long_max_length`), and a per-Tweet
  Credits charge (`tweets_long_tweet_cost_credits`) for non-exempt users
  who post over the default length.
- **Replies** (§37.4): a reply is a Tweet with `parentTweetId` set — no
  separate table. Shown as a chronological, cursor-paginated thread on the
  Tweet's `/tweets/<id>` page, with an inline reply composer.
- **Retweets** (§37.5): plain or quote (with added commentary), toggleable,
  no separate charge. Attributed as "`@username` retweeted" in the
  retweeter's profile and in followers'/friends' feeds via a `UNION ALL`
  between authored and retweeted Tweets.
- Site admins configure all of the above at `/gate44/config` (group
  "Tweets"); reports on individual Tweets plug into the existing generic
  `reports`/`moderation_reports` tables.
- Mirrored feature-for-feature in the Capacitor Android app
  (`apps/android/src/routes/tweets/*`), registered in the drawer nav and
  the deep-link handler (`routes/__root.tsx`) alongside the existing
  poll/quiz/game/room cases.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.22 Change Log

### v2.22 — Changelog

#### New Feature: Wikis (§38)

Standard collaborative wikis at `/wiki` (discovery) and `/w/<slug>`
(public SEO pages) — users create a wiki, other users contribute pages,
every edit kept as a reviewable/restorable revision.

- **Creation gate** (§38.1): admin-configurable by plan
  (`wiki_create_required_plan`), creator level (`wiki_create_min_level`),
  and an optional staff-only mode (`wiki_create_restricted_to_staff`), all
  editable at `/gate44/wiki`. Per-plan quotas cap wikis owned and pages per
  wiki.
- **Contribution policy** (§38.2): the owner picks `everyone` (default),
  `friends` (accepted friendships), or `selected` (explicit collaborators/
  invite acceptance only).
- **Moderators** (§38.3): the owner (or an admin) grants per-wiki
  moderator status to a collaborator — same `is_moderator` +
  grant-audit-column shape as Guilds' Forum Mods, scoped to that one wiki.
- **Invites** (§38.4): token-based, optional target user, expiry
  (`wiki_invite_expiry_hours`), single-use — same shape as Guild invites,
  routed through the existing notifications pipeline.
- **Rewards** (§38.5): creating a wiki or contributing a page earns
  1 XP / 0 Credits by default, both independently admin-configurable, with
  a rolling-24h Credits cap. A wiki owner may additionally fund a reward
  pot split among the first N contributors/sharers, reusing the generic
  `content_treasuries` mechanic already built for Polls/Quizzes rather
  than a bespoke table.
- **Revision history** (§38.6): every save appends an immutable row to
  `wiki_page_revisions`; any eligible contributor can restore an older
  version (itself recorded as a new revision). No other content type in
  this codebase has edit history — this is new ground, built as an
  append-only ledger to match the project's existing ledger discipline.
- **Moderation & safety** (§38.7): reports plug into the existing generic
  `reports`/`moderation_reports` tables; all free-text input is
  length-capped and passed through the existing HTML sanitizer
  (`lib/security/htmlSanitizer.ts`, reused as-is) before storage.
- Mirrored feature-for-feature in the Capacitor Android app
  (`apps/android/src/routes/wiki/*`), hitting the same `/api/wiki/*`
  backend as web — no separate mobile API.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql`.

---

## Appendix: Version 2.23 Change Log

### v2.23 — Changelog

#### Fix: Wallet totals boxes overflow with large numbers (§11)

The three Wallet balance boxes (XP / Credits / Stars) used a fixed
`grid-cols-3` layout with no minimum-width handling; a long number (this
app supports balances up to 15 digits) doesn't wrap (numbers have no
whitespace to break on), so it overflowed its own box and was painted over
by the next box's opaque background — effectively hiding the tail of the
number. Fixed by:
- Switching the row from a fixed 3-column grid to `flex flex-wrap`, so a
  box can grow to fit a long number and, if all three no longer fit on one
  row, the overflow box gracefully wraps to a new line instead of bleeding
  into its neighbour.
- Scaling the number's font size down as its digit count grows
  (`balanceFontSizeClass`), so even a 15-digit balance stays legible and
  on one line in the common case.
- Adding `tabular-nums` and a `title` attribute (full value) on the number.
- Mirrored identically in the Capacitor Android app's wallet screen
  (`apps/android/src/routes/wallet.tsx`).

#### Fix: Wallet transaction history — name the game, not the internal source code (§11)

Game win/challenge-win/wager transactions in the wallet history showed the
internal reward-source constant verbatim (e.g. "Game reward: game_win"),
which is meaningless to a user who plays dozens of games. `grantGamingReward`
(`lib/games/rewards.ts`) now accepts the game's display name and builds the
transaction description from it (e.g. "Game reward: Zobia Tetris"),
threaded through from `finalizeScore` (`lib/games/sessions.ts`) and the
challenge-series win/wager-stake/wager-payout paths
(`lib/games/challenges.ts`, e.g. "Challenge wager stake: Zobia Tetris").
Reward sources with no single associated game (cross-game play milestones)
fall back to a friendly label ("Game reward: Play milestone") instead of
the raw source constant.

#### Enhancement: Creator earnings — withdrawal threshold progress bar (§14, §18)

The Creator dashboard (`/creator`) already had a Payouts section with
request buttons and payout history; it was missing visibility into *how
close* a creator is to the minimum payout threshold before those buttons
would actually succeed (previously they were always enabled and only
failed server-side with `BELOW_MINIMUM_PAYOUT`). Added:
- `GET /api/creator/payouts` now also returns `minPayoutKobo` (the
  admin-configured minimum payout threshold, §14).
- A `ThresholdProgressBar` on `/creator`: amber fill + remaining-amount
  copy while `availableEarningsKobo` is below `minPayoutKobo`, teal fill +
  "✅ Withdrawal threshold reached" once it's met. The bank-transfer and
  crypto request buttons are disabled (with a tooltip) until the threshold
  is met; Coins conversion has no minimum and stays enabled whenever the
  balance is positive.
- The Wallet page's "Income This Month" card (previously only shown when
  there was income or a pending payout this month) now always renders for
  creators, with the same threshold progress bar and a "Manage & Withdraw →"
  link to `/creator`, so a creator with a bit of pending revenue but $0
  logged "this month" can still see how close they are to unlocking a
  withdrawal.
- Mirrored feature-for-feature in the Capacitor Android app: the same
  `ThresholdProgressBar` on `/creator`'s payout section, and a new
  `CreatorEarningsCard` on the wallet screen (rendered only when
  `payoutConfig` is non-null, i.e. the signed-in user is a creator).

No new migration — this reuses the existing `payout_threshold_kobo`
manifest setting (already admin-configurable at `/gate44`).

#### Feature: Quest system expansion — feature-gated quests, admin campaign boosts, Sponsored Quests in daily decks (§7, §14, §17)

Three related additions to the Daily Quest System and the Sponsored Quest
Marketplace, migration `0001_consolidated_schema.sql`:

1. **Feature-gated quest templates.** `quest_templates.feature_key`
   (nullable) ties a template to a manifest feature flag — new seeded
   templates cover Games, Blogs, Wiki, Polls, Quizzes, and Forum (bbforum),
   plus a Gifts one reusing the existing `gift` action type. The deck
   engine (`generateDailyDeck`) excludes a template when its feature is
   disabled admin-side; existing core templates (`feature_key` NULL) are
   unaffected. Progress-tracking hooks (`triggerActivityQuestProgress`)
   were added at the natural completion point of each feature: game score
   finalize, blog publish/comment, wiki page create/edit, poll vote/create,
   quiz attempt (complete + perfect score), and forum reply/thread create.
2. **Admin campaign boosts** (`quest_feature_boosts` table,
   `/gate44/quests/boosts`) — an admin can promote a feature's quests for a
   date range (e.g. "show more Blog/Wiki quests this week"). The deck
   engine biases selection toward boosted categories by weighting the
   Fisher-Yates shuffle pool; with no boost scheduled, selection is
   unbiased exactly as before. Admin can end a boost early.
3. **Sponsored Quests in the daily deck** — previously Sponsored Quests
   only reached *creators* via the application marketplace (§14). A
   sponsored quest can now opt in (`is_daily_quest_eligible`) to also be
   shown to regular users as a normal daily quest slot, reusing the
   existing `quest_templates`/`user_quest_decks`/`user_quest_progress`
   plumbing via an auto-synced shadow template row
   (`lib/quests/sponsoredQuestPacing.ts` `syncSponsoredQuestTemplate`) —
   no parallel tracking system. Selection: with probability
   `sponsored_quest_daily_slot_chance` (admin-configurable, default 0.35),
   one deck slot is swapped for a budget-eligible sponsored quest.

**Sponsored Quests billing** (per the Facebook-Ads-style UX decision):
businesses/admin pick a duration (3 days/1 week/2 weeks/1 month/2 months,
or custom start/end) and a total budget, with an optional daily cap; the
UI shows an estimated reach (impressions). Under the hood this is billed
as impression-based CPM (`cpm_credits` per 1,000 daily-deck placements,
default from `sponsored_quest_default_cpm_credits`) debited from
`total_budget_credits` each time the quest is placed into a user's deck
(`sponsored_quest_events` ledger, atomic budget-guarded UPDATE to prevent
overspend races) — the duration+budget picker is just a friendlier framing
over the same pacing mechanism used by the existing Ads system.

**Lifecycle additions to `sponsored_quests`:** `owner_user_id` (an
admin-assigned "creator"/campaign manager who gets a stats-only panel at
`/quests/manage` — sees applications/completions/spend, can revive an
inactive quest, extend its end date, or add budget, but can never edit
public-facing details like title/reward; a new quest requires going
through moderation like any other submission); `pause_reason`/`paused_by`/
`paused_at`/`auto_paused` (admin can pause a live quest for follow-up via
`/gate44/sponsored-quests`, distinct from moderation reject); `flag_status`/
`flag_category` (`spam`|`scam`|`other`)/`flag_reason` (admin can flag a
quest, immediately pulling it from the daily-deck pool, until cleared).

**Account-lifecycle handling (per product decision — never auto-resume):**
when a business account is banned (admin "ban" user action), its
subscription fully lapses (`lib/plans/subscriptionSweep.ts`), or its tier
drops below Growth (`lib/business/downgradeSweep.ts`), all its running
Sponsored Quests are paused with `auto_paused = true` and an informative
`pause_reason`, shown to both the admin (`/gate44/sponsored-quests`) and
the business owner (`/business/ads`). The owner must explicitly restart
each quest (`POST /api/business/sponsored-quests/:id/restart`, which
re-verifies the account is active and Growth+ before resuming) — quests
are never silently reactivated on renewal.

**Currency naming fix:** the admin Sponsored Quests page
(`/gate44/sponsored-quests`) and its Android mirror had "Coins" hardcoded
in several places (reward field label, reward display) instead of reading
the admin-configured soft-currency name (`useCurrency()` / the shared
`admin.sponsoredQuests.rewardCoins` / `ads.quests.rewardLabel` i18n
strings). Fixed on both platforms — renaming the soft currency now updates
these screens automatically like everywhere else.

No behavior changes to the pre-existing creator-application Sponsored
Quest flow (§14) — `is_daily_quest_eligible` defaults to `false`, so
existing quests keep behaving exactly as before unless an admin/business
opts one in.

#### Fix: Capacitor Android parity for the quest system expansion above

The initial quest system expansion shipped currency-fix parity on Android
but left the new duration/budget creation UX, pause/flag actions, and the
campaign-boosts/quest-manage panels web-only. Closed the gap:

- `apps/android/src/routes/admin/sponsored-quests.tsx` — added the owner
  ("Quest Creator") username field, the daily-deck-eligibility toggle with
  duration presets/budget/daily-cap/target-action fields and a reach
  estimate, pause (follow-up)/resume actions, flag/unflag with a
  spam/scam/other category picker, and badges for owner, in-daily-decks,
  and flagged state — full parity with the web admin page.
- `apps/android/src/routes/business/ads/index.tsx`'s Sponsored Quests tab
  — added the same duration-preset + budget + daily-cap + reach-estimate
  fields to the submission form, a paused-reason banner, and a Restart
  button for a system-auto-paused quest.
- New `apps/android/src/routes/admin/quest-boosts.tsx` (added to
  `adminNav.ts`) — mirrors `/gate44/quests/boosts`.
- New `apps/android/src/routes/quests/manage.tsx` — mirrors
  `/quests/manage` (the admin-assigned quest "creator" stats/revive/extend/
  add-budget panel).
- Fixed a routing footgun this surfaced: `routes/quests.tsx` (the existing
  daily-quests page) had no file-based sibling directory before, so adding
  `routes/quests/manage.tsx` would have made TanStack Router treat the
  daily-quests page as a *parent layout* for `/quests/manage` — but it
  renders no `<Outlet />`, so the child would never actually display.
  Fixed by moving it to `routes/quests/index.tsx` (`createFileRoute('/quests/')`),
  matching the working `business/index.tsx` + `business/ads/index.tsx`
  sibling-routes convention already used elsewhere in the app, so `/quests`
  and `/quests/manage` render independently as intended.
- 86 new i18n keys added to `shared/i18n/locales/en.json` (English only,
  per the existing convention where non-admin/Android UI strings on the
  web app are not run through i18n) for every new Android-side label,
  inserted next to their existing same-prefix blocks rather than
  re-sorting the file, to keep the diff reviewable.

No backend/schema changes — this is Android UI catching up to the API
surface the web/PWA quest system expansion already shipped against.

---

## Appendix: Version 2.26 Change Log

### v2.26 — Changelog

#### New Feature: Home Dashboard & generalized content boosts (§39)

Redesigned the logged-in Home page (`/home`) around a new cross-content-type
feed pipeline and generalized the pre-existing (but never fully wired up)
`ad_campaigns` content-boost columns into a real "boost any content type"
flow, reusing the existing Platform Advertising pipeline (§17) as-is.

- **Home feed** (§39.2): `GET /api/feed` ranks moments, tweets, blog posts,
  bbforum threads, Answers questions, rooms, classrooms, wiki pages, games,
  and business page posts into a 7-tier priority order (boosted > organic
  popular > organic trending > business posts > in-house boosted > interest
  match > recency fallback) across four tabs (For You / Trending / Friends /
  New).
- **Candidate pool caching** (§39.3): `for_you`/`trending` pools are
  precomputed by a new `POST /api/cron/feed-refresh` job into a two-tier
  memory+Redis cache (`homeFeed.cacheTtlSeconds`, default 900s). This job
  runs every 10-15 minutes and, like other sub-daily jobs, is deliberately
  **not** registered in `vercel.json` (Vercel Hobby only allows daily
  schedules) — requires external cron-jobs.org setup, documented in
  `docs/SETUP.md`.
- **Interest personalization** (§39.4): new `user_interests` table fed by
  an onboarding interest-picker (gated by new admin toggle
  `interests.onboardingSelectionEnabled`, default on) and implicit
  engagement signals (`content_engagement_signals`, aggregated and pruned
  by the feed-refresh job).
- **Zobian of the Month** (§39.5): new `zobian_of_month` table,
  auto-computed monthly from top XP gain unless an admin sets a manual
  override (`POST /api/admin/zobian-of-month`) or auto-compute is disabled
  (`homeFeed.zobianOfMonthAutoComputeEnabled`).
- **Generalized content boosts** (§39.6): new `boost_content` ad objective
  and `createContentBoostCampaign()` (`lib/ads/repo.ts`) let a user boost
  their own existing content — via `POST /api/content/boost` — through the
  exact same moderation/CPM-billing pipeline as any other ad. A **Boost**
  button was added to tweets, blog posts, Answers questions, bbforum
  threads, wiki pages, business page posts, and room/classroom panels.
  Not yet available for moments/games or on Android (follow-up work).
- **Notices carousel** (§39.7): `GET /api/notices` merges a new
  admin-manageable `notices` table with existing `platform_events` and
  `announcement_banners` rows.
- Mirrored feature-for-feature in the Capacitor Android app
  (`apps/android/src/routes/home.tsx`, `components/home/*`), phone-only so
  it always shows the FU/TR/FF/NE tab acronyms.

**New migrations to run:** `db/migrations/0001_consolidated_schema.sql`,
`db/migrations/0001_consolidated_schema.sql`.

---

### v2.27 — Changelog

#### Web/Android parity audit — three gaps closed

- **Creator Merch Store management on Android** (`apps/android/src/routes/
  creator/merch.tsx`, new) — previously Android had no way to set up or
  manage a Merch store at all (only the read-only browse/buy flow at
  `routes/merch/`). Built natively (unlike the bank-account/wallet payout
  screens, which intentionally hand off to web for PIN/2FA-gated detail
  entry) since Merch setup is plain CRUD: create/update the store, add
  digital/physical/course-material products, and opt a product into the
  Market referral program — same `GET/POST /api/merch/:userId` and
  `POST /api/merch/:userId/products` endpoints web uses. Linked from the
  creator dashboard's Revenue by Stream card.
- **Wallet Booster Packs on Android** (`apps/android/src/routes/wallet.tsx`)
  — `GET /api/economy/boosters` now also returns the caller's active
  boosters (joined from `user_xp_boosters`), not just the `boost_types`
  catalog; web's own `<BoosterPacks>` component never actually consumed
  this data (its `boosters` state was hardcoded to `[]`, a pre-existing web
  bug left as-is). Android's new `BoosterPacksPanel` shows active boosts
  with a countdown and lets a user buy a new one; since boosts are paid for
  with existing Coins, not real money, purchase goes straight through the
  platform-agnostic `POST /api/economy/boosters`, not Google Play Billing.
- **Business Ads: Ad Wallet transfer + coupon redemption on Android**
  (`apps/android/src/routes/business/ads/index.tsx`) — added an Ad Wallet
  balance/transfer panel (`POST /api/business/ads/wallet/transfer`, a fee-
  free 1:1 move from the main Credits balance) and per-campaign coupon
  redemption (`POST /api/business/ads/coupons/redeem`), matching web's
  Advertising Panel. Web's "Buy Credits directly into Ad Wallet" link (a
  Paystack/DodoPayments checkout) is intentionally left off Android — top
  up the main wallet via Google Play Billing on the Wallet screen instead,
  then transfer from there.

---

## Appendix: Version 2.28 Change Log

### v2.28 — Changelog

#### DodoPayments removed; replaced with crypto payments (§18, new §40)

- **Provider architecture formalized**: `PaymentProviderModule` interface
  (`lib/payments/types.ts`) + registry (`lib/payments/index.ts`) —
  Paystack and the new crypto provider both implement it; adding a future
  provider is one file + one registry entry.
- **New crypto provider** (`lib/payments/crypto/`): chain adapters for BNB
  Smart Chain (viem) and Solana (`@solana/web3.js`); token registry (JAGA,
  BNB, SOL); a price feed (CoinGecko + DexScreener) with a lazy
  refresh-on-read cache, manual admin override, and graceful fallback
  chain; a wallet-signed, no-webhook payment flow (client submits a tx
  hash, backend verifies on-chain, client polls a status endpoint, daily
  CRON reconciliation as a safety net only).
- **Per-payment-context settings** (`payment_context_settings` table): six
  checkout contexts each independently toggle Paystack / per-currency
  crypto / free-bypass, managed from a new `/gate44/payments` admin page
  with bulk-select actions and a "make all payments free" Danger Zone
  (mirrored on `/gate44/config`, both calling one shared endpoint).
- **User-facing crypto wallet management**: Settings → Crypto Wallets
  (`user_crypto_wallets` table) — masked address, edit/delete with a
  confirm dialog.
- All direct `lib/payments/dodopayments` imports (business tier/renew/
  signup routes) now go through the router; every remaining "paystack" |
  "dodopayments" type union across the codebase (shared types, manifest,
  admin config UI, Android admin config mirror) updated to "paystack" |
  "crypto"; SSRF allowlist, `.env.example`, `lib/env.ts`, and
  `middleware.ts`'s CSRF-bypass webhook list updated accordingly (crypto
  has no inbound webhook to allowlist).
- **Admin data export**: `ALLOWED_EXPORT_FIELDS` gained `cryptoWalletBsc` /
  `cryptoWalletSolana` (address only), `isAdmin`, `rankLevel`,
  `prestigeCount`, with matching filters — a wallet stays exportable even
  after the feature is later disabled for that user, since it's a record
  of what was saved, not a live entitlement.
- **Not done in this pass**: the client-side wallet-connect UI (MetaMask/
  WalletConnect, Phantom/Solflare, the confirmation screen) and the
  Capacitor Android deep-link wallet flow — see §40 "What shipped vs.
  deferred" for the full list. Also not done: wiring the new export
  fields into the `/gate44/data-management` UI, and the Help Center "how
  to buy crypto" article.

**New migration:** `db/migrations/0001_consolidated_schema.sql`.
**New env vars:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (optional),
`BSC_RPC_URL` / `SOLANA_RPC_URL` (optional), `CRYPTO_RECEIVING_ADDRESS_BSC`
/ `CRYPTO_RECEIVING_ADDRESS_SOLANA` (required to accept crypto payments).

---

### v2.29 — Changelog

#### Unified AI image classification pipeline; Ad Moderator role; centralized AI Monitoring panel (§19, §20, §22)

- **Model updates** (`lib/ai/config.ts`, the single source of truth per
  Appendix C's "never inline model strings" rule): DeepSeek's default model
  is now `deepseek-flash` (DeepSeek-V4.1-Flash) — natively multimodal, so
  it now also serves as the image classifier, not just text. Gemini's
  default model is now `gemini-3.6-flash`, the current free-tier-enabled,
  image-capable Gemini model (previously `gemini-1.5-flash`). Both
  providers gained a `supportsVision`/`visionModels` entry in the
  `AI_PROVIDERS` registry; Groq is excluded from image classification (its
  hosted text models have no vision endpoint).
- **New shared vision pipeline** (`lib/ai/vision.ts`): replaces three
  previously-duplicated, Gemini-only REST callers
  (`lib/moderation/aiClassifier.ts` `classifyAdCreativeImage`,
  `lib/kyc/geminiVision.ts` `analyzeDocument`, and the text-only
  human-escalation path) with one `classifyImage()` used everywhere an
  image needs classifying. Flow: DeepSeek Flash (vision) first; if it
  fails or its confidence is below `ai_vision_escalate_below_threshold`
  (default 0.6, `x_manifest`-overridable), escalate to Gemini as a second
  opinion; if both are low-confidence or fail, the caller gets
  `needsHumanReview: true` with both providers' raw attempts attached.
  Image fetches go through the existing `lib/security/ssrf.ts` `safeFetch`
  (SSRF guard, size cap, redirect handling) plus a MIME allow-list — the
  ad-image path previously had none of these guards. Every attempt is
  logged via `logAiCall()`, including token usage when the provider
  reports it.
- **Ads**: `submitCampaignForModeration()` (`lib/ads/repo.ts`) now reviews
  every creative on a campaign (previously only the first, via `LIMIT 1` —
  a pre-existing bug), writes `ad_campaigns.ai_confidence` (a column that
  existed but was never populated), and — new — flags
  `ad_campaigns.ai_escalated` and writes an `ad_ai_escalations` row per
  image the vision pipeline couldn't confidently auto-approve/reject.
- **New "Ad Moderator" staff role** (`users.is_ad_moderator`): a narrower
  role than full Moderator/Admin, granted the same way
  (`upgrade_ad_moderator`/`downgrade_ad_moderator` via
  `POST /api/admin/users/[userId]/actions`, `/gate44/users`). Grants access
  to exactly one page — `/gate44/ads/moderation-queue` — where an Ad
  Moderator reviews each escalated image (with both providers' confidence/
  reasoning shown side by side) and approves or rejects it; resolving the
  last pending escalation on a campaign resolves the campaign's own
  moderation decision too.
- **New centralized Admin AI Monitoring panel** (`/gate44/ai-monitoring`,
  admin-only): the full `ai_call_log` across every AI-backed feature
  (report/ad/quest text moderation, ad-image and KYC-document vision
  classification) with a per-row "Details" drawer (raw model output, token
  counts, pipeline metadata — `ai_call_log` gained `input_tokens`/
  `output_tokens`/`metadata` columns for this), aggregate usage/token
  stats per feature+provider, live circuit-breaker state, a pending-
  human-review summary (ad images / reports / KYC) linking to each queue,
  and the ability to revert an AI-auto-approved ad campaign back to manual
  review (`POST /api/admin/ads/campaigns/[campaignId]/revert-to-manual`).
- **KYC**: `lib/kyc/geminiVision.ts` `analyzeDocument()` now goes through
  the same DeepSeek-primary/Gemini-fallback vision pipeline instead of
  calling Gemini directly — same return shape, so `lib/kyc/service.ts`'s
  existing auto-approve/escalate-below-threshold logic is unchanged. The
  `ai_provider = 'deepseek/gemini'` string `finalizeAiReview()` has always
  written to `kyc_submissions` is now actually accurate.
- **Android (Capacitor) parity**: fixed `admin/ai-settings.tsx` only
  showing DeepSeek/Gemini (a pre-existing bug — Groq has been a live
  3rd-tier provider on web for a while); added `admin/ads-moderation-queue.tsx`
  and `admin/ai-monitoring.tsx`, both wired into the admin drawer nav
  (`adminNav.ts`) and the `users.tsx` moderator-toggle panel. Also fixed a
  missing `admin.nav.aiSettings` i18n key (Android's nav referenced a key
  that didn't exist in either locale file, silently falling back to its
  hardcoded default).

**New migration:** `db/migrations/0002_ai_vision_and_ad_moderator.sql` —
adds `ai_call_log.input_tokens`/`output_tokens`/`metadata`,
`users.is_ad_moderator`, `ad_campaigns.ai_escalated`, the
`ad_ai_escalations` table, and seeds the new `ai_vision_*` manifest keys.
**New env vars:** none — the vision pipeline reuses `DEEPSEEK_API_KEY`/
`GEMINI_API_KEY` (see `docs/SETUP.md` "Image classification (vision)
models").

---

## Appendix: Version 2.30 Change Log

### v2.30 — Changelog

#### Reward pot edit/close (Polls, Quizzes, Wikis, Blog posts — §32.8, §36.3, §38.5)

- **Bug fixed**: funding an existing reward pot a second time (with a
  different amount and/or `maxClaimants`) additively bumped
  `funded_amount` while overwriting `max_claimants` outright, silently
  desyncing the per-claimant reward from what earlier claimants had
  already been paid — the exact bug this version fixes.
- **New behavior**: once a pot exists, `POST` on its treasury route is
  refused (`*_TREASURY_ALREADY_EXISTS`) — the creator instead `PATCH`es it
  to edit the total amount and/or max claimants (debiting an increase,
  refunding a decrease, never below what's already paid out, and never
  dropping `max_claimants` below the current claimant count), or `DELETE`s
  it to turn the reward off (any unclaimed Credits refund to the creator
  immediately; the pot moves to `closed` and can be re-funded from scratch
  later via `POST`).
  Applies uniformly to `lib/contentTreasury.ts`'s shared
  `content_treasuries` table (Polls, Quizzes, Wikis) and to Blogs' own
  `blog_post_treasuries` table (`lib/blogs/service.ts`, which predates and
  duplicates the same tables/logic rather than reusing the shared module).
- **New `CoinTransactionType` values**: `poll_treasury_refund`,
  `quiz_treasury_refund`, `wiki_treasury_refund`, `blog_treasury_refund`.
- **UI**: `components/polls/FundTreasuryModal.tsx` (Polls/Quizzes),
  `components/blogs/TreasuryPanel.tsx`, and
  `/wiki/<slug>/manage/treasury` now show "Edit reward pot"/"Save changes"
  and "Turn off reward" once a pot exists, instead of a "Fund"/"Top up"
  button that silently corrupted the pot's math.
- **No new migration** — same tables, new application-level rules only.

#### Tweet composer level-gate (§37)

- **Bug fixed**: `/tweets/create` used to render the full compose form
  (text box, image upload, video picker) to a user below
  `tweets_min_level`, with only the Post button `disabled` and a small
  reminder line underneath — a user could fill out an entire Tweet before
  discovering they weren't allowed to post it.
- **New behavior**: the composer now checks `GET /api/tweets/policy`
  before rendering. A user below `tweets_min_level` sees only a
  level-required notice (their current level, the level needed, and a link
  back to `/tweets`) — no form, no upload control, no disabled button.
  `lib/hooks/useTweetLengthPolicy.ts` now also returns `minLevel`/
  `currentLevel`/`isLoading` for this.

#### Wiki share link (§38)

- **Bug fixed**: the authenticated `/wiki/<slug>` page's "Share" action
  shared its own auth-gated URL (`/wiki/<slug>`) instead of the public,
  crawlable `/w/<slug>` SEO page — a signed-out recipient of a shared link
  hit a login wall instead of the wiki.
- **Fixed**: it now shares `/w/<slug>`, matching Blogs' `/b/<slug>` share
  pattern.

**New migration:** none.
**New env vars:** none.

---

### v2.31 — Changelog

#### Gift Messages — "Add a message" on Send Gift (§12)

- **New feature**: sending a gift now supports an optional, collapsible
  message box ("+ Add a message (optional)"), with a confirm/preview step
  (message shown verbatim, Edit / Confirm & Send) before the gift is
  actually sent. Plain gift sends with no message are unaffected — still
  one tap.
- **Eligibility & word limits, per plan/tier, all admin-configurable** at
  `/gate44/gifts/message-settings` (web) / `admin/gift-message-settings.tsx`
  (Capacitor Android): Free (gated by a minimum account level, default
  Level 5, then 40 words), Plus (50 words), Pro (100 words), Max (250
  words), and Business Starter/Growth/Enterprise (50/100/250 words) — each
  tier has its own on/off toggle plus a sitewide master switch.
  `lib/plans/giftMessage.ts` resolves eligibility server-side; validated
  again in `POST /api/economy/gifts/send` (never trust the client word
  counter).
- **New migration**: `0007_gift_message.sql` — `gifts.message` (text),
  `gifts.message_word_count` (integer), and seeds the `gift_message_*`
  x_manifest keys.
- **New endpoint**: `GET /api/economy/gifts/message-config` — returns the
  current user's eligibility/word-limit so the UI knows whether to show the
  message box before the user starts composing.
- **Mirrored** in the Capacitor Android app (`apps/android/src/routes/gifts.tsx`,
  `admin/gift-message-settings.tsx`) and in gift history on both platforms.

#### Moderation Roster (§20)

- **New feature**: a central admin page (`/gate44/moderation/roster`) lists
  every account currently flagged as any staff role (Platform Mod, Ad
  Moderator, Support, Senior Support) with inline promote/demote actions,
  instead of requiring an admin to search for each user individually in
  User Management. Reuses the existing
  `POST /api/admin/users/[userId]/actions` action set
  (`upgrade_moderator`/`downgrade_moderator`/etc.) — no new authorization
  logic. Mirrored on Capacitor Android admin nav.
- **No new migration** — reads/writes the existing `users.is_moderator` /
  `is_ad_moderator` / `is_support` / `is_senior_support` boolean columns.

---

### v2.32 — Changelog (2026-09-23)

#### Suspended/banned login UX, Account Appeals pipeline, blocked-login rate limit (§18 "Suspended and Banned Users", §20)

- **Terminated (banned) login error**: a banned user attempting to log in
  used to fall through to a generic "an unexpected error occurred" message
  (`auth.error.unexpected`) — the OAuth callback threw `ACCOUNT_BANNED` but
  the login UI (`components/auth/LoginPageClient.tsx`) never had a case for
  it, only `account_suspended`. It now shows a distinct, translated
  message — "Your account has been terminated." (`auth.error.accountTerminated`) —
  behind a distinct error code (`ACCOUNT_TERMINATED`/`account_terminated`
  in the redirect). Mirrored on Capacitor Android
  (`apps/android/src/routes/auth/login.tsx`).
- **Improved suspended-account login error**: now shows the suspension
  reason, the exact date/time the suspension lifts (when
  `suspended_until` is set, via the shared `formatShortDateTime()` in
  `lib/format/date.ts` — new, mirrors the existing `formatShortDate()`
  convention), and a "File an appeal" link. Mirrored on Android
  (`lib/format/date.ts` there too).
- **New: Account Appeals pipeline** (`account_appeals` table). A user can
  only file an appeal after actually attempting to log in with correct
  credentials and being blocked by the suspension/ban check — never via a
  public "email us" form. The blocked Google/Telegram OAuth callback
  issues a short-lived (30 min), Redis-backed, single-use "appeal token"
  (`lib/auth/appealToken.ts`, mirrors the existing `web_pre_auth`/
  `mobile_pre_auth` handoff pattern) and redirects to `/appeal?code=...`
  (or the native app's `/auth/login` search params on mobile, which link
  out to the same web page in an in-app browser — the same pattern already
  used for Deleted Account Restore's `/auth/restore` link on Android).
  - `POST /api/appeals` consumes the token (identity + single-use),
    pre-fills the contact email from the account record, and accepts an
    optional alternate contact email (the account's own email may be
    inaccessible). On success, the user is told a reply may take several
    days and will be sent to the email provided.
  - `GET /api/appeals/token?code=...` lets the appeal page pre-fill
    (without consuming) the account email, original reason, and
    suspension end date.
  - Admin-configurable via `x_manifest`/the manifest system
    (`lib/manifest/index.ts` `appeals.maxRefusals` / `appeals.triageMode`,
    editable via the settings panel on the review page below):
    `appeals_max_refusals` (default 3) — once a user's denied appeals for
    the same suspension/ban reach this count, `POST /api/appeals` refuses
    further submissions for it (`APPEAL_LIMIT_REACHED`).
    `appeals_triage_mode` — `"manual"` (default: every appeal goes
    straight to human review) or `"ai_then_manual"` (an AI triage pass —
    `classifyAccountAppeal()` in `lib/moderation/aiClassifier.ts`, reusing
    the existing DeepSeek/Gemini `aiClient` pipeline the way
    `classifySponsoredQuest`/`classifyAdCreative` already do — writes a
    recommendation + confidence + reasoning to `ai_triage_result`. It is
    surfaced to the human reviewer only; it never auto-approves or
    auto-denies).
  - **New admin review UI**: `/gate44/moderation/appeals` (nav entry added
    next to Moderation/Moderation Settings/Moderation Roster), listing
    Pending/Approved/Denied tabs. **Approve** lifts the suspension/ban by
    calling the exact same restore logic as the direct admin "restore"
    action — extracted into `lib/moderation/accountActions.ts`
    (`restoreUserAccount()`) and now shared by both
    `POST /api/admin/users/[userId]/actions` (`restore`) and the new
    `PATCH /api/admin/appeals/[appealId]` (`approve`), so there is exactly
    one place that lifts a suspension/ban. **Deny** increments the
    appeal's `refusal_count`.
- **New rate limit bucket**: `RATE_LIMITS.loginBlocked`
  (`lib/security/rateLimit.ts`) — 5 attempts / 15 min, keyed by `userId`
  once identity is established via the OAuth provider's verified profile,
  tighter than the general `RATE_LIMITS.login`/`RATE_LIMITS.auth` limiters.
  Applied in both `app/api/auth/google/callback` and
  `app/api/auth/telegram/callback` at the point a suspended/banned account
  is detected, so a blocked user can't hammer the login endpoint
  repeatedly after already having seen the suspension/ban notice.
- **New migration**: `0008_account_appeals.sql` — creates
  `account_appeals` (id, user_id, appeal_type, reason, contact_email,
  status, refusal_count, ai_triage_result jsonb, admin_notes,
  reviewed_by, reviewed_at, created_at, updated_at) and seeds the
  `appeals_max_refusals` / `appeals_triage_mode` `x_manifest` keys.
- **Not done in this pass**: a fully native (non-browser) Android appeal
  form — the Android login screen renders its own suspended/terminated
  banner natively, but "File an appeal" opens the same responsive
  `/appeal` web page in the in-app browser (Capacitor `Browser.open`),
  consistent with how Account Restore already links out to
  `/auth/restore` on Android rather than duplicating that flow natively.

---

### v2.33 — Changelog

#### Signups Toggle (§20)

- **New feature**: a sitewide `signups_enabled` x_manifest flag (default
  on) blocks brand-new account creation in both the Google and Telegram
  OAuth callbacks (`app/api/auth/google/callback`,
  `app/api/auth/telegram/callback`) while leaving existing-user login
  completely unaffected. A blocked attempt redirects to
  `/auth/error?code=signups_disabled` with a clear, translated message.
- **New migration**: `0010_signups_toggle.sql` — seeds the
  `signups_enabled` x_manifest key.
- **Admin UI**: editable from two places, both writing the same key —
  the central site settings panel (`/gate44/config`, "Signups" group) and
  a new Settings tab on `/gate44/users`. Each carries an inline code
  comment pointing at the other so a future change doesn't desync them.
  Mirrored on the Capacitor Android app's `admin/users.tsx` Settings tab.

---

### v2.34 — Changelog

#### Session expiry countdown + fix for the persistent "session expired" popup (Auth)

- **New feature**: while a user's tab/app is in the foreground, a 30-second
  countdown modal warns them shortly before their access token expires
  ("Your session is about to expire in **X seconds**"), with a "Don't log
  me out" button that silently extends the session via the existing
  refresh flow. Ships on web, the PWA, and the Capacitor Android app —
  driven by `lib/auth/sessionExpiryBus.ts` on web (primed from
  `GET /api/auth/me`'s new `expiresAt` field, since the access token itself
  is an HttpOnly cookie) and by decoding the JWT's own `exp` claim directly
  on Android (`apps/android/src/lib/auth/sessionExpiryBus.ts`), since that
  app holds its access token in memory already.
- **Bug fixed**: the "your session has expired" notice/redirect kept
  reappearing indefinitely — even in a brand-new tab, even for a different
  person opening the site fresh on a shared device — because a failed
  token refresh (`/api/auth/refresh`, `/api/auth/silent-refresh`) never
  cleared the dead `zobia_at`/`zobia_rt` cookies. The browser kept
  resending the same unrecoverable refresh token on every page load, and
  the edge middleware kept redirecting to the session-expired login screen
  forever, until the cookie's own (up to 30-day) `Max-Age` finally ran out.
  Both refresh routes now clear the cookie jar when
  `refreshAccessToken()` throws a new `SessionRevokedError` (session
  genuinely revoked/expired, reuse detected, or account no longer in good
  standing) — but deliberately NOT on a transient failure (rate limiting,
  lock contention, a DB hiccup), so a legitimately-still-valid refresh
  token is never discarded by mistake. This bug was web/PWA-only — the
  Capacitor app already cleared its stored tokens correctly on a dead
  refresh.
- **No new migration.**

#### Sitewide Search (new §41 — see also `docs/SEARCH.md`)

- **New feature**: a universal search icon (web top bar + drawer menu,
  Android top bar + drawer menu) opens `/search` — a single results page
  searching **People, Blogs, Wikis, Answers, and Games** at once, with
  multi-select category filters, a date-published filter (This week /
  month / quarter / year / All time), a default "most recent across
  categories" browse view when no query is typed, and "Load more"
  pagination (20 results/page). Ad slots (`search_top`, `search_after_3`,
  `search_after_8`, `search_bottom`) reuse the existing plan-gated
  `<AdSlot/>` component — no new ad logic.
- **Backend**: `GET /api/search` — one query per selected category,
  `UNION ALL`'d and paginated, mirroring the existing `/api/users/search` /
  `/api/help/search` pattern rather than introducing a dedicated search
  service. Each branch matches on full-text search
  (`search_vector @@ websearch_to_tsquery(...)`, ranked with `ts_rank`) OR a
  `pg_trgm`-indexed `ILIKE '%term%'` fallback, so short/partial-word queries
  keep matching while whole/stemmed-word queries get relevance ranking
  instead of pure recency ordering. See `docs/SEARCH.md` for the full
  scalability write-up (both Postgres-only upgrade paths — `pg_trgm`
  trigram indexes and full-text search — have now been applied; a
  dedicated search engine remains the option after that, if it's ever
  needed).
- **New migrations**: `0011_search_ad_placements.sql` — registers the four
  `ad_placements` rows above (existing table, existing grants — no new
  `GRANT` statements needed). `0014_search_trgm_fts.sql` — enables
  `pg_trgm`, adds a GIN trigram index per searched column, and adds a
  generated `search_vector` tsvector column (+ GIN index) per searched
  table for relevance ranking.
- **Android**: `apps/android/src/routes/search.tsx` calls the exact same
  `GET /api/search` endpoint, so behavior never drifts between platforms;
  result links are mapped from the API's web-style short URLs
  (`/u/<username>`, `/g/<slug>`, etc.) to this app's own native route
  shapes (`/profile/$username`, `/games/$slug`, etc.).

---

### v2.35 — Changelog

#### Creator Dashboard 500 (`GET /api/creator/dashboard`)

- **Bug fixed**: the dashboard's "Quest performance" panel queried
  `sponsored_quests` for a `status` and a `creator_id` column — neither
  exists on that table (it's `sponsoredQuests.ownerUserId` /
  `businessAccountId` / `submittedBy` for ownership, and it has no lifecycle
  `status` at all). Every call threw a real Postgres "column does not
  exist" error, unhandled, which is what actually produced the reported
  500 — a nearby `[database] Circuit CLOSED after recovery` log line was an
  unrelated coincidence (the DB circuit breaker's own rejections surface as
  a distinct 503 `DB_UNAVAILABLE`, not this generic 500). Fixed to query
  `sponsored_quest_applications` (which does have `creator_id` and
  `status`: `applied` → `accepted` → `completed`/`rejected`) — this is the
  table that actually tracks a creator's own sponsored-quest completions,
  per `app/api/creator/sponsored-quests/[questId]/{apply,complete}/route.ts`.
- **Hardening**: every other stat panel in this route (members, top
  gifters, quest performance, payout history, room health) now runs
  through a shared `fetchRows()` helper that catches and logs a query
  failure and falls back to an empty result instead of 500ing the whole
  dashboard — the same try/catch-with-fallback pattern the route's
  `fetchAvgSessionTimeMinutes()` helper already used for the one panel it
  covered. Revenue figures are deliberately left unprotected (a silent $0
  would be misleading for financial data) — a genuine revenue-query bug
  should still surface as a 500, not a quietly wrong number.
- **Separately discovered while investigating this**: the DB circuit
  breaker (`lib/db/circuit.ts`) only ever wrapped each provider adapter's
  own `query()`/`transaction()` methods — but `lib/db/drizzle.ts`'s
  `getDb()` hands Drizzle the *same* underlying `pg.Pool` and Drizzle calls
  `pool.query()` on it directly, bypassing that wrapper entirely. Since
  "full Drizzle ORM coverage" (#532) moved nearly all application code onto
  `getDb()`/Drizzle, the breaker had quietly stopped protecting the vast
  majority of real traffic — a DB outage would hang every Drizzle-issued
  query for the full statement/connection timeout instead of failing fast
  with a clean 503, and none of that traffic fed back into the breaker's
  own OPEN/CLOSED state either. Fixed by wrapping the `pg.Pool`'s `query()`
  method itself, once, at pool-creation time
  (`wrapPoolWithCircuitBreaker()`), so both the legacy adapter and Drizzle
  share the same protection; the adapters' own `.query()` methods no longer
  double-wrap (that would have double-counted every legacy-path query
  against the breaker's rolling window once Drizzle and the adapter both
  ran through it).
- **No new migration.**

#### "Empty user" after re-login (Auth — extends the v2.34 session-expiry fix)

- **Bug fixed**: after a session died (revoked, or the access token simply
  expired) a stale-but-still-cryptographically-valid `zobia_at` cookie
  could remain in the browser, because a plain API 401 (as opposed to a
  *genuine* revocation caught inside `/api/auth/refresh` /
  `/api/auth/silent-refresh`, which the v2.34 fix already handles) never
  cleared it. `middleware.ts`'s public-route handling only checks JWT
  signature/expiry — not revocation — before bouncing a
  signed-in-looking visitor away from `/auth/login` straight back to
  `/home`. So clicking "Sign in" on the `SessionExpiredModal` never reached
  the actual Google OAuth button: the user was redirected right back into
  an app shell whose client-side user fetch then 401'd, rendering the
  "Your Name" / "@username" / "U"-avatar placeholders with "View Profile"
  erroring out. Fixed by clearing both auth cookies (via the existing
  `POST /api/auth/logout`, always-200/always-clears) the moment
  `markSessionExpired()` fires — before the user ever gets a chance to
  click "Sign in" — with the modal's own button additionally awaiting that
  clear before navigating, so `/auth/login` is guaranteed to render the
  real sign-in screen instead of bouncing back. Web/PWA-only — the
  Capacitor app already clears its stored Bearer token correctly on any
  confirmed-unauthenticated state (`onUnauthenticated` → `clearAuth()` in
  `apps/android/src/lib/auth/store.ts`), since it doesn't rely on a
  middleware cookie check to gate `/auth/login`.
- **Bug fixed (contributing cause)**: `Sidebar.tsx` and `Navbar.tsx` each
  defined their own separate, ad-hoc `useState`/`useEffect` hook that
  independently fetched `GET /api/users/me` on mount with no
  deduplication (two redundant requests per page load, on top of the
  already-deduplicated `/api/auth/me` call `useAuth()` makes), no retry,
  and any non-OK response or network error silently swallowed forever —
  so a single transient failure of that one mount-time fetch permanently
  stranded the nav in the placeholder state for the rest of that page's
  life, with no recovery path even after the underlying issue resolved.
  Replaced both with a single shared `useUserProfile()` hook
  (`lib/auth/hooks.ts`) using the same module-level dedup-promise pattern
  already established there for `useAuth()`/`fetchAuthMe()` (BUG-PERF-02).
- **No new migration.**

---

