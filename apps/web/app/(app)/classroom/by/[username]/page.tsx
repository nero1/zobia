"use client";

/**
 * app/(app)/classroom/by/[username]/page.tsx
 *
 * "Classrooms by @username" — the creator's classroom listing
 * (GET /api/classroom/creators/:username). Visitors see the public, active
 * classrooms the creator opted into the listing; the creator sees all of
 * theirs (hidden/archived flagged) with Boost, Share, listing-visibility
 * toggle and a Manage shortcut on each card.
 */

import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import { BoostContentButton } from "@/components/ads/BoostContentButton";
import { ClassroomCard } from "@/components/classroom/ClassroomCard";
import { ClassroomShareButton } from "@/components/classroom/ClassroomShareButton";
import type { ClassroomCard as ClassroomCardData } from "@/components/classroom/types";

interface ListingData {
  creator: { id: string; username: string; displayName: string; avatarEmoji: string };
  classrooms: ClassroomCardData[];
  isOwner: boolean;
}

export default function CreatorClassroomsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["classroom", "creator-listing", username.toLowerCase()];

  const listing = useQuery({
    queryKey: key,
    queryFn: () => classroomApi<ListingData>(`/creators/${encodeURIComponent(username)}`),
  });

  const toggleListing = useMutation({
    mutationFn: (c: ClassroomCardData) =>
      classroomApi(`/${c.id}`, { method: "PATCH", body: { showInCreatorListing: !c.showInCreatorListing } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  if (listing.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4 sm:p-6">
        <div className="h-8 w-60 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-28 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
      </div>
    );
  }
  if (listing.isError) {
    const err = listing.error as ClassroomApiError;
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {translateApiError(t, err.code, err.message)}
        </p>
      </div>
    );
  }

  const { creator, classrooms, isOwner } = listing.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <Link href="/classroom" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ← {t("classroom.home.back", "All classrooms")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{creator.avatarEmoji}</span>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {isOwner ? t("classroom.listing.mineTitle", "My Classrooms") : t("classroom.listing.title", "Classrooms by {{name}}", { name: creator.displayName })}
            </h1>
            <a href={`/u/${creator.username}`} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
              @{creator.username}
            </a>
          </div>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <Link href="/classroom/studio" className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
              {t("classroom.nav.studio", "Classroom Studio")}
            </Link>
            <Link href="/classroom/new" className="rounded-full bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700">
              {t("classroom.nav.create", "+ New Classroom")}
            </Link>
          </div>
        )}
      </div>
      {isOwner && (
        <p className="text-xs text-neutral-500">
          {t("classroom.listing.ownerHint", "Visitors only see public, active classrooms you've chosen to list here. Use “Hide from listing” to keep a classroom off this page.")}
        </p>
      )}

      {classrooms.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">🏫</span>
          <p className="mt-3 text-sm text-neutral-500">
            {isOwner ? t("classroom.listing.emptyOwner", "You haven't created a classroom yet.") : t("classroom.listing.empty", "No classrooms listed yet.")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {classrooms.map((c) => (
            <ClassroomCard
              key={c.id}
              classroom={c}
              actions={
                <>
                  <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
                  {isOwner && <BoostContentButton contentType="classroom" contentId={c.id} title={c.name} imageUrl={c.coverImageUrl} />}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => toggleListing.mutate(c)}
                      disabled={toggleListing.isPending}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {c.showInCreatorListing ? t("classroom.listing.hide", "Hide from listing") : t("classroom.listing.show", "Show in listing")}
                    </button>
                  )}
                  {isOwner && (
                    <Link
                      href={`/classroom/studio/${c.id}`}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      ⚙️ {t("classroom.home.manage", "Manage")}
                    </Link>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
