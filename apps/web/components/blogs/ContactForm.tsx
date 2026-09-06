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

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCaptchaWidget } from "@/components/security/useCaptchaWidget";

interface Viewer {
  username: string;
}

export function ContactForm({ blogSlug, viewer }: { blogSlug: string; viewer: Viewer | null }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // captcha only ever applies to logged-out senders — skip fetching/rendering for a logged-in viewer
  const { enabled: captchaEnabled, getToken: getCaptchaToken, WidgetSlot, ScriptTags } =
    useCaptchaWidget("blog_contact_form", !!viewer);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = viewer ? null : await getCaptchaToken();
      if (!viewer && captchaEnabled && !captchaToken) {
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

      {!viewer && <WidgetSlot />}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!message.trim() || submitting}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? t("blogs.contact.sending", "Sending…") : t("blogs.contact.send", "Send message")}
      </button>

      {!viewer && <ScriptTags />}
    </div>
  );
}
