"use client";

/**
 * components/contact/SiteContactForm.tsx
 *
 * The site-wide Contact Us page (app/contact/page.tsx). Reuses the same
 * UI/behavior pattern as components/blogs/ContactForm.tsx (that per-blog
 * form's styling and captcha/token flow), plus a Subject field since this
 * inbox isn't scoped to a single blog owner's context.
 *
 *   - Logged in: username is auto-filled and read-only, plus subject + message.
 *   - Logged out: name (optional) + email (optional) + subject + message,
 *     plus the CAPTCHA widget when the "contact_us" surface is enabled.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCaptchaWidget } from "@/components/security/useCaptchaWidget";

interface Viewer {
  username: string;
}

export function SiteContactForm({ viewer }: { viewer: Viewer | null }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { enabled: captchaEnabled, getToken: getCaptchaToken, WidgetSlot, ScriptTags } =
    useCaptchaWidget("contact_us");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message.trim() || submitting) return;
    if (!viewer && !email.trim()) {
      setError(t("contactUs.emailRequired", "Please provide an email so we can reply to you."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = await getCaptchaToken();
      if (captchaEnabled && !captchaToken) {
        throw new Error(t("contactUs.captchaIncomplete", "Please complete the verification widget."));
      }
      const res = await fetch("/api/contact", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim() || undefined,
          message: message.trim(),
          name: viewer ? undefined : name.trim() || undefined,
          email: viewer ? undefined : email.trim() || undefined,
          captchaToken: captchaToken ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("contactUs.sendFailed", "Failed to send message"));
      setSent(true);
      setSubject("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("contactUs.sendFailed", "Failed to send message"));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t("contactUs.sent", "Your message has been sent. Thanks for reaching out — we'll get back to you soon.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      {viewer ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("contactUs.from", "From")}
          </label>
          <input
            value={`@${viewer.username}`}
            readOnly
            disabled
            className="w-full rounded-xl border border-neutral-200 bg-neutral-100 px-3 py-2.5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-400"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t("contactUs.name", "Name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t("contactUs.email", "Email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              required
              className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("contactUs.subject", "Subject (optional)")}
        </label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder={t("contactUs.subjectPlaceholder", "What's this about?")}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("contactUs.message", "Message")}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={6}
          placeholder={t("contactUs.messagePlaceholder", "How can we help?")}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <WidgetSlot />

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!message.trim() || submitting}
        className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {submitting ? t("contactUs.sending", "Sending…") : t("contactUs.send", "Send message")}
      </button>

      <ScriptTags />
    </div>
  );
}
