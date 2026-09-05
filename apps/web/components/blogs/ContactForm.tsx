"use client";

/**
 * components/blogs/ContactForm.tsx
 *
 * The blog's Contact page (page_key='contact') renders this instead of its
 * body_html. Open to every visitor by product spec:
 *   - Logged in: username is auto-filled and read-only, plus a message box.
 *   - Logged out: name (optional) + email (optional) + message, plus the
 *     sitewide CAPTCHA widget when one is configured (manifest
 *     captcha_provider) — same widget/token-collection pattern as
 *     components/auth/LoginPageClient.tsx, reused rather than reinvented.
 *     When no provider is configured, no widget renders and submission
 *     isn't blocked.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Script from "next/script";

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
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
}

interface Viewer {
  username: string;
}

export function ContactForm({ blogSlug, viewer }: { blogSlug: string; viewer: Viewer | null }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [captchaManifest, setCaptchaManifest] = useState<CaptchaManifest | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewer) return; // captcha only ever applies to logged-out senders
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m: CaptchaManifest) => setCaptchaManifest(m))
      .catch(() => setCaptchaManifest({ captchaProvider: "none" }));
  }, [viewer]);

  const initTurnstile = useCallback(() => {
    if (
      captchaManifest?.captchaProvider !== "turnstile" ||
      !captchaManifest.turnstileSiteKey ||
      !turnstileContainerRef.current ||
      turnstileWidgetId.current
    ) return;
    turnstileWidgetId.current = window.turnstile?.render(turnstileContainerRef.current, { sitekey: captchaManifest.turnstileSiteKey }) ?? null;
  }, [captchaManifest]);

  const getCaptchaToken = useCallback(async (): Promise<string | null> => {
    if (!captchaManifest || captchaManifest.captchaProvider === "none") return null;
    if (captchaManifest.captchaProvider === "recaptcha" && captchaManifest.recaptchaSiteKey) {
      return new Promise((resolve) => {
        window.grecaptcha?.ready(async () => {
          try {
            resolve(await window.grecaptcha!.execute(captchaManifest.recaptchaSiteKey!, { action: "blog_contact" }));
          } catch {
            resolve(null);
          }
        });
      });
    }
    if (captchaManifest.captchaProvider === "turnstile" && turnstileWidgetId.current) {
      return window.turnstile?.getResponse(turnstileWidgetId.current) ?? null;
    }
    return null;
  }, [captchaManifest]);

  async function submit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = viewer ? null : await getCaptchaToken();
      if (!viewer && captchaManifest && captchaManifest.captchaProvider !== "none" && !captchaToken) {
        throw new Error(t("blogs.contact.captchaIncomplete", "Please complete the verification widget."));
      }
      const res = await fetch(`/api/blogs/${blogSlug}/contact`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          name: viewer ? undefined : name.trim() || undefined,
          email: viewer ? undefined : email.trim() || undefined,
          captchaToken: captchaToken ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to send message");
      setSent(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-foreground">{t("blogs.contact.sent", "Your message has been sent. Thanks for reaching out!")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {viewer ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("blogs.contact.from", "From")}</label>
          <input value={`@${viewer.username}`} readOnly disabled className="w-full rounded-xl border border-border bg-neutral-900/40 px-3 py-2.5 text-sm text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("blogs.contact.name", "Name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("blogs.contact.email", "Email (optional)")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("blogs.contact.message", "Message")}</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder={t("blogs.contact.messagePlaceholder", "What would you like to say?")}
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {!viewer && captchaManifest?.captchaProvider === "turnstile" && captchaManifest.turnstileSiteKey && (
        <div ref={turnstileContainerRef} />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!message.trim() || submitting}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? t("blogs.contact.sending", "Sending…") : t("blogs.contact.send", "Send message")}
      </button>

      {!viewer && captchaManifest?.captchaProvider === "recaptcha" && captchaManifest.recaptchaSiteKey && (
        <Script src={`https://www.google.com/recaptcha/api.js?render=${captchaManifest.recaptchaSiteKey}`} strategy="afterInteractive" />
      )}
      {!viewer && captchaManifest?.captchaProvider === "turnstile" && captchaManifest.turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" onLoad={initTurnstile} />
      )}
    </div>
  );
}
