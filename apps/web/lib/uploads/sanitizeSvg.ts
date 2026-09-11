/**
 * lib/uploads/sanitizeSvg.ts
 *
 * User-uploaded SVG is XML, so it can carry the same attack surface as raw
 * HTML — `<script>`, `on*` event handlers, `javascript:` URIs, external
 * `<foreignObject>`/`<use href>` references, etc. sharp/raster compression
 * doesn't run on SVGs (see isSvg() in imageValidation.ts), so this is the
 * only sanitization pass an uploaded SVG gets before being stored and served
 * back to other users. Reuses the same `sanitize-html` dependency already
 * used for user HTML content (lib/security/htmlSanitizer.ts), configured
 * with an SVG-appropriate allow-list instead of the prose allow-list.
 */

import sanitizeHtmlLib from "sanitize-html";

const SVG_ALLOWED_TAGS = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
  "polygon", "defs", "clipPath", "linearGradient", "radialGradient", "stop",
  "title", "desc", "text", "tspan",
];

const SVG_ALLOWED_ATTRS = [
  "id", "class", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "points", "d", "transform", "fill", "fill-opacity",
  "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "opacity", "offset", "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform", "clip-path", "xmlns", "preserveAspectRatio",
  "font-size", "font-family", "text-anchor",
];

/**
 * Strip any tag/attribute not on the SVG-safe allow-list — in particular
 * `<script>`, `<foreignObject>`, `<use>` (can reference external/remote
 * content), `on*` handlers, and non-data/https URLs in `href`/`xlink:href`.
 */
export function sanitizeSvg(svgText: string): string {
  return sanitizeHtmlLib(svgText, {
    allowedTags: SVG_ALLOWED_TAGS,
    allowedAttributes: { "*": SVG_ALLOWED_ATTRS },
    allowedSchemes: ["data"],
    disallowedTagsMode: "discard",
    // Belt-and-braces: sanitize-html already drops event-handler attributes
    // by name convention, but explicitly enforce it since `*` above is broad.
    exclusiveFilter: (frame) =>
      Object.keys(frame.attribs).some((attr) => attr.toLowerCase().startsWith("on")),
  });
}
