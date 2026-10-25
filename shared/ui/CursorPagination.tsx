"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
/** Retain cursor metadata only, with a hard history cap; page bodies belong to
 * the current request/query and are never appended into an unbounded array. */
export function useCursorPage() {
  const [history, setHistory] = useState<(string | null)[]>([null]);
  return {
    cursor: history.at(-1) ?? null,
    next: (cursor: string) =>
      setHistory((prior) => [...prior.slice(-99), cursor]),
    previous: () =>
      setHistory((prior) => (prior.length > 1 ? prior.slice(0, -1) : [null])),
    first: () => setHistory([null]),
  };
}
export function CursorPagination({
  cursor,
  nextCursor,
  disabled,
  onNext,
  onPrevious,
  onFirst,
}: {
  cursor: string | null;
  nextCursor?: string | null;
  disabled?: boolean;
  onNext: (cursor: string) => void;
  onPrevious: () => void;
  onFirst: () => void;
}) {
  const { t } = useTranslation();
  if (!cursor && !nextCursor) return null;
  const style =
    "rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50";
  return (
    <nav
      aria-label={t("common.pagination")}
      className="my-4 flex flex-wrap items-center justify-end gap-2"
    >
      {cursor && (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={onFirst}
            className={style}
          >
            {t("common.firstPage")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onPrevious}
            className={style}
          >
            {t("admin.pagination.prev")}
          </button>
        </>
      )}
      {nextCursor && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onNext(nextCursor)}
          className={style}
        >
          {t("admin.pagination.next")}
        </button>
      )}
    </nav>
  );
}
