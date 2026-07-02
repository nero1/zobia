/**
 * apps/web/lib/public/forumMetadata.ts
 *
 * Open Graph / Twitter metadata builder for the public forum question page
 * (/a/<slug>), mirroring lib/public/roomMetadata.ts's pattern for rooms/courses.
 */

import type { Metadata } from "next";
import type { PublicForumQuestion } from "@/lib/public/resolveForumQuestion";

export { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";

export function buildForumQuestionMetadata(question: PublicForumQuestion): Metadata {
  const canonicalSlug = question.slug ?? question.id;

  const title = `${question.title} — Answers`;
  const description = question.body.slice(0, 155);

  return {
    title,
    description,
    keywords: [
      "Answers",
      "Q&A",
      ...(question.category_name ? [question.category_name] : []),
    ],
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: {
      canonical: `/a/${canonicalSlug}`,
    },
    other: { "zobia:surface": "forum_question" },
  };
}
