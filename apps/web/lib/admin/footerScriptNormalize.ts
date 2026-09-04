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
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function escapeForJsString(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function normalizeFooterScriptContent(rawInput: string): string {
  const raw = rawInput.trim();
  if (!raw) return raw;

  if (!/<script\b/i.test(raw)) {
    // No <script> markup at all — treat as already-plain JS.
    return raw;
  }

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  SCRIPT_TAG_RE.lastIndex = 0;
  while ((match = SCRIPT_TAG_RE.exec(raw)) !== null) {
    const [, attrs, body] = match;
    const srcMatch = SRC_ATTR_RE.exec(attrs ?? "");
    const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "") : "";

    if (src) {
      parts.push(
        `(function(){var s=document.createElement("script");s.src="${escapeForJsString(
          src
        )}";s.async=true;document.head.appendChild(s);})();`
      );
    }

    const inline = body.trim();
    if (inline) parts.push(inline);
  }

  // Fell through without matching a well-formed tag (e.g. an unclosed
  // <script src="…"> with no closing tag) — fall back to the raw input
  // rather than silently discarding what the admin pasted.
  if (parts.length === 0) return raw;

  return parts.join("\n\n");
}
