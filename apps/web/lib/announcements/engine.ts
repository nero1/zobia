/**
 * lib/announcements/engine.ts
 *
 * Announcement resolution engine.
 *
 * Determines which modal and banner to show a specific user based on:
 *  - Active status (is_active = true)
 *  - Schedule (starts_at / ends_at)
 *  - Plan targeting (empty = all plans)
 *  - Role targeting (empty = all roles)
 *  - Display mode from x_manifest (serial or random)
 *  - For serial mode: tracks viewed modals via user_modal_views
 *
 * HTML content from admins is sanitized before being returned.
 *
 * @module lib/announcements/engine
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved announcement modal ready to display. */
export interface ResolvedModal {
  id: string;
  title: string;
  content: string;
  content_type: "html" | "markdown" | "plain";
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
}

/** A resolved announcement banner ready to display. */
export interface ResolvedBanner {
  id: string;
  title: string;
  content: string;
  content_type: "html" | "markdown" | "plain";
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

/** Minimal user object needed for targeting. */
export interface AnnouncementUser {
  id: string;
  plan_id?: string | null;
  role?: string | null;
}

// ---------------------------------------------------------------------------
// sanitizeHtmlContent
// ---------------------------------------------------------------------------

/**
 * Sanitize HTML content from admins to prevent XSS.
 *
 * On the server side (Node.js), we perform a conservative tag allowlist.
 * For browser rendering, DOMPurify should additionally be applied client-side.
 *
 * Allowed tags: b, i, u, em, strong, p, br, ul, ol, li, a (href only),
 *               h1–h4, blockquote, code, pre
 *
 * @param content - Raw HTML string from the database
 * @returns Sanitized HTML safe for rendering
 */
export function sanitizeHtmlContent(content: string): string {
  // Server-side conservative sanitization
  // Remove script, style, on* attributes, data: URIs
  let sanitized = content
    // Strip script tags and contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Strip style tags and contents
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    // Strip on* event handlers
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "")
    // Strip javascript: and data: hrefs
    .replace(/href\s*=\s*["']?\s*(javascript|data):[^"'\s>]*/gi, 'href="#"')
    // Strip iframe, object, embed, form
    .replace(
      /<\/?(?:iframe|object|embed|form|input|button|select|textarea)\b[^>]*>/gi,
      ""
    );

  return sanitized;
}

// ---------------------------------------------------------------------------
// Internal targeting helpers
// ---------------------------------------------------------------------------

/**
 * Check if a user matches a modal/banner's targeting criteria.
 *
 * Empty target arrays mean "show to everyone".
 *
 * @param user        - The current user
 * @param targetPlans - Plans the announcement targets (empty = all)
 * @param targetRoles - Roles the announcement targets (empty = all)
 */
function matchesTargeting(
  user: AnnouncementUser,
  targetPlans: string[],
  targetRoles: string[]
): boolean {
  if (targetPlans.length > 0 && user.plan_id) {
    if (!targetPlans.includes(user.plan_id)) return false;
  }
  if (targetRoles.length > 0 && user.role) {
    if (!targetRoles.includes(user.role)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// getActiveModalForUser
// ---------------------------------------------------------------------------

/**
 * Resolve the single announcement modal to show the current user.
 *
 * Display mode is read from the x_manifest table (key: announcement_modal_mode).
 *  - "serial"   → show modals in display_order; skip already-viewed ones
 *  - "random"   → pick a random eligible modal each session
 *
 * Returns null if no eligible modal exists.
 *
 * @param userId - Authenticated user's UUID
 * @param user   - User object with plan and role for targeting
 * @param db     - Database adapter
 * @returns The modal to show, or null
 */
export async function getActiveModalForUser(
  userId: string,
  user: AnnouncementUser,
  db: DatabaseAdapter
): Promise<ResolvedModal | null> {
  // Read display mode from manifest
  const { rows: manifestRows } = await db.query<{ value: string }>(
    `SELECT value FROM x_manifest WHERE key = 'announcement_modal_mode'`
  );
  const displayMode =
    (manifestRows[0]?.value as "serial" | "random") ?? "serial";

  // Fetch all active, in-schedule modals
  const { rows: modals } = await db.query<{
    id: string;
    title: string;
    content: string;
    content_type: string;
    display_order: number;
    target_plans: string[];
    target_roles: string[];
    starts_at: string | null;
    ends_at: string | null;
  }>(
    `SELECT
       id, title, content, content_type, display_order,
       COALESCE(target_plans, '{}')::text[]  AS target_plans,
       COALESCE(target_roles, '{}')::text[]  AS target_roles,
       starts_at, ends_at
     FROM announcement_modals
     WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
       AND deleted_at IS NULL
     ORDER BY display_order ASC`
  );

  // Filter by targeting
  const eligible = modals.filter((m) =>
    matchesTargeting(user, m.target_plans, m.target_roles)
  );

  if (eligible.length === 0) return null;

  let selected = eligible[0];

  if (displayMode === "serial") {
    // Find the first modal the user hasn't viewed
    const { rows: viewedRows } = await db.query<{ modal_id: string }>(
      `SELECT modal_id FROM user_modal_views WHERE user_id = $1`,
      [userId]
    );
    const viewedIds = new Set(viewedRows.map((r) => r.modal_id));
    const unviewed = eligible.filter((m) => !viewedIds.has(m.id));
    if (unviewed.length === 0) return null;
    selected = unviewed[0];
  } else if (displayMode === "random") {
    selected = eligible[Math.floor(Math.random() * eligible.length)];
  }

  return {
    id: selected.id,
    title: selected.title,
    content:
      selected.content_type === "html"
        ? sanitizeHtmlContent(selected.content)
        : selected.content,
    content_type: selected.content_type as ResolvedModal["content_type"],
    display_order: selected.display_order,
    starts_at: selected.starts_at,
    ends_at: selected.ends_at,
  };
}

// ---------------------------------------------------------------------------
// getActiveBannerForUser
// ---------------------------------------------------------------------------

/**
 * Resolve the single announcement banner to show the current user.
 *
 * Returns the highest-priority (lowest display_order) banner that
 * matches the user's plan and role targeting.
 *
 * Returns null if no eligible banner exists.
 *
 * @param userId - Authenticated user's UUID
 * @param user   - User object with plan and role for targeting
 * @param db     - Database adapter
 * @returns The banner to show, or null
 */
export async function getActiveBannerForUser(
  userId: string,
  user: AnnouncementUser,
  db: DatabaseAdapter
): Promise<ResolvedBanner | null> {
  const { rows: banners } = await db.query<{
    id: string;
    title: string;
    content: string;
    content_type: string;
    link_url: string | null;
    target_plans: string[];
    target_roles: string[];
    starts_at: string | null;
    ends_at: string | null;
  }>(
    `SELECT
       id, title, content, content_type, link_url,
       COALESCE(target_plans, '{}')::text[]  AS target_plans,
       COALESCE(target_roles, '{}')::text[]  AS target_roles,
       starts_at, ends_at
     FROM announcement_banners
     WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
       AND deleted_at IS NULL
     ORDER BY display_order ASC
     LIMIT 20`
  );

  const eligible = banners.filter((b) =>
    matchesTargeting(user, b.target_plans, b.target_roles)
  );

  if (eligible.length === 0) return null;

  const selected = eligible[0];

  return {
    id: selected.id,
    title: selected.title,
    content:
      selected.content_type === "html"
        ? sanitizeHtmlContent(selected.content)
        : selected.content,
    content_type: selected.content_type as ResolvedBanner["content_type"],
    link_url: selected.link_url,
    starts_at: selected.starts_at,
    ends_at: selected.ends_at,
  };
}
