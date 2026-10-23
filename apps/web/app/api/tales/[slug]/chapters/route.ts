import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { saveTaleChapter, publishTaleChapters } from "@/lib/tales/service";
import { chapterInput } from "@/lib/tales/validation";
export const POST = taleAuth<{ slug: string }>(
  async (req, { auth, params }) => {
    const data = await validateBody(req, chapterInput);
    return saveTaleChapter(auth.user.sub, params.slug, data, data.id);
  },
);
export const PATCH = taleAuth<{ slug: string }>(
  async (_req, { auth, params }) =>
    publishTaleChapters(auth.user.sub, params.slug),
);
