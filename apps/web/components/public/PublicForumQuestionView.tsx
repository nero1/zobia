/**
 * components/public/PublicForumQuestionView.tsx
 *
 * Presentational, server-rendered view for a public Zobia Answers question,
 * shown at the crawlable /a/<slug> page. Mirrors components/public/PublicRoomView.tsx's
 * markup/CTA pattern so all public SEO surfaces feel consistent.
 */

import type { PublicForumQuestion } from "@/lib/public/resolveForumQuestion";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function PublicForumQuestionView({ question }: { question: PublicForumQuestion }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {question.category_name && (
          <a
            href={`/answers?category=${encodeURIComponent(question.category_slug ?? "")}`}
            className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
          >
            {question.category_name}
          </a>
        )}

        <h1 className="mb-2 text-3xl font-bold">{question.title}</h1>

        <p className="mb-6 text-sm text-muted-foreground">
          {question.author_display_name ?? question.author_username ?? "A Zobia user"} · {timeAgo(question.created_at)} ·{" "}
          {question.vote_score} votes · {question.answer_count} {question.answer_count === 1 ? "answer" : "answers"}
        </p>

        <p className="mb-8 whitespace-pre-wrap text-muted-foreground">{question.body}</p>

        {question.top_answers.length > 0 && (
          <div className="mb-10 space-y-4">
            <h2 className="text-lg font-semibold">Top answers</h2>
            {question.top_answers.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                {a.is_best_answer && (
                  <span className="mb-2 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                    ✓ Best answer
                  </span>
                )}
                <p className="whitespace-pre-wrap text-sm text-foreground">{a.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {a.author_display_name ?? a.author_username ?? "A Zobia user"} · {a.vote_score} votes
                </p>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="text-center">
          <a
            href="/auth/login"
            className="inline-block rounded-lg bg-primary px-6 py-2 font-medium text-primary-foreground transition hover:opacity-90"
          >
            Join Zobia Social to answer or vote
          </a>
        </div>
      </div>
    </main>
  );
}
