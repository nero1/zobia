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
 * Age gate enforced: birth year required; users below minimumAge are blocked.
 * Redirects to /(app)/home on completion.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useTranslation } from "react-i18next";
import {
  getStoredReferralCode,
  clearStoredReferralCode,
} from "@/lib/referral/clientStore";

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
  id: string;
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

const CURRENT_YEAR = new Date().getFullYear();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useTranslation();

  // Manifest (loaded once)
  const [manifest, setManifest] = useState<ManifestPublic | null>(null);

  // Form state — Step 1
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("😎");
  const [city, setCity] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");

  // Per-field validation errors — Step 1
  const [usernameFieldError, setUsernameFieldError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [birthYearError, setBirthYearError] = useState<string | null>(null);

  // Step 1 field refs for scroll-to-error
  const usernameRef = useRef<HTMLDivElement>(null);
  const displayNameRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLDivElement>(null);
  const birthYearRef = useRef<HTMLDivElement>(null);

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

  // Scroll error banner into view when server-side errors occur
  const errorBannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) {
      errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

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
        .then((d: { data?: { users?: FriendSearchResult[] } }) => setFriendResults(d.data?.users ?? []))
        .catch(() => setFriendResults([]))
        .finally(() => setFriendSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [friendQuery]);

  // ---------------------------------------------------------------------------
  // Step 1 validation — sets per-field errors and scrolls to first error
  // ---------------------------------------------------------------------------
  function validateStep1(): boolean {
    const minAge = manifest?.minimumAge ?? 18;
    const errs = {
      username: usernameStatus !== "ok" ? t("onboarding.step1.usernameError") : null,
      displayName: !displayName.trim() ? t("onboarding.step1.displayNameError") : null,
      city: !city ? t("onboarding.step1.cityError") : null,
      birthYear: (() => {
        if (!birthYear) return t("onboarding.step1.birthYearError");
        const yr = parseInt(birthYear, 10);
        if (isNaN(yr) || yr < 1900 || yr > CURRENT_YEAR) return t("onboarding.step1.birthYearInvalid", { year: CURRENT_YEAR });
        if (CURRENT_YEAR - yr < minAge) return t("onboarding.step1.ageError", { age: minAge });
        return null;
      })(),
    };

    setUsernameFieldError(errs.username);
    setDisplayNameError(errs.displayName);
    setCityError(errs.city);
    setBirthYearError(errs.birthYear);

    const errorOrder: { hasError: string | null; ref: React.RefObject<HTMLDivElement> }[] = [
      { hasError: errs.username, ref: usernameRef },
      { hasError: errs.displayName, ref: displayNameRef },
      { hasError: errs.city, ref: cityRef },
      { hasError: errs.birthYear, ref: birthYearRef },
    ];

    const firstError = errorOrder.find((e) => e.hasError !== null);
    if (firstError) {
      setTimeout(() => {
        firstError.ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Step 2 validation
  // ---------------------------------------------------------------------------
  function validateStep2(): boolean {
    const q = ["activity", "socialStyle", "motivation", "cityVibe"] as const;
    for (const key of q) {
      if (!vibeAnswers[key]) {
        setError(t("onboarding.step2.allRequired"));
        return false;
      }
    }
    return true;
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
    if (!validateStep1()) return;
    if (!validateStep2()) return;

    setSubmitting(true);
    setError(null);

    try {
      // Silently refresh the access token before submitting so an expired
      // 15-minute cookie doesn't cause a spurious "Unauthorised" error.
      await fetch("/api/auth/refresh", { method: "POST" }).catch(() => {});

      const captchaToken = await getCaptchaToken();

      // Replay any referral code captured from a `?r=` link earlier in the
      // funnel (stored by ReferralCapture). Server validates and attributes it.
      const referralCode = getStoredReferralCode();

      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.toLowerCase(),
          display_name: displayName.trim(),
          avatar_emoji: avatarEmoji,
          city,
          birth_year: parseInt(birthYear, 10),
          vibe_quiz_responses: vibeAnswers,
          captcha_token: captchaToken ?? undefined,
          referral_code: referralCode ?? undefined,
        }),
      });

      const data = await res.json() as { error?: string; minAge?: number };

      if (!res.ok) {
        if (data.error === "age_requirement") {
          setError(t("onboarding.error.ageTooYoung", { age: data.minAge ?? 18 }));
        } else if (data.error === "captcha_failed") {
          setError(t("onboarding.error.captchaFailed"));
        } else if (data.error === "username_taken") {
          setError(t("onboarding.error.usernameTaken"));
          setStep(1);
        } else {
          setError(data.error ?? t("onboarding.error.generic"));
        }
        return;
      }

      // Referral consumed — clear it so a later organic signup on this device
      // is never misattributed to the same referrer.
      clearStoredReferralCode();

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
        fetch("/api/referrals", { credentials: "include" })
          .then((r) => r.json())
          .then((d: { data?: { referralUrl?: string | null } }) => {
            if (d.data?.referralUrl) setReferralUrl(d.data.referralUrl);
          })
          .catch(() => {});
      }, 2500);

    } catch {
      setError(t("onboarding.error.network"));
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const usernameIndicator = {
    idle: null,
    checking: <span className="text-xs text-neutral-400">{t("onboarding.step1.usernameChecking")}</span>,
    ok: <span className="text-xs text-green-600">{t("onboarding.step1.usernameAvailable")}</span>,
    taken: <span className="text-xs text-red-500">{t("onboarding.step1.usernameTaken")}</span>,
    invalid: <span className="text-xs text-red-500">{t("onboarding.step1.usernameInvalid")}</span>,
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
        <h1 className="mt-6 text-3xl font-black text-white">{t("onboarding.xpDrop.title")}</h1>
        <p className="mt-3 text-lg text-amber-400 font-semibold">{t("onboarding.xpDrop.xpEarned")}</p>
        <div className="mt-4 h-3 w-64 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-[2000ms] ease-out"
            style={{ width: welcomeXP ? "40%" : "0%" }}
          />
        </div>
        <p className="mt-2 text-sm text-neutral-400">{t("onboarding.xpDrop.redirect")}</p>
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

          {/* Error banner — server errors and step 2 validation */}
          {error && (
            <div ref={errorBannerRef} role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
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
                  {t("onboarding.step1.title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  {t("onboarding.step1.subtitle")}
                </p>
              </div>

              {/* Avatar picker */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step1.avatarLabel")}
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
              <div ref={usernameRef}>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step1.usernameLabel")}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUsernameFieldError(null); }}
                  placeholder={t("onboarding.step1.usernamePlaceholder")}
                  maxLength={30}
                  aria-invalid={!!usernameFieldError}
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 dark:bg-neutral-800 dark:text-white transition-colors ${
                    usernameFieldError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                      : "border-neutral-200 dark:border-neutral-700 focus:border-amber-400 focus:ring-amber-400/20"
                  }`}
                  autoComplete="off"
                />
                <div className="mt-1">
                  {usernameFieldError
                    ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{usernameFieldError}</p>
                    : usernameIndicator}
                </div>
              </div>

              {/* Display name */}
              <div ref={displayNameRef}>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step1.displayNameLabel")}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setDisplayNameError(null); }}
                  placeholder={t("onboarding.step1.displayNamePlaceholder")}
                  maxLength={50}
                  aria-invalid={!!displayNameError}
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 dark:bg-neutral-800 dark:text-white transition-colors ${
                    displayNameError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                      : "border-neutral-200 dark:border-neutral-700 focus:border-amber-400 focus:ring-amber-400/20"
                  }`}
                />
                {displayNameError && (
                  <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{displayNameError}</p>
                )}
              </div>

              {/* City */}
              <div ref={cityRef}>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step1.cityLabel")}
                </label>
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => { setCitySearch(e.target.value); setCity(""); setCityError(null); }}
                  placeholder={t("onboarding.step1.citySearchPlaceholder")}
                  aria-invalid={!!cityError}
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 dark:bg-neutral-800 dark:text-white transition-colors ${
                    cityError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                      : "border-neutral-200 dark:border-neutral-700 focus:border-amber-400 focus:ring-amber-400/20"
                  }`}
                />
                {citySearch && !city && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                    {filteredCities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { setCity(c); setCitySearch(c); setCityError(null); }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {city
                  ? <p className="mt-1 text-xs text-green-600">{t("onboarding.step1.citySelected", { city })}</p>
                  : cityError && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{cityError}</p>
                }
              </div>

              {/* Year of birth — age gate (full date of birth can be set in settings) */}
              <div ref={birthYearRef}>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step1.birthYearLabel")}
                </label>
                <input
                  type="number"
                  value={birthYear}
                  onChange={(e) => { setBirthYear(e.target.value); setBirthYearError(null); }}
                  placeholder={`e.g. ${CURRENT_YEAR - 20}`}
                  min={1900}
                  max={CURRENT_YEAR}
                  aria-invalid={!!birthYearError}
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 dark:bg-neutral-800 dark:text-white transition-colors ${
                    birthYearError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                      : "border-neutral-200 dark:border-neutral-700 focus:border-amber-400 focus:ring-amber-400/20"
                  }`}
                />
                {birthYearError
                  ? <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{birthYearError}</p>
                  : <p className="mt-1 text-xs text-neutral-400">
                      {t("onboarding.step1.birthYearHint", { age: manifest?.minimumAge ?? 18 })}
                    </p>
                }
              </div>

              {/* Turnstile widget mount point */}
              {manifest?.captchaProvider === "turnstile" && (
                <div ref={captchaContainerRef} />
              )}

              <button
                type="button"
                onClick={() => {
                  if (!validateStep1()) return;
                  setError(null);
                  setStep(2);
                }}
                className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
              >
                {t("onboarding.step1.continueBtn")}
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
                  {t("onboarding.step5.title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  {t("onboarding.step5.subtitle")}
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
                  {t("onboarding.step5.findPeople")}
                </h2>
                <p className="mb-3 text-sm text-neutral-500">
                  {t("onboarding.step5.findPeopleHint")}
                </p>
              </div>

              {/* Friend search */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step5.searchLabel")}
                </label>
                <input
                  type="text"
                  value={friendQuery}
                  onChange={(e) => setFriendQuery(e.target.value)}
                  placeholder={t("onboarding.step5.searchPlaceholder")}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />

                {friendSearching && (
                  <p className="mt-2 text-xs text-neutral-400">{t("onboarding.step5.searching")}</p>
                )}

                {friendResults.length > 0 && (
                  <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white shadow-sm dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
                    {friendResults.map((u) => (
                      <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="text-2xl">{u.avatarEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{u.displayName}</p>
                          <p className="truncate text-xs text-neutral-500">@{u.username}</p>
                        </div>
                        <button
                          type="button"
                          disabled={addedFriends.has(u.id)}
                          onClick={async () => {
                            try {
                              await fetch("/api/friends", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ userId: u.id }),
                              });
                              setAddedFriends((prev) => new Set([...prev, u.id]));
                            } catch { /* best-effort */ }
                          }}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                            addedFriends.has(u.id)
                              ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                              : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                          }`}
                        >
                          {addedFriends.has(u.id) ? t("onboarding.step5.added") : t("onboarding.step5.add")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!friendSearching && friendQuery.length >= 2 && friendResults.length === 0 && (
                  <p className="mt-2 text-xs text-neutral-400">{t("onboarding.step5.noResults", { query: friendQuery })}</p>
                )}
              </div>

              {/* Referral link */}
              <div>
                <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("onboarding.step5.inviteLabel")}
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
                      {referralCopied ? t("onboarding.step5.copiedBtn") : t("onboarding.step5.copyBtn")}
                    </button>
                  </div>
                ) : (
                  <div className="h-11 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                )}
              </div>

              <button
                type="button"
                onClick={() => router.push("/home")}
                className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
              >
                {addedFriends.size > 0
                  ? t("onboarding.step5.startWithFriendsBtn", { count: addedFriends.size })
                  : t("onboarding.step5.startBtn")}
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
                  {t("onboarding.step4.title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  {t("onboarding.step4.subtitle")}
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
                  {t("onboarding.step4.noGuilds")}
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
                  {joinedGuildId ? t("onboarding.step4.nextBtn") : t("onboarding.step4.skipBtn")}
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
                  {t("onboarding.step2.title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  {t("onboarding.step2.subtitle")}
                </p>
              </div>

              {/* Q1 */}
              <VibeQuestion
                question={t("onboarding.step2.q1")}
                options={[
                  { value: "argue", label: t("onboarding.step2.q1.argue") },
                  { value: "gist",  label: t("onboarding.step2.q1.gist")  },
                  { value: "learn", label: t("onboarding.step2.q1.learn") },
                  { value: "flex",  label: t("onboarding.step2.q1.flex")  },
                ]}
                selected={vibeAnswers.activity}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, activity: v }))}
              />

              {/* Q2 */}
              <VibeQuestion
                question={t("onboarding.step2.q2")}
                options={[
                  { value: "lone_wolf", label: t("onboarding.step2.q2.lone_wolf") },
                  { value: "crew",      label: t("onboarding.step2.q2.crew")      },
                  { value: "both",      label: t("onboarding.step2.q2.both")      },
                  { value: "squad",     label: t("onboarding.step2.q2.squad")     },
                ]}
                selected={vibeAnswers.socialStyle}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, socialStyle: v }))}
              />

              {/* Q3 */}
              <VibeQuestion
                question={t("onboarding.step2.q3")}
                options={[
                  { value: "friends", label: t("onboarding.step2.q3.friends") },
                  { value: "money",   label: t("onboarding.step2.q3.money")   },
                  { value: "vibing",  label: t("onboarding.step2.q3.vibing")  },
                  { value: "all",     label: t("onboarding.step2.q3.all")     },
                ]}
                selected={vibeAnswers.motivation}
                onSelect={(v) => setVibeAnswers((p) => ({ ...p, motivation: v }))}
              />

              {/* Q4 */}
              <VibeQuestion
                question={t("onboarding.step2.q4")}
                options={[
                  { value: "hustle",    label: t("onboarding.step2.q4.hustle")    },
                  { value: "culture",   label: t("onboarding.step2.q4.culture")   },
                  { value: "nightlife", label: t("onboarding.step2.q4.nightlife") },
                  { value: "community", label: t("onboarding.step2.q4.community") },
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
                  {t("onboarding.step2.backBtn")}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (!validateStep2()) return;
                    setError(null);
                    void submitOnboarding();
                  }}
                  className="flex-[2] rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? t("onboarding.step2.submitting") : t("onboarding.step2.submitBtn")}
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
