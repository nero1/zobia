/**
 * lib/blogs/defaultPages.ts
 *
 * Template content for the three pages every blog gets automatically at
 * creation time (migration 0023): About, Privacy, Contact. Each is an
 * ordinary `blog_posts` row (type='page') tagged with `page_key` so
 * "Reset to default" can regenerate the right text regardless of any
 * edits/renames, and so the public post page can special-case Contact into
 * a live form instead of rendering body_html.
 */

export type DefaultPageKey = "about" | "privacy" | "contact";

export const DEFAULT_PAGE_TITLES: Record<DefaultPageKey, string> = {
  about: "About",
  privacy: "Privacy",
  contact: "Contact",
};

/** Markdown source for a default page's body_markdown (content_format='markdown'). Contact's body isn't actually shown (the post page renders a live form for page_key='contact') — kept as a short fallback for anywhere the raw HTML might still be surfaced (RSS, exports, a JS-disabled crawler). */
export function getDefaultPageContent(pageKey: DefaultPageKey, blogName: string): string {
  switch (pageKey) {
    case "about":
      return `Welcome to ${blogName}. Please feel free to look around, comment, share and engage. Subscribe to be notified whenever a new post is published.`;
    case "privacy":
      return getDefaultPrivacyPolicy(blogName);
    case "contact":
      return `Use the contact form on this page to send a message to the team behind ${blogName}.`;
  }
}

function getDefaultPrivacyPolicy(blogName: string): string {
  return `# Privacy Policy

This Privacy Policy explains how ${blogName} ("we", "us", "this blog") collects, uses, and protects information when you visit or interact with this blog.

## Comments

If comments are enabled on this blog, we collect the content of any comment you submit, along with your account username and the time it was posted, so we can display it publicly and moderate it if needed. If comments are disabled on this blog, we do not collect or store any comment content, since the feature is unavailable to visitors.

## Contact Form

If you use the contact form on this blog, we collect the message you submit and, where provided, your name and email address, so we can respond to your inquiry. Logged-in visitors have their username attached automatically; logged-out visitors may optionally provide a name and email.

## Advertising & Analytics

This blog runs advertising to support its operation. We and our advertising partners collect aggregated and anonymized analytics data — such as page views, general traffic patterns, and crash/error information — to keep the blog reliable and to measure ad performance. This data is used for traffic analysis and to diagnose technical issues; it is not used to build an individually identifying profile of you from this blog alone.

## Third-Party Advertising

Ads shown on this blog may be served by third-party advertising networks, including Google. These third parties may use cookies or similar technologies to serve ads based on your prior visits to this and other websites. You can learn more about how Google uses data from sites that use its services, and manage your ad preferences, at Google's Ads Privacy & Terms page (opens in a new tab): https://policies.google.com/technologies/ads

## Changes to This Policy

We may update this Privacy Policy from time to time. Continued use of this blog after changes are posted constitutes acceptance of the updated policy.

## Contact

If you have questions about this Privacy Policy, please use the Contact page on this blog.`;
}

export const GOOGLE_ADS_PRIVACY_URL = "https://policies.google.com/technologies/ads";
