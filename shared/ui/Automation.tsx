"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TalesTransport } from "./Tales";
interface Job {
  id?: string;
  accountId: string;
  name: string;
  targetType: "forum" | "wiki" | "blog" | "room";
  targetId: string;
  instructions: string;
  providers: string[];
  intervalHours: number;
  publicationMode: "review" | "auto";
  enabled: boolean;
  nextRunAt?: string;
  lastError?: string | null;
}
interface Generation {
  id: string;
  title: string;
  body: string;
  status: string;
  reviewReason: string;
  provider: string;
  targetType: string;
  publishedUrl: string | null;
}
interface Overview {
  accounts: {
    id: string;
    username: string;
    displayName: string;
    enabled: boolean;
  }[];
  jobs: Job[];
  generations: Generation[];
  providers: string[];
}
const field =
  "block w-full rounded-lg border border-neutral-300 bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 p-3 my-2";
const panel =
  "rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4";
const pill =
  "rounded-full border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50";
const initial: Job = {
  accountId: "",
  name: "",
  targetType: "forum",
  targetId: "",
  instructions: "",
  providers: [],
  intervalHours: 24,
  publicationMode: "review",
  enabled: false,
};
export function AutomationPanel({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview>();
  const [job, setJob] = useState<Job>({ ...initial });
  const [account, setAccount] = useState({ username: "", displayName: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const overview = await api.request<Overview>("/admin/automation");
      setData(overview);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [api.request]);
  async function act(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request("/admin/automation", "POST", body);
      setNotice(t("automation.saved", "Saved."));
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4 text-neutral-900 dark:text-neutral-100">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t("automation.title", "Official content studio")}
        </h1>
        <button className={pill} disabled={busy} onClick={() => void load()}>
          {t("automation.refresh", "Refresh")}
        </button>
      </header>
      <p>
        {t(
          "automation.description",
          "Create official Ⓩ accounts and schedule useful evergreen contributions. Jobs are disabled until you enable them. Review mode keeps drafts private for an editor to approve.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className={`${panel} space-y-2`}>
        <h2 className="text-xl font-bold">
          {t("automation.accounts", "Official accounts")}
        </h2>
        {data?.accounts.map((user) => (
          <div key={user.id} className="flex flex-wrap gap-2 items-center">
            <span>
              {user.displayName} · @{user.username}
            </span>
            <code className="text-xs">{user.id}</code>
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void act({
                  action: "accountEnabled",
                  id: user.id,
                  enabled: !user.enabled,
                })
              }
            >
              {user.enabled
                ? t("automation.disable", "Disable")
                : t("automation.enable", "Enable")}
            </button>
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: "account", ...account }).then((ok) => {
              if (ok) setAccount({ username: "", displayName: "" });
            });
          }}
        >
          <label>
            {t("automation.username", "Username")}
            <input
              className={field}
              value={account.username}
              onChange={(e) =>
                setAccount({ ...account, username: e.target.value })
              }
              pattern="[a-zA-Z0-9_]{3,30}"
              required
            />
          </label>
          <label>
            {t("automation.displayName", "Display name")}
            <input
              className={field}
              value={account.displayName}
              onChange={(e) =>
                setAccount({ ...account, displayName: e.target.value })
              }
              required
              maxLength={60}
            />
          </label>
          <button className={pill} disabled={busy}>
            {t("automation.createAccount", "Create official account")}
          </button>
        </form>
      </section>
      <form
        className={`${panel} space-y-2`}
        onSubmit={(event) => {
          event.preventDefault();
          void act({ action: "job", job }).then((ok) => {
            if (ok) setJob({ ...initial });
          });
        }}
      >
        <h2 className="text-xl font-bold">
          {job.id
            ? t("automation.editJob", "Edit publishing job")
            : t("automation.newJob", "New publishing job")}
        </h2>
        <label>
          {t("automation.jobName", "Job name")}
          <input
            className={field}
            value={job.name}
            onChange={(e) => setJob({ ...job, name: e.target.value })}
            required
            maxLength={100}
          />
        </label>
        <label>
          {t("automation.account", "Official account")}
          <select
            className={field}
            value={job.accountId}
            onChange={(e) => setJob({ ...job, accountId: e.target.value })}
            required
          >
            <option value="">
              {t("automation.chooseAccount", "Choose an account")}
            </option>
            {data?.accounts
              .filter((a) => a.enabled)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("automation.destinationType", "Destination type")}
          <select
            className={field}
            value={job.targetType}
            onChange={(e) =>
              setJob({
                ...job,
                targetType: e.target.value as Job["targetType"],
              })
            }
          >
            <option value="forum">
              {t("automation.forum", "Public forum board")}
            </option>
            <option value="wiki">
              {t("automation.wiki", "Official wiki")}
            </option>
            <option value="blog">
              {t("automation.blog", "Official blog")}
            </option>
            <option value="room">
              {t("automation.room", "Official public room")}
            </option>
          </select>
        </label>
        <label>
          {t("automation.destinationId", "Destination UUID")}
          <input
            className={field}
            value={job.targetId}
            onChange={(e) => setJob({ ...job, targetId: e.target.value })}
            required
          />
        </label>
        <p className="text-xs">
          {t(
            "automation.destinationRule",
            "Blogs, wikis and public free-open rooms must belong to the selected official account. Forum destinations must be active public boards.",
          )}
        </p>
        <label>
          {t("automation.direction", "Editorial direction")}
          <textarea
            className={field}
            value={job.instructions}
            onChange={(e) => setJob({ ...job, instructions: e.target.value })}
            maxLength={6000}
          />
        </label>
        <fieldset>
          <legend>
            {t("automation.providers", "AI providers (fallback selection)")}
          </legend>
          {data?.providers.map((provider) => (
            <label key={provider} className="inline-block me-4">
              <input
                type="checkbox"
                checked={job.providers.includes(provider)}
                onChange={(e) =>
                  setJob({
                    ...job,
                    providers: e.target.checked
                      ? [...job.providers, provider]
                      : job.providers.filter((p) => p !== provider),
                  })
                }
              />{" "}
              {provider}
            </label>
          ))}
        </fieldset>
        <label>
          {t("automation.interval", "Hours between contributions")}
          <input
            type="number"
            className={field}
            min={1}
            max={8760}
            value={job.intervalHours}
            onChange={(e) =>
              setJob({ ...job, intervalHours: Number(e.target.value) })
            }
          />
        </label>
        <label>
          {t("automation.mode", "Publication mode")}
          <select
            className={field}
            value={job.publicationMode}
            onChange={(e) =>
              setJob({
                ...job,
                publicationMode: e.target.value as Job["publicationMode"],
              })
            }
          >
            <option value="review">
              {t("automation.reviewMode", "Editor review required")}
            </option>
            <option value="auto">
              {t(
                "automation.autoMode",
                "Publish after high-confidence editorial review",
              )}
            </option>
          </select>
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={job.enabled}
            onChange={(e) => setJob({ ...job, enabled: e.target.checked })}
          />{" "}
          {t("automation.enabled", "Enable this publishing job")}
        </label>
        <button className={pill} disabled={busy || !job.providers.length}>
          {t("automation.saveJob", "Save job")}
        </button>{" "}
        <button
          type="button"
          className={pill}
          disabled={busy}
          onClick={() => setJob({ ...initial })}
        >
          {t("automation.clear", "Clear form")}
        </button>
      </form>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">
          {t("automation.jobs", "Publishing jobs")}
        </h2>
        {data?.jobs.map((item) => (
          <div className={panel} key={item.id}>
            <h3 className="font-bold">{item.name}</h3>
            <p>
              {item.targetType} · {item.publicationMode} · {item.intervalHours}h
              ·{" "}
              {item.enabled
                ? t("automation.enabledLabel", "Enabled")
                : t("automation.disabledLabel", "Disabled")}
            </p>
            {item.nextRunAt && (
              <p>
                {t("automation.nextRun", "Next due: {{date}}", {
                  date: new Date(item.nextRunAt).toLocaleString(),
                })}
              </p>
            )}
            {item.lastError && <p className="text-red-600">{item.lastError}</p>}
            <button
              className={pill}
              disabled={busy}
              onClick={() => setJob(item)}
            >
              {t("action.edit", "Edit")}
            </button>{" "}
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                void act({
                  action: "job",
                  job: { ...item, enabled: !item.enabled },
                })
              }
            >
              {item.enabled
                ? t("automation.disable", "Disable")
                : t("automation.enable", "Enable")}
            </button>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">
          {t("automation.drafts", "Generated contributions")}
        </h2>
        {data?.generations.map((generation) => (
          <GenerationEditor
            key={generation.id + generation.status}
            generation={generation}
            api={api}
            busy={busy}
            submit={act}
          />
        ))}
      </section>
    </div>
  );
}
function GenerationEditor({
  generation,
  api,
  busy,
  submit,
}: {
  generation: Generation;
  api: TalesTransport;
  busy: boolean;
  submit: (body: unknown) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(generation.title);
  const [body, setBody] = useState(generation.body);
  return (
    <article className={`${panel} space-y-2`}>
      <h3 className="font-bold">{generation.title}</h3>
      <p>
        {generation.status} · {generation.targetType} · {generation.provider}
      </p>
      <p>{generation.reviewReason}</p>
      {generation.status === "published" ? (
        <>
          <p className="whitespace-pre-wrap max-h-60 overflow-auto">
            {generation.body}
          </p>
          {generation.publishedUrl && (
            <button
              className={pill}
              onClick={() => api.navigate(generation.publishedUrl!)}
            >
              {t("automation.view", "View published contribution")}
            </button>
          )}
        </>
      ) : (
        <>
          <label>
            {t("automation.generatedTitle", "Title")}
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={150}
            />
          </label>
          <label>
            {t("automation.generatedBody", "Contribution")}
            <textarea
              className={`${field} min-h-80`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={40000}
            />
          </label>
          <p className="text-xs">
            {t(
              "automation.editorialCheck",
              "Check accuracy, source links, originality and destination relevance before approving.",
            )}
          </p>
          <button
            className={pill}
            disabled={busy}
            onClick={() =>
              void submit({
                action: "review",
                id: generation.id,
                approved: true,
                title,
                body,
              })
            }
          >
            {t("automation.approve", "Approve and publish")}
          </button>{" "}
          <button
            className={pill}
            disabled={busy}
            onClick={() =>
              void submit({
                action: "review",
                id: generation.id,
                approved: false,
              })
            }
          >
            {t("automation.reject", "Reject")}
          </button>
        </>
      )}
    </article>
  );
}
