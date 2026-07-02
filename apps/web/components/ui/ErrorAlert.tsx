"use client";

/**
 * components/ui/ErrorAlert.tsx
 *
 * Shared page/form-level error banner. Renders nothing when `error` is falsy.
 * Automatically scrolls itself into view the moment the error first appears,
 * so a failed submit/button click on a long page doesn't silently do nothing
 * while the error sits above or below the fold.
 *
 * For per-field input errors, use the `error` prop on <Input> instead (it has
 * the same auto-scroll behaviour built in).
 *
 * @example
 * <ErrorAlert error={error} />
 */

import { useScrollToError } from "@/lib/hooks/useScrollToError";

export interface ErrorAlertProps {
  error: string | null | undefined;
  className?: string;
}

export function ErrorAlert({ error, className }: ErrorAlertProps) {
  const ref = useScrollToError<HTMLDivElement>(error);

  if (!error) return null;

  return (
    <div
      ref={ref}
      role="alert"
      className={
        className ??
        "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      }
    >
      {error}
    </div>
  );
}
