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
    '*': ['class'],
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
    // Patch unsafe link targets in the generated HTML (non-http/mailto hrefs)
    const patched = html.replace(/href="(?!(https?:|mailto:))[^"]*"/gi, 'href="about:blank"');
    return sanitizeHtml(patched);
  }
  // BUG-SANITIZE-01: unknown content types must never be returned raw — strip all HTML
  return sanitizeHtmlLib(content, { allowedTags: [], allowedAttributes: {} });
}
