"use client";

/**
 * components/ui/Link.tsx
 *
 * Drop-in replacement for `next/link` that prefetches on intent (hover,
 * touch, keyboard focus) instead of when the link scrolls into view.
 *
 * Why: in production Next.js prefetches every <Link> that enters the
 * viewport, and each prefetch is a server render billed as Vercel Active
 * CPU. The nav alone holds ~20 links, so every page view rendered ~20 routes
 * nobody opened (Observability showed /ads, /business, /wallet, /quizzes...
 * each hit ~21 times in 12 hours by a single tester who never visited them),
 * and feed cards did the same for every tweet/profile on screen.
 * Intent prefetching keeps navigation fast (the prefetch starts 100-300 ms
 * before the click) while only paying for links the user is about to open.
 *
 * Pass `prefetch` explicitly to opt back into Next's own behaviour for a
 * specific link (e.g. the single primary call-to-action on a page).
 *
 * Every app file imports `Link` from here; a unit test
 * (lib/__tests__/linkImports.test.ts) fails if `next/link` is imported
 * directly anywhere else.
 */

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useRef, type ComponentProps } from "react";
import { prefetchTarget } from "@/lib/navigation/prefetchTarget";

type LinkProps = ComponentProps<typeof NextLink>;

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { prefetch, onMouseEnter, onTouchStart, onFocus, href, ...rest },
  ref
) {
  const router = useRouter();
  const done = useRef(false);

  const prefetchOnIntent = useCallback(() => {
    if (done.current) return;
    const target = prefetchTarget(href);
    if (!target) return;
    done.current = true;
    try {
      router.prefetch(target);
    } catch {
      // Prefetch is an optimisation only; navigation still works without it.
    }
  }, [href, router]);

  if (prefetch !== undefined) {
    return (
      <NextLink
        ref={ref}
        href={href}
        prefetch={prefetch}
        onMouseEnter={onMouseEnter}
        onTouchStart={onTouchStart}
        onFocus={onFocus}
        {...rest}
      />
    );
  }

  return (
    <NextLink
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        prefetchOnIntent();
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        prefetchOnIntent();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        prefetchOnIntent();
      }}
      {...rest}
    />
  );
});

export default Link;
