/**
 * lib/navigation/prefetchTarget.ts
 *
 * Resolves a Link `href` to the path components/ui/Link.tsx passes to
 * router.prefetch on intent (hover/touch/focus).
 */

type Href =
  | string
  | {
      pathname?: string | null;
      query?: string | Record<string, unknown> | null;
    };

/** Internal, same-app path for router.prefetch, or null for external/hash-only links. */
export function prefetchTarget(href: Href): string | null {
  let path: string;
  if (typeof href === "string") {
    path = href;
  } else {
    const query =
      href.query && typeof href.query === "object"
        ? new URLSearchParams(
            Object.entries(href.query).flatMap(([k, v]) =>
              v === undefined || v === null ? [] : Array.isArray(v) ? v.map((x) => [k, String(x)]) : [[k, String(v)]]
            )
          ).toString()
        : typeof href.query === "string"
          ? href.query
          : "";
    path = `${href.pathname ?? ""}${query ? `?${query}` : ""}`;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}
