/**
 * lib/security/htmlSanitizer.ts
 *
 * Server-side HTML sanitizer using sanitize-html with a strict allow-list.
 */
import sanitizeHtmlLib from 'sanitize-html';
// BUG-M06: marked converts Markdown → HTML before we pass it to sanitizeHtml.
// Previously, raw Markdown was passed directly to sanitize-html, which does not
// parse Markdown tokens — embedded `<script>` tags survived because they were
// wrapped in Markdown syntax that the sanitizer treated as text.
import { marked } from 'marked';

const SANITIZE_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    'a', 'b', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'small', 'span',
    'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    'a': ['href', 'title', 'target', 'rel'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan'],
    // BUG-011 FIX: removed global '*': ['class'] which allowed class on every
    // element, including potentially dangerous ones. Restrict class only to the
    // presentational/semantic elements where it is legitimately needed for
    // syntax highlighting and prose styling. data-* attributes are not permitted.
    'code': ['class'],
    'pre': ['class'],
    'span': ['class'],
  },
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesByTag: {},
  transformTags: {
    'a': (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
  },
};

export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLib(dirty, SANITIZE_OPTIONS);
}

// Blog posts additionally allow images and blockquotes (long-form article
// content) beyond the base announcement allow-list above.
const BLOG_SANITIZE_OPTIONS: sanitizeHtmlLib.IOptions = {
  ...SANITIZE_OPTIONS,
  allowedTags: [...(Array.isArray(SANITIZE_OPTIONS.allowedTags) ? SANITIZE_OPTIONS.allowedTags : []), 'blockquote', 'img'],
  allowedAttributes: {
    ...SANITIZE_OPTIONS.allowedAttributes,
    img: ['src', 'alt', 'title'],
  },
  allowedSchemesByTag: { img: ['https'] },
};

/** Markdown → sanitized HTML for blog article/page bodies. */
export function sanitizeBlogPostHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtmlLib(html, BLOG_SANITIZE_OPTIONS);
}

export function sanitizeAnnouncementContent(content: string, contentType: string): string {
  if (contentType === 'html') {
    return sanitizeHtml(content);
  }
  if (contentType === 'markdown') {
    // BUG-M06: Convert Markdown → HTML first, THEN sanitize the resulting HTML.
    // sanitize-html operates on HTML tokens; passing raw Markdown let embedded
    // HTML fragments (e.g. <script>) partially survive because they were wrapped
    // in Markdown syntax that the sanitizer misidentified as plain text.
    const html = marked.parse(content, { async: false }) as string;
    // BUG-014 FIX: removed the `href="about:blank"` rewrite. `about:` is not in
    // allowedSchemes so sanitize-html strips those hrefs entirely anyway — the
    // rewrite was dead code that produced `href="about:blank"` in output (a
    // navigable URL) rather than no href at all.  Passing directly to
    // sanitizeHtml achieves the correct result: non-https/mailto hrefs are dropped.
    return sanitizeHtml(html);
  }
  // BUG-SANITIZE-01: unknown content types must never be returned raw — strip all HTML
  return sanitizeHtmlLib(content, { allowedTags: [], allowedAttributes: {} });
}
