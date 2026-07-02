/**
 * app/a/[slug]/page.tsx
 *
 * Public, SSR, crawlable Answers question page at /a/<slug>.
 *
 * Only visible (non-removed, non-deleted) questions are servable here;
 * anything else resolves to 404 so gated/removed content is never exposed.
 * The interactive, authenticated experience (voting, answering, threading)
 * lives at /answers/<id> — this page is a lightweight public preview + CTA,
 * matching how /r/<slug> relates to the in-room chat experience.
 *
 * Backward compatibility:
 *   - Legacy /a/<uuid> links 301-redirect to /a/<slug>.
 *   - Retired slugs (after a title edit) 301-redirect via slug_redirects.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts so crawlers are not redirected to
 * login. Listed in the sitemap at the same path.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolvePublicForumQuestion } from "@/lib/public/resolveForumQuestion";
import { buildForumQuestionMetadata, NOT_FOUND_METADATA } from "@/lib/public/forumMetadata";
import { generateQAPageSchema } from "@/lib/seo/metadata";
import { PublicForumQuestionView } from "@/components/public/PublicForumQuestionView";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicForumQuestion(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  return buildForumQuestionMetadata(resolved.question);
}

export default async function PublicForumQuestionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicForumQuestion(slug).catch(() => null);

  if (!resolved) notFound();

  // Legacy UUID / retired slug → permanent redirect to the canonical slug URL.
  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/a/${resolved.canonicalRedirectSlug}`);
  }

  const { question } = resolved;
  const canonicalSlug = question.slug ?? question.id;

  const jsonLd = generateQAPageSchema({
    title: question.title,
    body: question.body,
    url: `${APP_URL}/a/${canonicalSlug}`,
    createdAt: question.created_at,
    authorName: question.author_display_name ?? question.author_username ?? undefined,
    answerCount: question.answer_count,
    voteScore: question.vote_score,
    answers: question.top_answers.map((a) => ({
      body: a.body,
      createdAt: a.created_at,
      authorName: a.author_display_name ?? a.author_username ?? undefined,
      voteScore: a.vote_score,
      isBest: a.is_best_answer,
    })),
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <PublicForumQuestionView question={question} />
    </>
  );
}
