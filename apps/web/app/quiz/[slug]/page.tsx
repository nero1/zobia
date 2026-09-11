/**
 * app/quiz/[slug]/page.tsx
 *
 * Public, SSR, crawlable quiz page at /quiz/<slug>. Mirrors app/poll/[slug]/page.tsx.
 * Always resolves with includeAnswers=false so correct answers never reach
 * an anonymous crawler or a non-owner server-side — the take/grade flow
 * (components/quizzes/QuizTakeCard.tsx) only reveals correctOptionIds once
 * the viewer has actually submitted an attempt.
 *
 * 404s (via notFound()) when the quiz doesn't exist or is disabled.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuizBySlug, recordQuizView, getQuizTreasury } from "@/lib/quizzes/service";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { generateStructuredData } from "@/lib/seo/metadata";
import { formatShortDate } from "@/lib/format/date";
import { Avatar } from "@/components/ui/Avatar";
import { QuizTakeCard } from "@/components/quizzes/QuizTakeCard";
import { QuizShareButton } from "@/components/quizzes/QuizShareButton";
import { FundTreasuryModal } from "@/components/polls/FundTreasuryModal";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;

const NOT_FOUND_METADATA: Metadata = {
  title: "Quiz not found — Zobia Social",
  description: "This quiz doesn't exist or is no longer available.",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const quiz = await getQuizBySlug(slug, null, false).catch(() => null);
  if (!quiz || quiz.status === "disabled") return NOT_FOUND_METADATA;

  const title = `${quiz.title} — Quiz — Zobia Social`;
  const description = quiz.description?.slice(0, 155) ?? `Take "${quiz.title}" — a quiz by @${quiz.creatorUsername ?? "a Zobia Social user"}.`;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: DEFAULT_OG_IMAGE }], type: "website", siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE] },
    alternates: { canonical: `/quiz/${quiz.slug}` },
  };
}

export default async function PublicQuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getOptionalServerUser();
  const quiz = await getQuizBySlug(slug, viewer?.userId ?? null, false).catch(() => null);
  if (!quiz || quiz.status === "disabled") notFound();

  // Fire and forget — never block render on the view counter.
  void recordQuizView(quiz.id);

  const treasury = await getQuizTreasury(quiz.id).catch(() => null);
  const treasuryActive = !!treasury && treasury.status === "active" && treasury.claimantCount < treasury.maxClaimants;

  const pageUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/quiz/${quiz.slug}`;
  const totalPoints = quiz.questions.reduce((sum, q) => sum + q.points, 0);

  const schema = generateStructuredData("Thing", {
    "@type": "Quiz",
    name: quiz.title,
    description: quiz.description ?? undefined,
    url: pageUrl,
    about: quiz.questions.map((q) => q.prompt),
  });

  return (
    <main className="min-h-screen bg-background">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/quizzes" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Quizzes
        </Link>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>📝 Quiz</span>
            {quiz.status === "closed" && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">Closed</span>}
          </div>
          <h1 className="mt-2 text-3xl font-bold text-foreground">{quiz.title}</h1>
          {quiz.description && <p className="mt-2 text-muted-foreground">{quiz.description}</p>}
        </header>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Avatar src={quiz.creatorAvatarUrl} name={quiz.creatorUsername ?? "?"} size="sm" rankTier="none" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">@{quiz.creatorUsername ?? "unknown"}</div>
            <div className="text-xs text-muted-foreground">{formatShortDate(quiz.createdAt)}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>{quiz.questions.length} {quiz.questions.length === 1 ? "question" : "questions"} · {totalPoints} pts</div>
            <div>Pass at {quiz.passingScorePercent}%</div>
          </div>
        </div>

        {treasuryActive && treasury && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            🎁 Powered by a reward pot: {treasury.rewardPerClaimant} credits each for the next {treasury.maxClaimants - treasury.claimantCount} people who PASS!
          </div>
        )}

        <div className="mt-6">
          <QuizTakeCard quiz={quiz} viewerSignedIn={!!viewer} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {quiz.attemptCount} {quiz.attemptCount === 1 ? "attempt" : "attempts"} · 👁 {quiz.viewCount} views
          </div>
          <QuizShareButton slug={quiz.slug} />
        </div>

        {quiz.isOwner && (
          <div className="mt-8 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Owner tools</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Fund a reward pot so the first people who PASS (or share) split it evenly, in credits.
            </p>
            <div className="mt-3">
              <FundTreasuryModal contentType="quiz" slug={quiz.slug} initialTreasury={treasury} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
