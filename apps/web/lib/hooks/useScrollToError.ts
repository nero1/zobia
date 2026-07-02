"use client";

import { useEffect, useRef } from "react";

/**
 * lib/hooks/useScrollToError.ts
 *
 * Scrolls a ref'd element into view the moment an error becomes truthy.
 *
 * Fixes a recurring UX bug across the app: a form submit / button click fails,
 * an error message renders somewhere on the page, but the page doesn't move —
 * so on a long page (or a page scrolled down) the user never sees it and the
 * page just appears to "do nothing." Reuse this instead of adding a bespoke
 * scrollIntoView effect per page.
 *
 * @example
 * const [error, setError] = useState<string | null>(null);
 * const errorRef = useScrollToError(error);
 * return error ? <div ref={errorRef} role="alert">{error}</div> : null;
 */
// When several fields on the same form fail validation in the same render
// pass (e.g. submitting a form with 3 empty required inputs), each mounted
// <Input>/<ErrorAlert> fires its own scroll effect. Effects run in mount
// order (top-to-bottom for a typical form), so without this guard the LAST
// field's scrollIntoView call would win and the viewport would land on the
// last error instead of the first one a user should fix first. This
// module-level timestamp makes only the first scroll in a short batch win;
// later calls within the window are skipped.
let lastScrollAt = 0;
const SCROLL_BATCH_WINDOW_MS = 150;

export function useScrollToError<T extends HTMLElement = HTMLDivElement>(
  error: string | null | undefined
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const hadErrorRef = useRef(false);

  useEffect(() => {
    const hasError = Boolean(error);
    // Only scroll on the transition from no-error -> error, so re-renders
    // while the same error is displayed don't repeatedly yank the viewport.
    if (hasError && !hadErrorRef.current && ref.current) {
      const now = Date.now();
      if (now - lastScrollAt > SCROLL_BATCH_WINDOW_MS) {
        lastScrollAt = now;
        ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    hadErrorRef.current = hasError;
  }, [error]);

  return ref;
}
