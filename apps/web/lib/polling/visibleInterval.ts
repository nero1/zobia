/**
 * lib/polling/visibleInterval.ts
 *
 * setInterval that only fires while the tab is visible. Hidden tabs make no
 * requests (every request is billed Vercel Active CPU); when the tab becomes
 * visible again after at least one full period, `fn` runs immediately so the
 * page catches up without waiting for the next tick.
 *
 * Returns a cleanup function (use it as the effect's return value).
 */
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  if (typeof document === "undefined") {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }

  let lastRun = Date.now();
  const run = () => {
    lastRun = Date.now();
    fn();
  };
  const id = setInterval(() => {
    if (document.visibilityState === "visible") run();
  }, ms);
  const onVisibility = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRun >= ms) run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
