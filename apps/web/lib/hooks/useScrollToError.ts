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
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    hadErrorRef.current = hasError;
  }, [error]);

  return ref;
}
