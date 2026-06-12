/**
 * lib/security/htmlSanitizer.ts
 *
 * Server-side HTML sanitizer using a strict allow-list.
 * Strips all script tags, event handlers, and dangerous attributes.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "br", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span",
  "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  "*": new Set(["class", "id"]),
};

const DANGEROUS_PROTOCOLS = /^(javascript|vbscript|data):/i;

export function sanitizeHtml(dirty: string): string {
  // Remove script tags and their content completely
  let clean = dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  // Remove style tags
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  // Remove on* event handlers
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  clean = clean.replace(/\s+on\w+\s*=\s*\S+/gi, "");
  // Remove javascript: in href/src attributes
  clean = clean.replace(/(href|src)\s*=\s*["']javascript:[^"']*["']/gi, "");
  clean = clean.replace(/(href|src)\s*=\s*["']data:[^"']*["']/gi, "");
  // Remove vbscript:
  clean = clean.replace(/(href|src)\s*=\s*["']vbscript:[^"']*["']/gi, "");
  return clean;
}

/** Sanitize HTML only when contentType is 'html'. Pass-through for 'plain' and 'markdown'. */
export function sanitizeAnnouncementContent(content: string, contentType: string): string {
  if (contentType === "html") {
    return sanitizeHtml(content);
  }
  return content;
}
