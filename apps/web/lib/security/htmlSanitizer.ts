/**
 * lib/security/htmlSanitizer.ts
 *
 * Server-side HTML sanitizer using sanitize-html with a strict allow-list.
 */
import sanitizeHtmlLib from 'sanitize-html';

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
    return content.replace(/\]\((?!(https?:|mailto:))[^)]*\)/gi, '](about:blank)');
  }
  return content;
}
