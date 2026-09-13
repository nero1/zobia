/**
 * lib/admin/footerScriptNormalize.ts
 *
 * Footer scripts are served as an external JS file
 * (/api/static/footer-script/[id], Content-Type: application/javascript) and
 * loaded via a nonce'd <script src> tag — see app/layout.tsx. That means the
 * stored `content` must already be plain, executable JavaScript.
 *
 * Most analytics/embed providers (Google Analytics, GTM, Meta Pixel,
 * Intercom, etc.) hand admins a snippet wrapped in one or more literal
 * <script> tags — some with a `src` attribute, some inline. Pasting that
 * verbatim into the admin form previously produced invalid JS (a leading
 * `<script>` token is a syntax error), so the script silently did nothing.
 *
 * This normalizes whatever an admin pastes — raw JS, a single <script> tag,
 * or a multi-tag snippet mixing inline and `src` tags — into one flat JS
 * body safe to serve as-is. A `<script src="URL">` becomes a dynamically
 * inserted script element (document.createElement + appendChild), which is
 * itself a browser-trusted operation under the page's
 * `'strict-dynamic'` CSP script-src, so it still executes even though the
 * URL isn't in any allowlist.
 */

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/** Matches a <script src="…"> with no closing tag (or a self-closing one). */
const LONE_SCRIPT_TAG_RE = /<script\b([^>]*\bsrc\s*=[^>]*)\/?>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const NOSCRIPT_TAG_RE = /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** JS that loads `src` as a script element (trusted under 'strict-dynamic'). */
function loaderFor(src: string): string {
  return `(function(){var s=document.createElement("script");s.src="${escapeForJsString(
    src
  )}";s.async=true;document.head.appendChild(s);})();`;
}

function escapeForJsString(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function normalizeFooterScriptContent(rawInput: string): string {
  const raw = rawInput.trim();
  if (!raw) return raw;

  if (!/[<]/.test(raw)) {
    // No markup at all — already-plain JS. (Checked on `<` rather than
    // `<script` so an HTML-comment-only or <noscript>-only snippet still
    // takes the stripping path below instead of being served as-is.)
    return raw;
  }

  // Strip wrappers that are pure markup and can never be valid JS. Analytics
  // snippets routinely ship with an HTML comment header and a <noscript>
  // pixel alongside the real <script>.
  const stripped = raw.replace(HTML_COMMENT_RE, "").replace(NOSCRIPT_TAG_RE, "").trim();

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  SCRIPT_TAG_RE.lastIndex = 0;
  while ((match = SCRIPT_TAG_RE.exec(stripped)) !== null) {
    const [, attrs, body] = match;
    const srcMatch = SRC_ATTR_RE.exec(attrs ?? "");
    const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "") : "";

    if (src) parts.push(loaderFor(src));

    const inline = body.trim();
    if (inline) parts.push(inline);
  }

  // No well-formed <script>…</script> pair matched. Recover the common
  // unclosed/self-closing `<script src="…">` form rather than emitting markup.
  if (parts.length === 0) {
    LONE_SCRIPT_TAG_RE.lastIndex = 0;
    while ((match = LONE_SCRIPT_TAG_RE.exec(stripped)) !== null) {
      const srcMatch = SRC_ATTR_RE.exec(match[1] ?? "");
      const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "") : "";
      if (src) parts.push(loaderFor(src));
    }
  }

  if (parts.length > 0) return parts.join("\n\n");

  // Still nothing usable. Returning the raw markup here would serve a response
  // starting with "<" under Content-Type: application/javascript, which throws
  // "SyntaxError: expected expression, got '<'" in every visitor's console.
  // Emit a no-op instead — the admin's snippet is recoverable from the DB and
  // editable at /gate44/footer-scripts.
  return "";
}
