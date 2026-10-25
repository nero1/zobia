"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibleDialog } from "./Dialog";
import type { TalesTransport } from "./Tales";
interface Application {
  id: string;
  creatorUsername: string;
  proof: string | null;
  completedAt: string | null;
}
interface Page {
  items: Application[];
  nextCursor: string | null;
}
export function SponsoredApplications({
  questId,
  transport,
  onClose,
  onChanged,
}: {
  questId: string;
  transport: Pick<TalesTransport, "request">;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation(),
    alive = useRef(false),
    sequence = useRef(0);
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null }),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(next: string | null) {
    const turn = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await transport.request<Page>(
        `/admin/sponsored-quests/${questId}/applications${next ? "?cursor=" + encodeURIComponent(next) : ""}`,
      );
      if (alive.current && turn === sequence.current) {
        setPage(result);
        setCursor(next);
      }
    } catch (error) {
      if (alive.current && turn === sequence.current)
        setError(error instanceof Error ? error.message : t("common.error"));
    } finally {
      if (alive.current && turn === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load(null);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [questId, transport]);
  async function decide(id: string, action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      await transport.request(
        `/creator/sponsored-quests/${questId}/approve`,
        "POST",
        { applicationId: id, action },
      );
      if (alive.current) {
        onChanged();
        await load(cursor);
      }
    } catch (error) {
      if (alive.current) {
        setError(error instanceof Error ? error.message : t("common.error"));
        setBusy(false);
      }
    }
  }
  return (
    <AccessibleDialog
      onClose={onClose}
      aria-labelledby="sponsored-review-title"
      className="bg-black/50 p-4"
    >
      <section className="mx-auto my-8 w-full max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="sponsored-review-title" className="text-lg font-semibold">
            {t("sponsoredFunding.applications")}
          </h2>
          <button
            type="button"
            data-dialog-initial-focus
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1 text-sm"
          >
            {t("common.close")}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-600">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="mt-3 text-sm">
            {t("common.loading")}
          </p>
        )}
        {!busy && !page.items.length && (
          <p className="mt-4 text-sm">{t("sponsoredFunding.noApplications")}</p>
        )}
        <ul className="mt-4 space-y-4">
          {page.items.map((item) => (
            <li key={item.id} className="rounded-xl border border-border p-4">
              <h3 className="font-semibold break-words">
                @{item.creatorUsername}
              </h3>
              <p className="mt-2 text-xs font-medium">
                {t("sponsoredFunding.proof")}
              </p>
              <p className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">
                {item.proof ?? "—"}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item.id, "approve")}
                  className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t("admin.sponsoredQuests.approve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item.id, "reject")}
                  className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("admin.sponsoredQuests.reject")}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between gap-3">
          {cursor && (
            <button
              disabled={busy}
              onClick={() => void load(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              {t("common.back")}
            </button>
          )}
          {page.nextCursor && (
            <button
              disabled={busy}
              onClick={() => void load(page.nextCursor)}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              {t("action.next")}
            </button>
          )}
        </div>
      </section>
    </AccessibleDialog>
  );
}
