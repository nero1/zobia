import { loadManifest, getManifestValue } from "@/lib/manifest";

/** Only public product settings are exposed; arbitrary x_manifest keys are never interpolated. */
export async function renderHelpText(source: string): Promise<string> {
  if (!source.includes("{{")) return source;
  const manifest = await loadManifest();
  const values: Record<string, string | number> = {
    "currency.softPlural": manifest.currency.softNamePlural,
    "currency.softSingular": manifest.currency.softNameSingular,
    "challenges.expiryHours": manifest.games.challengeExpiryHours,
  };
  const settings: Record<string, [string, number]> = {
    "tales.minLevel": ["tales_min_level", 2],
    "tales.publishedLimit": ["tales_free_published_limit", 10],
    "tales.draftLimit": ["tales_free_draft_limit", 20],
    "tales.appealLimit": ["tales_appeal_limit", 3],
    "help.aiFreeWeeklyLimit": ["help_ai_weekly_limit_free", 20],
    "help.aiQuestionCost": ["help_ai_question_cost_credits", 5],
    "bookmarks.plusFolders": ["bookmark_folders_plus", 5],
    "bookmarks.proFolders": ["bookmark_folders_pro", 15],
    "bookmarks.maxFolders": ["bookmark_folders_max", 30],
    "bookmarks.firstFolderCost": ["bookmark_folder_first_cost", 100],
    "bookmarks.extraFolderCost": ["bookmark_folder_extra_cost", 50],
    "challenges.dailyLimit": ["game_challenge_daily_limit", 10],
  };
  const used = [
    ...new Set([...source.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1])),
  ];
  await Promise.all(
    used
      .filter((key) => key in settings)
      .map(async (key) => {
        const [name, fallback] = settings[key];
        const value = Number((await getManifestValue(name)) ?? fallback);
        values[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
      }),
  );
  return source.replace(/{{\s*([\w.]+)\s*}}/g, (original, key: string) =>
    key in values ? String(values[key]) : original,
  );
}
