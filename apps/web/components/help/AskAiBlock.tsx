"use client";

/**
 * components/help/AskAiBlock.tsx
 *
 * "Ask AI" block at the bottom of every Help Center doc page (Feature 2 §5-6).
 *
 * State machine:
 *  - Logged out: no AI call at all (client AND server gated) — shows a
 *    "log in or sign up" prompt.
 *  - Logged in, no answer yet: free-text question box.
 *  - After an answer: "Contact a real person" branches by ticket eligibility
 *    (free / costs credits-or-stars / blocked), or is unconditionally free
 *    when the admin has set the Help Center AI fallback free-for-all.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface Eligibility {
  freeAccess: boolean;
  costCredits: number;
  costStars: number;
  blocked: boolean;
  helpCenterFree: boolean;
  supportTicketsEnabled: boolean;
}

export function AskAiBlock({ docId, docTitle }: { docId: string; docTitle: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => setLoggedIn(r.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/support/eligibility", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setEligibility(json?.data ?? null))
      .catch(() => {});
  }, [loggedIn]);

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/help/ask-ai", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, docId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("help.askAi.unavailable", "The AI assistant is unavailable right now."));
      setAnswer(json.data.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("help.askAi.genericError", "Something went wrong."));
    } finally {
      setAsking(false);
    }
  }

  function contactHuman() {
    const params = new URLSearchParams({
      prefillSubject: `Re: ${docTitle}`,
      prefillBody: `My question: ${question}\n\nAI answer: ${answer ?? ""}\n\n(Please help further with this.)`,
      docId,
    });
    router.push(`/support/new?${params.toString()}`);
  }

  if (loggedIn === false) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-5 text-center">
        <p className="mb-3 text-sm text-muted-foreground">{t("help.askAi.loggedOutPrompt", "Can't find what you're looking for? Log in or sign up to ask the AI assistant or contact a support staff member.")}</p>
        <div className="flex justify-center gap-3">
          <a href="/auth/login" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{t("auth.login", "Log in")}</a>
          <a href="/auth/login?signup=1" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">{t("auth.signUp", "Sign up")}</a>
        </div>
      </div>
    );
  }

  if (loggedIn === null) {
    return <div className="h-24 animate-pulse rounded-xl bg-muted/30" />;
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5">
      <p className="mb-1 text-sm font-semibold">{t("help.askAi.title", "Ask AI")}</p>
      <p className="mb-3 text-xs text-muted-foreground">{t("help.askAi.subtext", "Can't find what you're looking for? Try asking the AI.")}</p>

      {!answer ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("help.askAi.placeholder", "Ask a question about this topic…")}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button onClick={ask} disabled={asking || !question.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {asking ? t("help.askAi.asking", "Asking…") : t("help.askAi.ask", "Ask")}
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-3 rounded-lg bg-background p-3 text-sm">{answer}</div>
          {eligibility?.supportTicketsEnabled !== false && (
            <div>
              {eligibility && !eligibility.freeAccess && !eligibility.helpCenterFree && !eligibility.blocked && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("help.askAi.costNotice", "Contacting a person costs {{amount}}. Response time is usually 24-48 hours.", {
                    amount: [
                      eligibility.costCredits > 0 ? `${eligibility.costCredits} credits` : null,
                      eligibility.costStars > 0 ? `${eligibility.costStars} stars` : null,
                    ].filter(Boolean).join(" or "),
                  })}
                </p>
              )}
              {(!eligibility || eligibility.freeAccess || eligibility.helpCenterFree) && (
                <p className="mb-2 text-xs text-muted-foreground">{t("help.askAi.responseTime", "Response time is usually 24-48 hours or less.")}</p>
              )}
              {(!eligibility?.blocked || eligibility.helpCenterFree) && (
                <button onClick={contactHuman} className="rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10">
                  {t("help.askAi.contactHuman", "Contact a real person")}
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <button onClick={() => { setAnswer(null); setQuestion(""); }} className="ml-2 mt-2 text-xs text-muted-foreground underline">{t("help.askAi.askAnother", "Ask another question")}</button>
        </div>
      )}
      {error && !answer && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
