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
  // Strip script/style blocks entirely, including their text content.
  let clean = dirty
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // ZB-12: Replace each remaining tag with either a sanitized version (if the tag
  // name is in ALLOWED_TAGS) or an empty string. Attributes are filtered to the
  // per-tag allow-list; href/src values are checked against DANGEROUS_PROTOCOLS.
  clean = clean.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g,
    (_match: string, slash: string, rawTag: string, rawAttrs: string): string => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";

      // Closing tag — just emit the tag name, no attributes
      if (slash === "/") return `</${tag}>`;

      // Build the per-tag allowed-attribute set (global "*" attrs + tag-specific attrs)
      const tagAllowedAttrs = new Set<string>([
        ...(ALLOWED_ATTRS["*"] ?? new Set<string>()),
        ...(ALLOWED_ATTRS[tag] ?? new Set<string>()),
      ]);

      // Parse and filter attributes
      const safeAttrs = rawAttrs.replace(
        /\s+([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g,
        (
          _m: string,
          attrName: string,
          dq?: string,
          sq?: string,
          unq?: string
        ): string => {
          const attr = attrName.toLowerCase();
          if (!tagAllowedAttrs.has(attr)) return "";
          const value = dq ?? sq ?? unq ?? "";
          // Block dangerous URL schemes in href/src — decode entities and strip control chars first
          if (attr === "href" || attr === "src") {
            // Decode common HTML entities and strip control chars to prevent bypass
            const decoded = value
              .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
              .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
              .replace(/&amp;/g, "&")
              .replace(/[\x00-\x1f\x7f]/g, ""); // strip control chars
            const scheme = decoded.trim().split(/[:/\s]/)[0]?.toLowerCase() ?? "";
            const ALLOWED_SCHEMES = new Set(["https", "mailto"]);
            if (!ALLOWED_SCHEMES.has(scheme) && decoded.trim().length > 0) {
              return "";
            }
          }
          return ` ${attr}="${value.replace(/"/g, "&quot;")}"`;
        }
      );

      let tagFinalAttrs = safeAttrs;
      if (tag === "a" && tagFinalAttrs.includes('target="_blank"') && !tagFinalAttrs.includes('rel=')) {
        tagFinalAttrs += ' rel="noopener noreferrer"';
      }
      return `<${tag}${tagFinalAttrs}>`;
    }
  );

  return clean;
}

/** Sanitize HTML only when contentType is 'html'. Pass-through for 'plain' and 'markdown'. */
export function sanitizeAnnouncementContent(content: string, contentType: string): string {
  if (contentType === "html") {
    return sanitizeHtml(content);
  }
  if (contentType === "markdown") {
    return content.replace(/\]\((javascript|vbscript|data):[^)]*\)/gi, "](about:blank)");
  }
  return content;
}
