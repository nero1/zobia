"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
export interface TalesTransport {
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  navigate: (path: string) => void;
  userId?: string | null;
  upload?: (file: File) => Promise<string>;
}
interface Story {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  coverUrl: string | null;
  authorId: string;
  status: string;
  moderation: string;
  moderationReason?: string | null;
  version: number;
  defaultPrice: number;
  commentsEnabled: boolean;
  notifySubscribers: boolean;
  votes: number;
}
interface Chapter {
  id: string;
  ordinal: number;
  title: string;
  body?: string | null;
  price: number | null;
  status: string;
  moderation: string;
  moderationReason?: string | null;
  version: number;
  publishAt: string | null;
}
interface StoryData {
  story: Story;
  chapters: Chapter[];
  isOwner: boolean;
}
interface ChapterData {
  nextOrdinal?: number | null;
  chapter: Chapter;
  story: Pick<Story, "id" | "slug" | "title" | "authorId" | "commentsEnabled">;
  price: number;
  locked: boolean;
  loginRequired: boolean;
  isOwner: boolean;
}
const panel =
  "rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4";
const field =
  "block w-full rounded-lg border border-neutral-300 bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 p-3 my-2";
const pill =
  "inline-block rounded-full border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50";
function useLoad<T>(api: TalesTransport, path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    api
      .request<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api.request, path, refresh, api.userId]);
  return { data, error, reload: () => setRefresh((n) => n + 1) };
}
function Go({
  api,
  to,
  children,
  className = pill,
}: {
  api: TalesTransport;
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          api.navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
function Message({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="my-3 text-red-600">
      {error}
    </p>
  ) : null;
}
function Login({ api, path }: { api: TalesTransport; path: string }) {
  const { t } = useTranslation();
  return (
    <div className={panel}>
      <p>
        {t(
          "tales.loginPrompt",
          "Sign in or create an account to continue reading. Your place will be saved.",
        )}
      </p>
      <Go api={api} to={`/auth/login?redirect=${encodeURIComponent(path)}`}>
        {t("tales.signIn", "Sign in or sign up")}
      </Go>
    </div>
  );
}
export function TalesDiscovery({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("new");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [items, setItems] = useState<Story[]>([]);
  const [pageKey, setPageKey] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const key = `${tab}:${search}`;
  const actualCursor = key === pageKey ? cursor : undefined;
  const params = new URLSearchParams({ tab, q: search });
  if (actualCursor) params.set("cursor", actualCursor);
  const result = useLoad<{ tales: Story[]; nextCursor: string | null }>(
    api,
    `/tales?${params}`,
  );
  useEffect(() => {
    if (result.data) {
      setItems((old) =>
        actualCursor
          ? [...old, ...result.data!.tales].filter(
              (v, i, all) => all.findIndex((x) => x.id === v.id) === i,
            )
          : result.data!.tales,
      );
      setPageKey(key);
    }
  }, [result.data, actualCursor, key]);
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4 text-neutral-900 dark:text-neutral-100">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("tales.title", "Tales")}</h1>
        <Go api={api} to="/t/write">
          {t("tales.write", "Write a story")}
        </Go>
      </header>
      {api.userId && <TalesAccountStatus api={api} />}
      <input
        type="search"
        className={field}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("tales.search", "Search stories")}
      />
      <div className="flex gap-2 overflow-x-auto">
        {["new", "popular", "trending", "random", "subscribed", "mine"].map(
          (item) => (
            <button
              type="button"
              key={item}
              className={pill}
              aria-pressed={tab === item}
              onClick={() => {
                setTab(item);
                setCursor(undefined);
                setItems([]);
              }}
            >
              {t(
                `tales.tabs.${item}`,
                item.charAt(0).toUpperCase() + item.slice(1),
              )}
            </button>
          ),
        )}
      </div>
      <Message error={result.error} />
      {result.error && (
        <button className={pill} onClick={result.reload}>
          {t("action.retry", "Retry")}
        </button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((story) => (
          <Go
            api={api}
            key={story.id}
            to={`/t/${story.slug}`}
            className={`${panel} flex gap-3`}
          >
            {story.coverUrl ? (
              <img
                alt=""
                src={story.coverUrl}
                className="w-20 h-28 object-cover rounded-lg"
              />
            ) : (
              <span
                aria-hidden
                className="w-20 h-28 flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 text-4xl rounded-lg"
              >
                📚
              </span>
            )}
            <div>
              <h2 className="text-xl font-bold">{story.title}</h2>
              <p className="text-sm line-clamp-3">{story.synopsis}</p>
              <p className="text-xs mt-2">
                {t("tales.votes", "{{count}} votes", { count: story.votes })}
                {tab === "mine"
                  ? ` · ${story.status} · ${story.moderation}`
                  : ""}
              </p>
            </div>
          </Go>
        ))}
      </div>
      {!result.data && !result.error ? (
        <p role="status">{t("action.loading", "Loading…")}</p>
      ) : !items.length && !result.error ? (
        <p>{t("tales.empty", "No stories found.")}</p>
      ) : null}
      {result.data?.nextCursor && (
        <button
          className={pill}
          onClick={() => setCursor(result.data!.nextCursor!)}
        >
          {t("tales.more", "Load more")}
        </button>
      )}
    </div>
  );
}
export function TalesStory({
  api,
  slug,
}: {
  api: TalesTransport;
  slug: string;
}) {
  const { t } = useTranslation();
  const result = useLoad<StoryData>(api, `/tales/${slug}`);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api.request(`/tales/${slug}/social`, "POST", body);
      setNotice(t("tales.saved", "Saved."));
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!result.data)
    return (
      <div className="p-4">
        <Message error={result.error} />
        {!result.error && t("action.loading", "Loading…")}
      </div>
    );
  const { story, chapters, isOwner } = result.data;
  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4 text-neutral-900 dark:text-neutral-100">
      <Go api={api} to="/t">
        {t("tales.title", "Tales")}
      </Go>
      <section className={panel}>
        {story.coverUrl && (
          <img
            src={story.coverUrl}
            alt=""
            className="w-32 h-44 object-cover rounded-lg mb-3"
          />
        )}
        <h1 className="text-3xl font-bold">{story.title}</h1>
        <p className="whitespace-pre-wrap my-3">{story.synopsis}</p>
        <p>{t("tales.votes", "{{count}} votes", { count: story.votes })}</p>
        {isOwner && (
          <>
            <Go api={api} to={`/t/${slug}/manage`}>
              {t("tales.manage", "Manage story")}
            </Go>
            <p>
              {story.status} · {story.moderation}
            </p>
            {story.moderationReason && <p>{story.moderationReason}</p>}
          </>
        )}
        {api.userId && !isOwner && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void action({ action: "subscribe", enabled: true })
              }
            >
              {t("tales.subscribe", "Subscribe to author")}
            </button>
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void action({ action: "subscribe", enabled: false })
              }
            >
              {t("tales.unsubscribe", "Unsubscribe")}
            </button>
            <button
              className={pill}
              disabled={busy}
              onClick={() => void action({ action: "vote", enabled: true })}
            >
              {t("tales.vote", "Vote")}
            </button>
            <button
              className={pill}
              disabled={busy}
              onClick={() => void action({ action: "vote", enabled: false })}
            >
              {t("tales.unvote", "Remove vote")}
            </button>
            <button
              className={pill}
              onClick={() => {
                const reason = window.prompt(
                  t(
                    "tales.reportReason",
                    "Describe why you are reporting this story.",
                  ),
                );
                if (reason)
                  void api
                    .request("/reports", "POST", {
                      reportedTaleId: story.id,
                      reportedUserId: story.authorId,
                      reportType: "other",
                      description: reason,
                    })
                    .then(() =>
                      setNotice(t("tales.reported", "Report submitted.")),
                    )
                    .catch((e) => setError(e.message));
              }}
            >
              {t("tales.report", "Report story")}
            </button>
          </div>
        )}
        <Message error={error} />
        {notice && <p role="status">{notice}</p>}
      </section>
      <ShareTale api={api} slug={slug} />
      <h2 className="text-xl font-bold">{t("tales.chapters", "Chapters")}</h2>
      <ol className="space-y-2">
        {chapters.map((c) => (
          <li key={c.id}>
            <Go
              api={api}
              to={`/t/${slug}/${c.ordinal}`}
              className={`${panel} block`}
            >
              {c.ordinal}. {c.title}{" "}
              <span className="text-xs">
                {c.price
                  ? t("tales.price", "{{cost}} credits", { cost: c.price })
                  : t("tales.free", "Free")}
                {isOwner ? ` · ${c.status} · ${c.moderation}` : ""}
              </span>
            </Go>
          </li>
        ))}
      </ol>
      <TalesComments
        api={api}
        slug={slug}
        enabled={story.commentsEnabled}
        owner={isOwner}
      />
    </div>
  );
}
export function TalesChapter({
  api,
  slug,
  ordinal,
}: {
  api: TalesTransport;
  slug: string;
  ordinal: number;
}) {
  const { t } = useTranslation();
  const result = useLoad<ChapterData>(
    api,
    `/tales/${slug}/chapters/${ordinal}`,
  );
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [continueLogin, setContinueLogin] = useState(false);
  async function unlock() {
    if (!result.data) return;
    setBusy(true);
    setError("");
    try {
      await api.request(`/tales/${slug}/chapters/${ordinal}`, "POST", {
        confirmedCost: result.data.price,
      });
      setConfirm(false);
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!result.data)
    return (
      <div className="p-4">
        <Message error={result.error} />
        {!result.error && t("action.loading", "Loading…")}
      </div>
    );
  const { chapter, story, price, locked, loginRequired, isOwner } = result.data;
  return (
    <article className="mx-auto max-w-3xl p-4 space-y-4 text-neutral-900 dark:text-neutral-100">
      <Go api={api} to={`/t/${slug}`}>
        {story.title}
      </Go>
      <h1 className="text-2xl font-bold">
        {ordinal}. {chapter.title}
      </h1>
      {isOwner && (
        <Go api={api} to={`/t/${slug}/manage`}>
          {t("tales.manage", "Manage story")}
        </Go>
      )}
      {locked ? (
        loginRequired ? (
          <Login api={api} path={`/t/${slug}/${ordinal}`} />
        ) : (
          <section className={panel}>
            <p>
              {t(
                "tales.unlockPrice",
                "Unlock this chapter for {{cost}} credits.",
                { cost: price },
              )}
            </p>
            <TalesWalletBalance api={api} />
            <p className="my-2">
              {t(
                "tales.welcomeCredits",
                "Your welcome credits can be used here. Check your wallet balance before confirming.",
              )}
            </p>
            <Go api={api} to="/wallet">
              {t("tales.wallet", "Wallet")}
            </Go>{" "}
            <button
              className={pill}
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {t("tales.unlock", "Unlock chapter")}
            </button>
            {confirm && (
              <div
                role="dialog"
                aria-label={t("tales.confirmTitle", "Confirm chapter purchase")}
              >
                <p className="my-3">
                  {t(
                    "tales.confirmPrice",
                    "Deduct {{cost}} credits from your wallet?",
                    { cost: price },
                  )}
                </p>
                <button
                  className={pill}
                  disabled={busy}
                  onClick={() => void unlock()}
                >
                  {t("action.confirm", "Confirm")}
                </button>{" "}
                <button
                  className={pill}
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  {t("action.cancel", "Cancel")}
                </button>
              </div>
            )}
            <Message error={error} />
            {error && (
              <p>
                <Go api={api} to="/wallet">
                  {t("tales.buyCredits", "Buy credits")}
                </Go>{" "}
                <Go api={api} to="/gifts">
                  {t("tales.gifts", "Receive a gift")}
                </Go>{" "}
                <Go api={api} to="/quests">
                  {t("tales.quests", "Earn credits")}
                </Go>
              </p>
            )}
          </section>
        )
      ) : (
        <>
          <div className="whitespace-pre-wrap text-lg leading-relaxed">
            {chapter.body}
          </div>
          <button
            className={pill}
            disabled={!result.data.nextOrdinal}
            onClick={() => {
              if (api.userId)
                api.navigate(`/t/${slug}/${result.data!.nextOrdinal}`);
              else setContinueLogin(true);
            }}
          >
            {t("tales.continue", "Continue to next part")}
          </button>
          {continueLogin && (
            <div
              role="dialog"
              aria-label={t("tales.continue", "Continue to next part")}
            >
              <Login api={api} path={`/t/${slug}/${result.data.nextOrdinal}`} />
              <button className={pill} onClick={() => setContinueLogin(false)}>
                {t("action.close", "Close")}
              </button>
            </div>
          )}
          <ShareTale api={api} slug={slug} chapterId={chapter.id} />
          <TalesComments
            api={api}
            slug={slug}
            chapterId={chapter.id}
            enabled={story.commentsEnabled}
            owner={isOwner}
          />
        </>
      )}
    </article>
  );
}
function TalesComments({
  api,
  slug,
  chapterId,
  enabled,
  owner,
}: {
  api: TalesTransport;
  slug: string;
  chapterId?: string;
  enabled: boolean;
  owner: boolean;
}) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<
    { id: string; body: string; hidden: boolean; chapterId: string | null }[]
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(next?: string | null) {
    try {
      const data = await api.request<{
        comments: typeof comments;
        nextCursor: string | null;
      }>(
        `/tales/${slug}/social${next ? "?cursor=" + encodeURIComponent(next) : ""}`,
      );
      setComments((old) => (next ? [...old, ...data.comments] : data.comments));
      setCursor(data.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (api.userId && (enabled || owner)) void load();
  }, [api.userId, slug, enabled, owner]);
  async function post() {
    setBusy(true);
    try {
      await api.request(`/tales/${slug}/social`, "POST", {
        action: "comment",
        body: text,
        chapterId,
      });
      setText("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled && !owner) return null;
  return (
    <section className={`${panel} space-y-3`}>
      <h2 className="text-xl font-bold">{t("tales.comments", "Comments")}</h2>
      <Message error={error} />
      {api.userId && enabled ? (
        <>
          <textarea
            className={field}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("tales.addComment", "Write a comment")}
          />
          <button
            className={pill}
            disabled={busy || !text.trim()}
            onClick={() => void post()}
          >
            {t("tales.postComment", "Post comment")}
          </button>
        </>
      ) : (
        !api.userId && <Login api={api} path={`/t/${slug}`} />
      )}
      {comments
        .filter((c) => !chapterId || c.chapterId === chapterId)
        .map((comment) => (
          <div key={comment.id} className="border-t pt-3">
            <p className="whitespace-pre-wrap">{comment.body}</p>
            {owner && (
              <button
                className={pill}
                onClick={() =>
                  void api
                    .request(`/tales/${slug}/social`, "POST", {
                      action: "hideComment",
                      commentId: comment.id,
                      enabled: !comment.hidden,
                    })
                    .then(() => load())
                    .catch((e) => setError(e.message))
                }
              >
                {comment.hidden
                  ? t("tales.showComment", "Show comment")
                  : t("tales.hideComment", "Hide comment")}
              </button>
            )}
          </div>
        ))}
      {cursor && (
        <button className={pill} onClick={() => void load(cursor)}>
          {t("tales.more", "Load more")}
        </button>
      )}
    </section>
  );
}
const emptyStory = {
  title: "",
  synopsis: "",
  coverUrl: "",
  defaultPrice: 0,
  commentsEnabled: true,
  notifySubscribers: false,
  status: "draft" as "draft" | "published",
  version: undefined as number | undefined,
};
const emptyChapter = {
  id: undefined as string | undefined,
  ordinal: 1,
  title: "",
  body: "",
  price: null as number | null,
  status: "draft" as "draft" | "published" | "scheduled",
  publishAt: "",
  version: undefined as number | undefined,
};
export function TalesEditor({
  api,
  slug,
}: {
  api: TalesTransport;
  slug?: string;
}) {
  const { t } = useTranslation();
  const [story, setStory] = useState({ ...emptyStory });
  const [chapter, setChapter] = useState({ ...emptyChapter });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [storyId, setStoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState("");
  const [rejected, setRejected] = useState<
    { type: "story" | "chapter"; id: string }[]
  >([]);
  const draftKey = api.userId
    ? `zobia:tales:draft:${api.userId}:${slug ?? "new"}`
    : null;
  const recovered = useRef(false);
  async function load() {
    if (!slug) {
      setReady(true);
      return;
    }
    const data = await api.request<StoryData>(`/tales/${slug}`);
    if (!data.isOwner)
      throw new Error(
        t("tales.ownerOnly", "Only the author can manage this story."),
      );
    setStoryId(data.story.id);
    setStory({
      ...data.story,
      coverUrl: data.story.coverUrl ?? "",
      status: data.story.status === "published" ? "published" : "draft",
    });
    setChapters(data.chapters);
    setReview(`${data.story.moderation}: ${data.story.moderationReason ?? ""}`);
    setRejected([
      ...(data.story.moderation === "rejected"
        ? [{ type: "story" as const, id: data.story.id }]
        : []),
      ...data.chapters
        .filter((c) => c.moderation === "rejected")
        .map((c) => ({ type: "chapter" as const, id: c.id })),
    ]);
    setReady(true);
  }
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    recovered.current = false;
    load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [slug, api.userId]);
  useEffect(() => {
    if (!ready || !draftKey) return;
    if (!recovered.current) {
      recovered.current = true;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.story) setStory(draft.story);
          if (draft.chapter) setChapter(draft.chapter);
          setNotice(
            t(
              "tales.recovered",
              "Recovered your unsaved text. Review it before saving.",
            ),
          );
        }
      } catch {}
      return;
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify({ story, chapter }));
    } catch {}
  }, [ready, draftKey, story, chapter]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveStory(status: "draft" | "published") {
    await perform(async () => {
      const saved = await api.request<Story>(
        slug ? `/tales/${slug}` : "/tales",
        slug ? "PATCH" : "POST",
        { ...story, status, coverUrl: story.coverUrl || null },
      );
      if (draftKey)
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      setStory({
        ...saved,
        coverUrl: saved.coverUrl ?? "",
        status: saved.status === "published" ? "published" : "draft",
      });
      setNotice(
        t(
          "tales.savedReview",
          "Saved. Publication requires approved moderation.",
        ),
      );
      if (!slug) api.navigate(`/t/${saved.slug}/manage`);
      else await load();
    });
  }
  async function saveChapter() {
    if (!slug) return;
    await perform(async () => {
      await api.request(`/tales/${slug}/chapters`, "POST", {
        ...chapter,
        price: chapter.ordinal === 1 ? 0 : chapter.price,
        publishAt: chapter.publishAt
          ? new Date(chapter.publishAt).toISOString()
          : null,
      });
      setChapter({ ...emptyChapter, ordinal: chapter.ordinal + 1 });
      setNotice(
        t(
          "tales.savedReview",
          "Saved. Publication requires approved moderation.",
        ),
      );
      await load();
    });
  }
  async function editChapter(ordinal: number) {
    if (!slug) return;
    await perform(async () => {
      const data = await api.request<ChapterData>(
        `/tales/${slug}/chapters/${ordinal}`,
      );
      const c = data.chapter;
      setChapter({
        ...c,
        body: c.body ?? "",
        status: c.status as typeof chapter.status,
        publishAt: c.publishAt
          ? new Date(c.publishAt).toISOString().slice(0, 16)
          : "",
      });
    });
  }
  if (!api.userId)
    return <Login api={api} path={slug ? `/t/${slug}/manage` : "/t/write"} />;
  if (!ready)
    return (
      <div className="p-4">
        <Message error={error} />
        {!error && t("action.loading", "Loading…")}
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4 text-neutral-900 dark:text-neutral-100">
      <Go api={api} to={slug ? `/t/${slug}` : "/t"}>
        {t("action.back", "Back")}
      </Go>
      <h1 className="text-2xl font-bold">
        {t("tales.manage", "Manage story")}
      </h1>
      <TalesAccountStatus api={api} />
      <Message error={error} />
      {notice && (
        <p role="status" className={panel}>
          {notice}
        </p>
      )}
      {review && <p>{review}</p>}
      <section className={panel}>
        <label>
          {t("tales.storyTitle", "Story title")}
          <input
            className={field}
            value={story.title}
            maxLength={150}
            onChange={(e) => setStory({ ...story, title: e.target.value })}
          />
        </label>
        <label>
          {t("tales.synopsis", "Synopsis")}
          <textarea
            className={field}
            value={story.synopsis}
            maxLength={5000}
            onChange={(e) => setStory({ ...story, synopsis: e.target.value })}
          />
        </label>
        <label>
          {t("tales.cover", "Cover image URL (HTTPS)")}
          <input
            type="url"
            className={field}
            value={story.coverUrl}
            onChange={(e) => setStory({ ...story, coverUrl: e.target.value })}
          />
        </label>
        {api.upload && (
          <label>
            {t("tales.uploadCover", "Upload cover")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void perform(async () => {
                    const url = await api.upload!(file);
                    setStory((s) => ({ ...s, coverUrl: url }));
                  });
              }}
            />
          </label>
        )}
        <label>
          {t(
            "tales.defaultPrice",
            "Default chapter price in credits (chapter one stays free)",
          )}
          <input
            type="number"
            className={field}
            min={0}
            max={1000000}
            value={story.defaultPrice}
            onChange={(e) =>
              setStory({ ...story, defaultPrice: Number(e.target.value) })
            }
          />
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={story.commentsEnabled}
            onChange={(e) =>
              setStory({ ...story, commentsEnabled: e.target.checked })
            }
          />{" "}
          {t("tales.allowComments", "Allow comments")}
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={story.notifySubscribers}
            onChange={(e) =>
              setStory({ ...story, notifySubscribers: e.target.checked })
            }
          />{" "}
          {t(
            "tales.notifySubscribers",
            "Notify author subscribers about newly published chapters",
          )}
        </label>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            className={pill}
            disabled={busy || !story.title.trim()}
            onClick={() => void saveStory("draft")}
          >
            {t("tales.saveDraft", "Save story as draft")}
          </button>
          {slug && (
            <button
              className={pill}
              disabled={busy}
              onClick={() => void saveStory("published")}
            >
              {t("tales.publishStory", "Publish story")}
            </button>
          )}
          <button
            className={pill}
            disabled={busy}
            onClick={() => {
              if (draftKey)
                try {
                  localStorage.removeItem(draftKey);
                } catch {}
              recovered.current = true;
              setChapter({ ...emptyChapter });
              void load();
            }}
          >
            {t("tales.discard", "Discard unsaved changes")}
          </button>
        </div>
      </section>
      {slug && (
        <>
          <section className={panel}>
            <h2 className="text-xl font-bold">
              {t("tales.chapters", "Chapters")}
            </h2>
            {chapters.map((c) => (
              <button
                key={c.id}
                className="block py-2 underline"
                onClick={() => void editChapter(c.ordinal)}
              >
                {c.ordinal}. {c.title} · {c.status} · {c.moderation}
              </button>
            ))}
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                setChapter({
                  ...emptyChapter,
                  ordinal: Math.max(0, ...chapters.map((c) => c.ordinal)) + 1,
                })
              }
            >
              {t("tales.newChapter", "New chapter")}
            </button>{" "}
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api.request(`/tales/${slug}/chapters`, "PATCH");
                  await load();
                })
              }
            >
              {t("tales.publishAll", "Publish all approved chapters")}
            </button>
          </section>
          <section className={panel}>
            <h2 className="text-xl font-bold">
              {t("tales.editChapter", "Write a chapter")}
            </h2>
            <label>
              {t("tales.chapterNumber", "Chapter number")}
              <input
                className={field}
                type="number"
                min={1}
                max={10000}
                disabled={!!chapter.id}
                value={chapter.ordinal}
                onChange={(e) =>
                  setChapter({ ...chapter, ordinal: Number(e.target.value) })
                }
              />
            </label>
            <label>
              {t("tales.chapterTitle", "Chapter title")}
              <input
                className={field}
                value={chapter.title}
                maxLength={150}
                onChange={(e) =>
                  setChapter({ ...chapter, title: e.target.value })
                }
              />
            </label>
            <label>
              {t("tales.chapterBody", "Chapter text")}
              <textarea
                className={`${field} min-h-80`}
                value={chapter.body}
                maxLength={100000}
                onChange={(e) =>
                  setChapter({ ...chapter, body: e.target.value })
                }
              />
            </label>
            <label>
              {t(
                "tales.chapterPrice",
                "Chapter price (blank uses story default, zero is free)",
              )}
              <input
                className={field}
                type="number"
                min={0}
                max={1000000}
                disabled={chapter.ordinal === 1}
                value={chapter.ordinal === 1 ? 0 : (chapter.price ?? "")}
                onChange={(e) =>
                  setChapter({
                    ...chapter,
                    price:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              {t("tales.chapterStatus", "Publication")}
              <select
                className={field}
                value={chapter.status}
                onChange={(e) =>
                  setChapter({
                    ...chapter,
                    status: e.target.value as typeof chapter.status,
                  })
                }
              >
                <option value="draft">{t("tales.draft", "Draft")}</option>
                <option value="published">
                  {t("tales.publish", "Publish now")}
                </option>
                <option value="scheduled">
                  {t("tales.schedule", "Schedule (paid plans)")}
                </option>
              </select>
            </label>
            {chapter.status === "scheduled" && (
              <label>
                {t("tales.publishDate", "Publish at (local time)")}
                <input
                  className={field}
                  type="datetime-local"
                  value={chapter.publishAt}
                  onChange={(e) =>
                    setChapter({ ...chapter, publishAt: e.target.value })
                  }
                />
              </label>
            )}
            <button
              className={pill}
              disabled={busy || !chapter.title.trim() || !chapter.body.trim()}
              onClick={() => void saveChapter()}
            >
              {t("tales.saveChapter", "Save chapter")}
            </button>
          </section>
          <TalesRewardPot api={api} slug={slug} chapters={chapters} />
          {rejected.map((target) => (
            <button
              key={target.id}
              className={pill}
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  t(
                    "tales.appealReason",
                    "Explain your appeal (at least 10 characters).",
                  ),
                );
                if (reason)
                  void perform(async () => {
                    await api.request("/tales/appeals", "POST", {
                      targetType: target.type,
                      targetId: target.id,
                      reason,
                    });
                    setNotice(
                      t("tales.appealed", "Appeal submitted for staff review."),
                    );
                  });
              }}
            >
              {t("tales.appeal", "Appeal rejection")} ({target.type})
            </button>
          ))}
          <button
            className={`${pill} text-red-600`}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    "tales.deleteConfirm",
                    "Remove this story from public discovery and reading?",
                  ),
                )
              )
                void perform(async () => {
                  await api.request(`/tales/${slug}`, "DELETE");
                  api.navigate("/t");
                });
            }}
          >
            {t("tales.delete", "Remove story")}
          </button>
          <span className="sr-only">{storyId}</span>
        </>
      )}
    </div>
  );
}
function TalesRewardPot({
  api,
  slug,
  chapters,
}: {
  api: TalesTransport;
  slug: string;
  chapters: Chapter[];
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState("story");
  const [amount, setAmount] = useState(100);
  const [maxClaimants, setMaxClaimants] = useState(10);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(method: string) {
    setBusy(true);
    setError("");
    try {
      await api.request(`/tales/${slug}/treasury`, method, {
        chapterId: target === "story" ? undefined : target,
        amount,
        maxClaimants,
      });
      setNotice(t("tales.potSaved", "Reward pot updated."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={panel}>
      <h2 className="text-xl font-bold">
        {t("tales.rewardPot", "Reward pot")}
      </h2>
      <p>
        {t(
          "tales.rewardDescription",
          "Fund credits for distinct readers who share this story or chapter. You cannot claim your own pot.",
        )}
      </p>
      <select
        className={field}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label={t("tales.potTarget", "Reward target")}
      >
        <option value="story">{t("tales.wholeStory", "Whole story")}</option>
        {chapters.map((c) => (
          <option value={c.id} key={c.id}>
            {c.ordinal}. {c.title}
          </option>
        ))}
      </select>
      <label>
        {t("tales.potAmount", "Total credits")}
        <input
          type="number"
          className={field}
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </label>
      <label>
        {t("tales.potClaimants", "Maximum claimants")}
        <input
          type="number"
          className={field}
          min={1}
          value={maxClaimants}
          onChange={(e) => setMaxClaimants(Number(e.target.value))}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {["POST", "PATCH", "DELETE"].map((method) => (
          <button
            key={method}
            className={pill}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    "tales.potConfirm",
                    "Confirm this reward-pot change? Funding or increasing a pot deducts credits; closing refunds unclaimed credits.",
                  ),
                )
              )
                void act(method);
            }}
          >
            {method === "POST"
              ? t("tales.potFund", "Fund pot")
              : method === "PATCH"
                ? t("tales.potEdit", "Edit total")
                : t("tales.potClose", "Close and refund")}
          </button>
        ))}
      </div>
      <Message error={error} />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function TalesModeration({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  type Item = {
    id: string;
    title: string;
    body?: string;
    moderationReason?: string;
    version: number;
    authorId?: string;
    userId?: string;
    state?: string;
    reason?: string;
    targetType?: "story" | "chapter" | "account";
    targetId?: string;
    targetVersion?: number;
  };
  const result = useLoad<{
    stories: Item[];
    chapters: Item[];
    appeals: Item[];
    accounts: Item[];
  }>(api, "/admin/tales");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  async function decide(
    targetType: "story" | "chapter" | "account",
    targetId: string,
    version: number,
    decision: string,
    appealId?: string,
  ) {
    const reason = window.prompt(
      t("tales.moderationReason", "Decision reason (at least 10 characters)"),
    );
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/admin/tales", "POST", {
        targetType,
        targetId,
        version,
        decision,
        reason,
        appealId,
      });
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <header className="flex justify-between">
        <h1 className="text-2xl font-bold">
          {t("tales.moderationTitle", "Tales moderation")}
        </h1>
        <button className={pill} disabled={busy} onClick={result.reload}>
          {t("tales.refresh", "Refresh")}
        </button>
      </header>
      <Message error={result.error || error} />
      {(["stories", "chapters"] as const).map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-xl font-bold">
            {group === "stories"
              ? t("tales.storiesReview", "Stories awaiting review")
              : t("tales.chaptersReview", "Chapters awaiting review")}
          </h2>
          {result.data?.[group].map((item) => (
            <div className={panel} key={item.id}>
              <h3 className="font-bold">{item.title}</h3>
              <p>{item.moderationReason}</p>
              {item.body && (
                <pre className="whitespace-pre-wrap max-h-96 overflow-auto font-sans">
                  {item.body}
                </pre>
              )}
              <button
                className={pill}
                disabled={busy}
                onClick={() =>
                  void decide(
                    group === "stories" ? "story" : "chapter",
                    item.id,
                    item.version,
                    "approved",
                  )
                }
              >
                {t("tales.approve", "Approve")}
              </button>{" "}
              <button
                className={pill}
                disabled={busy}
                onClick={() =>
                  void decide(
                    group === "stories" ? "story" : "chapter",
                    item.id,
                    item.version,
                    "rejected",
                  )
                }
              >
                {t("tales.reject", "Reject")}
              </button>
            </div>
          ))}
        </section>
      ))}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">{t("tales.appeals", "Appeals")}</h2>
        {result.data?.appeals.map((item) => (
          <div className={panel} key={item.id}>
            <p>
              {item.targetType} · {item.targetId} ·{" "}
              {t("tales.version", "Version {{version}}", {
                version: item.targetVersion,
              })}
            </p>
            <p className="whitespace-pre-wrap">{item.reason}</p>
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void decide(
                  item.targetType!,
                  item.targetId!,
                  item.targetVersion!,
                  item.targetType === "account" ? "active" : "approved",
                  item.id,
                )
              }
            >
              {t("tales.acceptAppeal", "Accept appeal")}
            </button>{" "}
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void decide(
                  item.targetType!,
                  item.targetId!,
                  item.targetVersion!,
                  item.targetType === "account"
                    ? (result.data?.accounts.find(
                        (a) => a.userId === item.targetId,
                      )?.state ?? "suspended")
                    : "rejected",
                  item.id,
                )
              }
            >
              {t("tales.rejectAppeal", "Reject appeal")}
            </button>
          </div>
        ))}
      </section>
      <section className={`${panel} space-y-2`}>
        <h2 className="text-xl font-bold">
          {t("tales.accountRestrictions", "Tales account restrictions")}
        </h2>
        <label>
          {t("tales.accountId", "Account UUID")}
          <input
            className={field}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <button
          className={pill}
          disabled={busy || !account}
          onClick={() => void decide("account", account, 0, "suspended")}
        >
          {t("tales.restrictAccount", "Suspend new Tales account")}
        </button>
        {result.data?.accounts.map((item) => (
          <div className="border-t py-3" key={item.userId}>
            <p>
              {item.userId} · {item.state} · {item.reason}
            </p>
            {["active", "suspended", "banned", "demonetized"].map((state) => (
              <button
                className={pill}
                key={state}
                disabled={busy}
                onClick={() =>
                  void decide("account", item.userId!, item.version, state)
                }
              >
                {t(`tales.states.${state}`, state)}
              </button>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
function ShareTale({
  api,
  slug,
  chapterId,
}: {
  api: TalesTransport;
  slug: string;
  chapterId?: string;
}) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    try {
      const url = window.location.href;
      if (navigator.share) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
      if (api.userId) {
        const result = await api.request<{ rewardClaimed: number | null }>(
          `/tales/${slug}/treasury`,
          "POST",
          { share: true, chapterId },
        );
        setNotice(
          result.rewardClaimed
            ? t("tales.shareReward", "Shared. You earned {{amount}} credits.", {
                amount: result.rewardClaimed,
              })
            : t("tales.shared", "Link shared."),
        );
      } else setNotice(t("tales.shared", "Link shared."));
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className={pill} disabled={busy} onClick={() => void share()}>
        {t("tales.share", "Share")}
      </button>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

function TalesAccountStatus({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  const result = useLoad<{
    canWrite: boolean;
    restriction: { state: string; reason: string } | null;
    minLevel: number;
    published: number;
    drafts: number;
    publishedLimit: number | null;
    draftLimit: number | null;
  }>(api, "/tales/account");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!api.userId || !result.data) return <Message error={result.error} />;
  const status = result.data;
  return (
    <section className={panel}>
      <h2 className="font-bold">
        {t("tales.accountStatus", "Your writing account")}
      </h2>
      <p>
        {t(
          "tales.quota",
          "Published stories: {{used}} / {{limit}}. Drafts: {{drafts}} / {{draftLimit}}.",
          {
            used: status.published,
            limit: status.publishedLimit ?? t("tales.unlimited", "Unlimited"),
            drafts: status.drafts,
            draftLimit: status.draftLimit ?? t("tales.unlimited", "Unlimited"),
          },
        )}
      </p>
      {!status.canWrite && !status.restriction && (
        <p>
          {t("tales.requiredLevel", "Reach Level {{level}} to write stories.", {
            level: status.minLevel,
          })}
        </p>
      )}
      {status.restriction && (
        <>
          <p>
            {status.restriction.state}: {status.restriction.reason}
          </p>
          <button
            className={pill}
            onClick={() => {
              const reason = window.prompt(
                t(
                  "tales.appealReason",
                  "Explain your appeal (at least 10 characters).",
                ),
              );
              if (reason)
                void api
                  .request("/tales/appeals", "POST", {
                    targetType: "account",
                    targetId: api.userId,
                    reason,
                  })
                  .then(() =>
                    setNotice(
                      t("tales.appealed", "Appeal submitted for staff review."),
                    ),
                  )
                  .catch((e) => setError(e.message));
            }}
          >
            {t("tales.appealRestriction", "Appeal account restriction")}
          </button>
        </>
      )}
      <Message error={error} />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

function TalesWalletBalance({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  const result = useLoad<{ user: { coin_balance: number | string } }>(
    api,
    "/users/me",
  );
  if (!result.data?.user) return null;
  return (
    <p className="my-2">
      {t(
        "tales.walletBalance",
        "You have {{balance}} credits in your wallet.",
        { balance: BigInt(result.data.user.coin_balance).toLocaleString() },
      )}
    </p>
  );
}
