"use client";

/**
 * components/security/useCaptchaWidget.tsx
 *
 * Shared client-side CAPTCHA widget hook, factored out of the ad-hoc
 * reCAPTCHA v3 / Turnstile loading logic that used to be duplicated across
 * components/auth/LoginPageClient.tsx, app/auth/register/page.tsx,
 * app/onboarding/page.tsx and components/blogs/ContactForm.tsx.
 *
 * Usage:
 * ```tsx
 * const { enabled, getToken, WidgetSlot, ScriptTags } = useCaptchaWidget("login");
 * // ...
 * <WidgetSlot />       // renders the Turnstile container (no-op for reCAPTCHA v3 — invisible)
 * <ScriptTags />       // loads the provider's script, once manifest resolves
 * const token = await getToken(); // call right before submit
 * ```
 *
 * Gating: a surface only renders/executes a widget when BOTH
 *   - manifest.captchaProvider !== "none", AND
 *   - manifest.captchaEnabledSurfaces.includes(surface)
 * Server-side verification is the actual security gate — see
 * lib/security/captcha.ts `isCaptchaSurfaceEnabled()`. This hook is UX only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { CaptchaSurface } from "@/lib/security/captchaSurfaces";

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

interface CaptchaManifest {
  captchaProvider: "recaptcha" | "turnstile" | "none";
  captchaEnabledSurfaces?: string[];
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
}

export interface UseCaptchaWidgetResult {
  /** True once manifest is loaded and the widget should be shown/used for this surface. */
  enabled: boolean;
  /** True once the manifest fetch has resolved (enabled may still be false). */
  ready: boolean;
  /** Fetch a fresh CAPTCHA token. Returns null if disabled or the widget hasn't produced one yet. */
  getToken: () => Promise<string | null>;
  /** Renders the Turnstile widget container (invisible/no-op for reCAPTCHA v3 or when disabled). */
  WidgetSlot: () => JSX.Element | null;
  /** Loads the provider's script tag(s) once resolved. Render once near the bottom of the form. */
  ScriptTags: () => JSX.Element | null;
}

/**
 * Load and manage a CAPTCHA widget for a given surface.
 *
 * @param surface        - Which form/flow this widget guards (also used as the
 *                          reCAPTCHA v3 `expectedAction`, matched server-side).
 * @param skip           - Skip fetching/rendering entirely (e.g. a logged-in
 *                          viewer on a form that only needs CAPTCHA for anonymous senders).
 */
export function useCaptchaWidget(
  surface: CaptchaSurface,
  skip: boolean = false
): UseCaptchaWidgetResult {
  const [manifest, setManifest] = useState<CaptchaManifest | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m: CaptchaManifest) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        if (!cancelled) setManifest({ captchaProvider: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [skip]);

  const enabled =
    !skip &&
    !!manifest &&
    manifest.captchaProvider !== "none" &&
    (manifest.captchaEnabledSurfaces?.includes(surface) ?? true);

  const initTurnstile = useCallback(() => {
    if (
      !enabled ||
      manifest?.captchaProvider !== "turnstile" ||
      !manifest.turnstileSiteKey ||
      !turnstileContainerRef.current ||
      turnstileWidgetId.current
    ) {
      return;
    }
    turnstileWidgetId.current =
      window.turnstile?.render(turnstileContainerRef.current, {
        sitekey: manifest.turnstileSiteKey,
      }) ?? null;
  }, [enabled, manifest]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!enabled || !manifest) return null;
    if (manifest.captchaProvider === "recaptcha" && manifest.recaptchaSiteKey) {
      return new Promise((resolve) => {
        window.grecaptcha?.ready(async () => {
          try {
            resolve(
              await window.grecaptcha!.execute(manifest.recaptchaSiteKey!, {
                action: surface,
              })
            );
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
  }, [enabled, manifest, surface]);

  const WidgetSlot = useCallback(() => {
    if (!enabled || manifest?.captchaProvider !== "turnstile" || !manifest.turnstileSiteKey) {
      return null;
    }
    return <div ref={turnstileContainerRef} />;
  }, [enabled, manifest]);

  const ScriptTags = useCallback(() => {
    if (!enabled || !manifest) return null;
    if (manifest.captchaProvider === "recaptcha" && manifest.recaptchaSiteKey) {
      return (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${manifest.recaptchaSiteKey}`}
          strategy="afterInteractive"
        />
      );
    }
    if (manifest.captchaProvider === "turnstile" && manifest.turnstileSiteKey) {
      return (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={initTurnstile}
        />
      );
    }
    return null;
  }, [enabled, manifest, initTurnstile]);

  return { enabled, ready: manifest !== null, getToken, WidgetSlot, ScriptTags };
}
