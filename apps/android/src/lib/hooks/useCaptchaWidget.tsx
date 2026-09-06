/**
 * apps/android/src/lib/hooks/useCaptchaWidget.tsx
 *
 * Shared CAPTCHA widget hook for the Android (Capacitor) app — the
 * Android-side equivalent of apps/web/components/security/useCaptchaWidget.tsx.
 * Extracted from the ad-hoc reCAPTCHA v3 / Turnstile loading logic that used
 * to live only in routes/onboarding.tsx (the "signup" surface) so the other
 * CAPTCHA-gated surfaces on Android (create_blog, create_question,
 * submit_answer, reply_answer_comment, blog_comments) don't each reimplement
 * script-loading/token-fetching from scratch.
 *
 * Android is a Capacitor WebView SPA hitting the same backend as the web
 * app, so it shares the manifest shape (`captchaProvider` /
 * `captchaEnabledSurfaces`) but not React/Next primitives — this duplicates
 * (rather than imports) the web hook's logic using this app's own
 * `useManifest()` + plain DOM script tags instead of next/script.
 *
 * Usage:
 * ```tsx
 * const { enabled, getToken, WidgetSlot, ScriptTags } = useCaptchaWidget('create_blog');
 * // ...
 * <WidgetSlot />      // renders the Turnstile container (no-op for reCAPTCHA v3 or when disabled)
 * <ScriptTags />      // loads the provider's script once, once manifest resolves
 * const token = await getToken(); // call right before submit
 * ```
 *
 * Gating: a surface only renders/executes a widget when BOTH
 *   - manifest.captchaProvider !== 'none', AND
 *   - manifest.captchaEnabledSurfaces.includes(surface)
 * Server-side verification (isCaptchaSurfaceEnabled()) is the actual
 * security gate — this hook is UX only, exactly like its web counterpart.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useManifest } from '@/lib/hooks/useManifest';

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
  captchaProvider?: 'recaptcha' | 'turnstile' | 'none';
  captchaEnabledSurfaces?: string[];
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
}

export interface UseCaptchaWidgetResult {
  /** True once the manifest is loaded and the widget should be shown/used for this surface. */
  enabled: boolean;
  /** Fetch a fresh CAPTCHA token. Returns null if disabled or the widget hasn't produced one yet. */
  getToken: () => Promise<string | null>;
  /** Renders the Turnstile widget container (no-op for reCAPTCHA v3 or when disabled). */
  WidgetSlot: () => JSX.Element | null;
  /** Loads the provider's script tag(s) once resolved. Render once near the bottom of the form. */
  ScriptTags: () => JSX.Element | null;
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Load and manage a CAPTCHA widget for a given surface.
 *
 * @param surface - Which form/flow this widget guards (also used as the
 *                  reCAPTCHA v3 `expectedAction`, matched server-side).
 * @param skip    - Skip fetching/rendering entirely.
 */
export function useCaptchaWidget(surface: string, skip: boolean = false): UseCaptchaWidgetResult {
  const manifest = useManifest() as CaptchaManifest | undefined;
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const enabled =
    !skip &&
    !!manifest &&
    manifest.captchaProvider !== 'none' &&
    manifest.captchaProvider !== undefined &&
    (manifest.captchaEnabledSurfaces?.includes(surface) ?? true);

  useEffect(() => {
    if (!enabled || !manifest) return;
    if (manifest.captchaProvider === 'recaptcha' && manifest.recaptchaSiteKey) {
      loadScriptOnce(`https://www.google.com/recaptcha/api.js?render=${manifest.recaptchaSiteKey}`)
        .then(() => setScriptLoaded(true))
        .catch(() => {});
    } else if (manifest.captchaProvider === 'turnstile' && manifest.turnstileSiteKey) {
      loadScriptOnce('https://challenges.cloudflare.com/turnstile/v0/api.js')
        .then(() => {
          setScriptLoaded(true);
          if (turnstileContainerRef.current && !turnstileWidgetId.current && window.turnstile) {
            turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
              sitekey: manifest.turnstileSiteKey,
            });
          }
        })
        .catch(() => {});
    }
  }, [enabled, manifest]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!enabled || !manifest) return null;
    if (manifest.captchaProvider === 'recaptcha' && manifest.recaptchaSiteKey) {
      const recaptchaPromise = new Promise<string | null>((resolve) => {
        if (!window.grecaptcha) { resolve(null); return; }
        window.grecaptcha.ready(async () => {
          try {
            resolve(await window.grecaptcha!.execute(manifest.recaptchaSiteKey!, { action: surface }));
          } catch {
            resolve(null);
          }
        });
      });
      // Belt-and-suspenders: never hang the UI indefinitely if the script is
      // present but `.ready()`/`.execute()` never resolves.
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
      return Promise.race([recaptchaPromise, timeoutPromise]);
    }
    if (manifest.captchaProvider === 'turnstile' && turnstileWidgetId.current) {
      return window.turnstile?.getResponse(turnstileWidgetId.current) ?? null;
    }
    return null;
  }, [enabled, manifest, surface]);

  const WidgetSlot = useCallback(() => {
    if (!enabled || manifest?.captchaProvider !== 'turnstile' || !manifest.turnstileSiteKey) return null;
    return <div ref={turnstileContainerRef} />;
  }, [enabled, manifest]);

  const ScriptTags = useCallback(() => {
    void scriptLoaded; // scripts are loaded imperatively above; this exists only for API parity with the web hook.
    return null;
  }, [scriptLoaded]);

  return { enabled, getToken, WidgetSlot, ScriptTags };
}
