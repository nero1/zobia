"use client";

/**
 * app/onboarding/page.tsx
 *
 * Web onboarding wizard (PRD §4).
 *
 * Step 1 — Identity creation (username, display name, avatar emoji, city, date of birth).
 * Step 2 — Vibe Quiz (4 questions that silently personalise the feed).
 * Step 3 — Welcome XP Drop (500 XP animation).
 * Step 4 — First Contact: friend search + referral link share (web fallback for expo-contacts).
 *
 * CAPTCHA token is collected via reCAPTCHA v3 / Turnstile (per manifest).
 * Age gate enforced: date_of_birth required; users below minimumAge are blocked.
 * Redirects to /(app)/home on completion.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4 | 5;

interface VibeAnswers {
  activity: string;
  socialStyle: string;
  motivation: string;
  cityVibe: string;
}

interface FriendSearchResult {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

interface GuildSuggestion {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  emblem: string;
  tier: string;
}

interface NewMemberQuest {
  id: string;
  title: string;
  description: string;
  xp_reward: number;
  coin_reward: number;
  icon: string | null;
  category: string;
}

interface ManifestPublic {
  captchaProvider: "recaptcha" | "turnstile" | "none";
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
  minimumAge: number;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
    turnstile?: {
      render: (container: string | HTMLElement, opts: object) => string;
      getResponse: (widgetId: string) => string | undefined;
    };
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMON_CITIES = [
  "Lagos", "Abuja", "Port Harcourt", "Kano", "Ibadan", "Enugu",
  "Benin City", "Kaduna", "Warri", "Owerri", "Jos", "Calabar",
  "Maiduguri", "Ilorin", "Abeokuta", "Nairobi", "Accra", "Dakar",
  "Kinshasa", "Johannesburg", "Cape Town", "Dar es Salaam",
  "Other",
];

const AVATAR_OPTIONS = [
  "😎", "🔥", "👑", "💎", "🦁", "🐯", "⚡", "🚀", "🎯", "💪",
  "🌟", "🎭", "🏆", "🎪", "🌊", "🦅", "🐉", "🌙", "☀️", "🎸",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter();

  // Manifest (loaded once)
  const [manifest, setManifest] = useState<ManifestPublic | null>(null);

  // Form state — Step 1
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("😎");
  const [city, setCity] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [dob, setDob] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");

  // Vibe Quiz — Step 2
  const [vibeAnswers, setVibeAnswers] = useState<Partial<VibeAnswers>>({});

  // Misc
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcomeXP, setWelcomeXP] = useState(false);

  // Step 4 — Guild Discovery
  const [suggestedGuilds, setSuggestedGuilds] = useState<GuildSuggestion[]>([]);
  const [guildsLoading, setGuildsLoading] = useState(false);
  const [joinedGuildId, setJoinedGuildId] = useState<string | null>(null);
  const [joiningGuildId, setJoiningGuildId] = useState<string | null>(null);

  // Step 5 — First Quest CTA
  const [firstQuests, setFirstQuests] = useState<NewMemberQuest[]>([]);
  const [questsLoading, setQuestsLoading] = useState(false);

  // Step 5 (was 4) — First Contact
  const [friendQuery, setFriendQuery] = useState("");
  const [friendResults, setFriendResults] = useState<FriendSearchResult[]>([]);
  const [friendSearching, setFriendSearching] = useState(false);
  const [addedFriends, setAddedFriends] = useState<Set<string>>(new Set());
  const [referralUrl, setReferralUrl] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  // Captcha refs
  const turnstileWidgetId = useRef<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Fetch manifest for CAPTCHA config + minimum age
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m) => setManifest(m as ManifestPublic))
      .catch(() => {
        // fallback — assume recaptcha with no key (will skip captcha server-side)
        setManifest({ captchaProvider: "none", minimumAge: 18 });
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Turnstile init (when manifest loads and captchaProvider = turnstile)
  // ---------------------------------------------------------------------------
  const initTurnstile = useCallback(() => {
    if (
      manifest?.captchaProvider !== "turnstile" ||
      !manifest.turnstileSiteKey ||
      !captchaContainerRef.current ||
      turnstileWidgetId.current
    ) return;

    turnstileWidgetId.current = window.turnstile?.render(
      captchaContainerRef.current,
      { sitekey: manifest.turnstileSiteKey }
    ) ?? null;
  }, [manifest]);

  // ---------------------------------------------------------------------------
  // Username availability check (debounced)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (username.length < 3) { setUsernameStatus("idle"); return; }
    if (!/^[a-z0-9_-]{3,30}$/.test(username)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const t = setTimeout(() => {
      fetch(`/api/onboarding/check-username?username=${encodeURIComponent(username)}`)
        .then((r) => r.json())
        .then((d: { available: boolean }) => setUsernameStatus(d.available ? "ok" : "taken"))
        .catch(() => setUsernameStatus("idle"));
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  // ---------------------------------------------------------------------------
  // Step 4 — Debounced friend search
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (friendQuery.length < 2) { setFriendResults([]); return; }
    setFriendSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(friendQuery)}&limit=10`)
        .then((r) => r.json())
        .then((d: { users?: FriendSearchResult[] }) => setFriendResults(d.users ?? []))
        .catch(() => setFriendResults([]))
        .finally(() => setFriendSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [friendQuery]);

  // ---------------------------------------------------------------------------
  // Step 1 validation
  // ---------------------------------------------------------------------------
  function validateStep1(): string | null {
    if (usernameStatus !== "ok") return "Please choose a valid, available username.";
    if (!displayName.trim()) return "Display name is required.";
    if (!dob) return "Date of birth is required.";
    const age = calculateAge(dob);
    const minAge = manifest?.minimumAge ?? 18;
    if (age < minAge) return `You must be at least ${minAge} years old to join Zobia.`;
    if (!city) return "Please select your city.";
    return null;
  }

  // ---------------------------------------------------------------------------
  // Step 2 validation
  // ---------------------------------------------------------------------------
  function validateStep2(): string | null {
    const q = ["activity", "socialStyle", "motivation", "cityVibe"] as const;
    for (const key of q) {
      if (!vibeAnswers[key]) return "Please answer all four questions to continue.";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Get CAPTCHA token
  // ---------------------------------------------------------------------------
  async function getCaptchaToken(): Promise<string | null> {
    if (!manifest || manifest.captchaProvider === "none") return null;
    if (manifest.captchaProvider === "recaptcha" && manifest.recaptchaSiteKey) {
      return new Promise((resolve) => {
        window.grecaptcha?.ready(async () => {
          try {
            const token = await window.grecaptcha!.execute(
              manifest.recaptchaSiteKey!,
              { action: "onboarding" }
            );
            resolve(token);
          } catch {
            resolve(null);
          }
        });
      });
    }
    if (manifest.captchaProvider === "turnstile" && turnstileWidgetId.current) {
      return window.turnstile?.getResponse(turnstileWidgetId.current) ?? null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Submit onboarding
  // ---------------------------------------------------------------------------
  async function submitOnboarding() {
    const step1Error = validateStep1();
    if (step1Error) { setError(step1Error); return; }
    const step2Error = validateStep2();
    if (step2Error) { setError(step2Error); return; }

    setSubmitting(true);
    setError(null);

    try {
      const captchaToken = await getCaptchaToken();

      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.toLowerCase(),
          display_name: displayName.trim(),
          avatar_emoji: avatarEmoji,
          city,
          date_of_birth: dob,
          vibe_quiz_responses: vibeAnswers,
          captcha_token: captchaToken ?? undefined,
        }),
      });

      const data = await res.json() as { error?: string; minAge?: number };

      if (!res.ok) {
        if (data.error === "age_requirement") {
          setError(`This platform requires users to be at least ${data.minAge ?? 18} years old.`);
        } else if (data.error === "captcha_failed") {
          setError("CAPTCHA verification failed. Please try again.");
        } else if (data.error === "username_taken") {
          setError("That username is already taken. Please choose another.");
          setStep(1);
        } else {
          setError(data.error ?? "Something went wrong. Please try again.");
        }
        return;
      }

      // Step 3 — Welcome XP Drop animation, then advance to Step 4 (Guild Discovery)
      setWelcomeXP(true);
      setTimeout(() => {
        setWelcomeXP(false);
        setStep(4);
        // Pre-fetch guild suggestions and referral link
        setGuildsLoading(true);
        fetch(`/api/guilds?city=${encodeURIComponent(city)}&limit=6`)
          .then((r) => r.json())
          .then((d: { guilds?: GuildSuggestion[] }) => {
            setSuggestedGuilds(d.guilds ?? []);
          })
          .catch(() => {})
          .finally(() => setGuildsLoading(false));
        fetch("/api/referrals")
          .then((r) => r.json())
          .then((d: { stats?: { referralUrl?: string } }) => {
            if (d.stats?.referralUrl) setReferralUrl(d.stats.referralUrl);
          })
          .catch(() => {});
      }, 2500);

    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const usernameIndicator = {
    idle: null,
    checking: <span className="text-xs text-neutral-400">Checking…</span>,
    ok: <span className="text-xs text-green-600">✓ Available</span>,
    taken: <span className="text-xs text-red-500">✗ Already taken</span>,
    invalid: <span className="text-xs text-red-500">✗ Lowercase letters, numbers, _ and - only</span>,
  }[usernameStatus];

  const filteredCities = citySearch
    ? COMMON_CITIES.filter((c) => c.toLowerCase().includes(citySearch.toLowerCase()))
    : COMMON_CITIES;

  // ---------------------------------------------------------------------------
  // Welcome XP Drop screen
  // ---------------------------------------------------------------------------
  if (welcomeXP) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-center">
        <div className="animate-bounce text-7xl">🎉</div>
        <h1 className="mt-6 text-3xl font-black text-white">Welcome to Zobia!</h1>
        <p className="mt-3 text-lg text-amber-400 font-semibold">+500 XP earned</p>
        <div className="mt-4 h-3 w-64 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-[2000ms] ease-out"
            style={{ width: welcomeXP ? "40%" : "0%" }}
          />
        </div>
        <p className="mt-2 text-sm text-neutral-400">Heading to your home feed…</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* reCAPTCHA v3 */}
      {manifest?.captchaProvider === "recaptcha" && manifest.recaptchaSiteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${manifest.recaptchaSiteKey}`}
          strategy="lazyOnload"
        />
      )}

      {/* Turnstile */}
      {manifest?.captchaProvider === "turnstile" && manifest.turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="lazyOnload"
          onLoad={initTurnstile}
        />
      )}

      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <div className="mx-auto max-w-lg px-4 py-12">
          {/* Progress bar */}
          <div className="mb-8 flex gap-2">
            {([1, 2, 3, 4, 5] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                  s <= step ? "bg-amber-400" : "bg-neutral-200 dark:bg-neutral-700"
                }`}
              />
            ))}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          {/* ================================================================
              STEP 1 — Identity Creation
          ================================================================ */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-neutral-900 dark:text-white">
                  Create your identity
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  Your username is permanent. Make it count.
                </p>
              </div>

              {/* Avatar picker */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Pick your avatar
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setAvatarEmoji(emoji)}
                      className={`h-10 w-10 rounded-full text-xl transition-all ${
                        avatarEmoji === emoji
                          ? "ring-2 ring-amber-400 ring-offset-2 scale-110"
                          : "hover:scale-105"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Username */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="yourname"
                  maxLength={30}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  autoComplete="off"
                />
                <div className="mt-1">{usernameIndicator}</div>
              </div>

              {/* Display name */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Display name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How you appear to others"
                  maxLength={50}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />
              </div>

              {/* City */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Your city
                </label>
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => { setCitySearch(e.target.value); setCity(""); }}
                  placeholder="Search cities…"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />
                {citySearch && !city && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                    {filteredCities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { setCity(c); setCitySearch(c); }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {city && (
                  <p className="mt-1 text-xs text-green-600">✓ {city} selected</p>
                )}
              </div>

              {/* Date of birth — age gate */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Date of birth
                </label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  You must be at least {manifest?.minimumAge ?? 18} years old to join.
                </p>
              </div>

              {/* Turnstile widget mount point */}
              {manifest?.captchaProvider === "turnstile" && (
                <div ref={captchaContainerRef} />
              )}

              <button
                type="button"
                onClick={() => {
                  const err = validateStep1();
                  if (err) { setError(err); return; }
                  setError(null);
                  setStep(2);
                }}
                className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
              >
                Continue →
              </button>
            </div>
          )}

          {/* ================================================================
              STEP 5 — First Quest CTA + First Contact
          ================================================================ */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-neutral-900 dark:text-white">
                  Your first quest awaits!
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  Complete quests to earn XP, coins, and unlock rewards.
                </p>
              </div>

              {/* First Quest display */}
              {questsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                  ))}
                </div>
              ) : firstQuests.length > 0 ? (
                <div className="space-y-3">
                  {firstQuests.map((quest) => (
                    <div
                      key={quest.id}
                      className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/20"
                    >
                      <span className="text-2xl">{quest.icon ?? "🎯"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
                          {quest.title}
                        </p>
                        <p className="truncate text-xs text-neutral-500">{quest.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold text-amber-600">+{quest.xp_reward} XP</p>
                        {quest.coin_reward > 0 && (
                          <p className="text-xs text-neutral-400">{quest.coin_reward} 🪙</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div>
                <h2 className="mb-2 text-base font-bold text-neutral-800 dark:text-neutral-200">
                  Find your people
                </h2>
                <p className="mb-3 text-sm text-neutral-500">
                  Search for friends already on Zobia, or share your invite link.
                </p>
              </div>

              {/* Friend search */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Search by username or display name
                </label>
                <input
                  type="text"
                  value={friendQuery}
                  onChange={(e) => setFriendQuery(e.target.value)}
                  placeholder="Search friends…"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />

                {friendSearching && (
                  <p className="mt-2 text-xs text-neutral-400">Searching…</p>
                )}

                {friendResults.length > 0 && (
                  <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white shadow-sm dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
                    {friendResults.map((u) => (
                      <li key={u.userId} className="flex items-center gap-3 px-4 py-3">
                        <span className="text-2xl">{u.avatarEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{u.displayName}</p>
                          <p className="truncate text-xs text-neutral-500">@{u.username}</p>
                        </div>
                        <button
                          type="button"
                          disabled={addedFriends.has(u.userId)}
                          onClick={async () => {
                            try {
                              await fetch("/api/friends", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ targetUserId: u.userId }),
                              });
                              setAddedFriends((prev) => new Set([...prev, u.userId]));
                            } catch { /* best-effort */ }
                          }}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                            addedFriends.has(u.userId)
                              ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                              : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                          }`}
                        >
                          {addedFriends.has(u.userId) ? "Added" : "Add"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!friendSearching && friendQuery.length >= 2 && friendResults.length === 0 && (
                  <p className="mt-2 text-xs text-neutral-400">No results for &ldquo;{friendQuery}&rdquo;</p>
                )}
              </div>

              {/* Referral link */}
              <div>
                <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Or invite friends via link
                </p>
                {referralUrl ? (
                  <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
                    <span className="flex-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
                      {referralUrl}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(referralUrl).catch(() => {});
                        setReferralCopied(true);
                        setTimeout(() => setReferralCopied(false), 2000);
                      }}
                      className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
                    >
                      {referralCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                ) : (
                  <div className="h-11 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                )}
              </div>

              <button
                type="button"
                onClick={() => router.push("/(app)/home")}
                className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
              >
                {addedFriends.size > 0 ? `Start Zobia (${addedFriends.size} added) →` : "Start Zobia →"}
              </button>
            </div>
          )}

          {/* ================================================================
              STEP 4 — Guild Discovery
          ================================================================ */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-neutral-900 dark:text-white">
                  Find your guild
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  Guilds are your crew on Zobia. Join one to unlock chat, wars, and bonuses.
                </p>
              </div>

              {guildsLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                  ))}
                </div>
              ) : suggestedGuilds.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {suggestedGuilds.map((guild) => (
                    <button
                      key={guild.id}
                      type="button"
                      disabled={!!joinedGuildId || joiningGuildId === guild.id}
                      onClick={async () => {
                        if (joinedGuildId) return;
                        setJoiningGuildId(guild.id);
                        try {
                          await fetch(`/api/guilds/${guild.id}/join`, { method: "POST" });
                          setJoinedGuildId(guild.id);
                        } catch { /* best-effort */ }
                        finally { setJoiningGuildId(null); }
                      }}
                      className={`relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                        joinedGuildId === guild.id
                          ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                          : joinedGuildId
                          ? "border-neutral-100 opacity-50 dark:border-neutral-800"
                          : "border-neutral-200 bg-white hover:border-amber-300 dark:border-neutral-700 dark:bg-neutral-800"
                      }`}
                    >
                      <span className="text-3xl">{guild.emblem ?? "🏰"}</span>
                      <span className="text-xs font-semibold text-neutral-900 dark:text-white line-clamp-1">
                        {guild.name}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {guild.memberCount} members
                      </span>
                      {joinedGuildId === guild.id && (
                        <span className="absolute right-2 top-2 text-xs text-amber-500">✓ Joined</span>
                      )}
                      {joiningGuildId === guild.id && (
                        <span className="absolute right-2 top-2 text-xs text-neutral-400">…</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-400 text-center py-8">
                  No guilds found in your city yet. You can join one later from the Guilds tab.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setQuestsLoading(true);
                    fetch("/api/quests/daily")
                      .then((r) => r.json())
                      .then((d: { quests?: NewMemberQuest[] }) => setFirstQuests(d.quests?.slice(0, 2) ?? []))
                      .catch(() => {})
                      .finally(() => setQuestsLoading(false));
                    setStep(5);
                  }}
                  className="flex-[2] rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
                >
                  {joinedGuildId ? "Nice! Next →" : "Skip for now →"}
                </button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP 2 — Vibe Quiz
          ================================================================ */}
          {step === 2 && (
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-black text-neutral-900 dark:text-white">
                  Set the vibe
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  4 quick questions to personalise your experience.
                </p>
              </div>

              {/* Q1 */}
              <VibeQuestion
                question="What do you do most?"
                options={[
                  { value: "argue", label: "Argue 🗣️" },
                  { value: "gist", label: "Gist 💬" },
                  { value: "learn", label: "Learn 📚" },
                  { value: "flex", label: "Flex 💅" },
                ]}
                selected={vibeAnswers.activity}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, activity: v }))}
              />

              {/* Q2 */}
              <VibeQuestion
                question="Are you a lone wolf or a crew person?"
                options={[
                  { value: "lone_wolf", label: "Lone wolf 🐺" },
                  { value: "crew", label: "Crew person 👥" },
                  { value: "both", label: "Depends on the mood 🔄" },
                  { value: "squad", label: "Deep squad 🤝" },
                ]}
                selected={vibeAnswers.socialStyle}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, socialStyle: v }))}
              />

              {/* Q3 */}
              <VibeQuestion
                question="What brings you here?"
                options={[
                  { value: "friends", label: "Find my people 👫" },
                  { value: "money", label: "Stack coins 💰" },
                  { value: "vibing", label: "Just vibing 🎵" },
                  { value: "all", label: "All of the above 🚀" },
                ]}
                selected={vibeAnswers.motivation}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, motivation: v }))}
              />

              {/* Q4 */}
              <VibeQuestion
                question="Pick your city's vibe."
                options={[
                  { value: "hustle", label: "Hustle city 💼" },
                  { value: "culture", label: "Culture hub 🎭" },
                  { value: "nightlife", label: "Nightlife 🌃" },
                  { value: "community", label: "Community first 🤲" },
                ]}
                selected={vibeAnswers.cityVibe}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, cityVibe: v }))}
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setError(null); setStep(1); }}
                  className="flex-1 rounded-xl border border-neutral-200 py-3.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    const err = validateStep2();
                    if (err) { setError(err); return; }
                    setError(null);
                    void submitOnboarding();
                  }}
                  className="flex-[2] rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Setting up your world…" : "Let's go 🚀"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: VibeQuestion
// ---------------------------------------------------------------------------

interface VibeQuestionProps {
  question: string;
  options: { value: string; label: string }[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}

function VibeQuestion({ question, options, selected, onSelect }: VibeQuestionProps) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {question}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`rounded-xl px-3 py-3 text-left text-sm transition-all ${
              selected === opt.value
                ? "bg-amber-400 font-semibold text-neutral-900"
                : "border border-neutral-200 bg-white text-neutral-700 hover:border-amber-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
