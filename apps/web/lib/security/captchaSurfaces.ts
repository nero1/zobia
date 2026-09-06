/**
 * lib/security/captchaSurfaces.ts
 *
 * Registry of distinct surfaces (forms/flows) that CAN have CAPTCHA
 * verification independently enabled or disabled. Admin picks a subset of
 * this list at /gate44/config ("CAPTCHA" group), on top of the master
 * `captcha_provider` switch (recaptcha | turnstile | none).
 *
 * To add a new CAPTCHA-gated surface:
 *   1. Add an entry below with a stable `key` (used in the x_manifest JSON
 *      array value and as the reCAPTCHA v3 `expectedAction`).
 *   2. Gate the client-side widget render on
 *      `manifest.captchaProvider !== "none" && manifest.captchaEnabledSurfaces.includes(key)`.
 *   3. Gate the server-side verification on
 *      `isCaptchaSurfaceEnabled(key)` (see lib/security/captcha.ts) before
 *      requiring/verifying the token.
 * No new admin UI or migration is needed for the toggle itself — the config
 * page renders checkboxes for whatever is in this array. A migration IS
 * still needed to seed the new key's default value the first time this
 * registry changes (see db/migrations).
 */

export interface CaptchaSurfaceDef {
  key: string;
  label: string;
  description: string;
}

export const CAPTCHA_SURFACE_REGISTRY: CaptchaSurfaceDef[] = [
  { key: "login", label: "Login", description: "Sign-in form on the login page." },
  { key: "admin_login", label: "Admin Login", description: "Sign-in form on the /gate44 admin login page." },
  { key: "signup", label: "Signup", description: "New-account registration / onboarding completion." },
  { key: "create_blog", label: "Create Blog", description: "Creating a new blog." },
  { key: "create_room", label: "Create Room", description: "Creating a new room." },
  { key: "contact_us", label: "Contact Us Page", description: "Site-wide Contact Us page form." },
  { key: "blog_comments", label: "Blog Comments", description: "Posting a comment on a blog post." },
  { key: "create_question", label: "Create Question", description: "Posting a new question in the Answers (Q&A) forum." },
  { key: "submit_answer", label: "Submit Answer", description: "Submitting an answer to a question." },
  { key: "reply_answer_comment", label: "Reply to Answer/Comment", description: "Replying to an answer or comment thread." },
  { key: "blog_contact_form", label: "Blog Contact Form", description: "Per-blog \"Contact\" form on an individual blog's pages." },
];

export const CAPTCHA_SURFACE_KEYS = CAPTCHA_SURFACE_REGISTRY.map((s) => s.key);

/** Union of valid surface keys. */
export type CaptchaSurface = (typeof CAPTCHA_SURFACE_REGISTRY)[number]["key"];

/** Default: all surfaces enabled (preserves/extends current behavior once a real provider is selected). */
export const DEFAULT_CAPTCHA_ENABLED_SURFACES: CaptchaSurface[] = [...CAPTCHA_SURFACE_KEYS];
