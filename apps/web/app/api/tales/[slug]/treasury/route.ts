import { z } from "zod";
import { taleAuth } from "@/lib/tales/api";
import { validateBody } from "@/lib/api/middleware";
import { getTale, readTaleChapter, taleAccount } from "@/lib/tales/service";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq } from "drizzle-orm";
import { forbidden, notFound } from "@/lib/api/errors";
import {
  fundContentTreasury,
  editContentTreasury,
  closeContentTreasury,
  getContentTreasury,
  recordContentShare,
} from "@/lib/contentTreasury";
const input = z.object({
  chapterId: z.string().uuid().optional(),
  amount: z.number().int().min(1).max(10000000).optional(),
  maxClaimants: z.number().int().min(1).max(100000).optional(),
  share: z.boolean().optional(),
});
const handler = (method: string) =>
  taleAuth<{ slug: string }>(async (req, { auth, params }) => {
    const body = await validateBody(req, input);
    const account = await taleAccount(auth.user.sub);
    const { story, isOwner } = await getTale(params.slug, auth.user.sub);
    let target = story.id;
    let type: "tale" | "tale_chapter" = "tale";
    if (body.chapterId) {
      const orm = await getDb();
      const [chapter] = await orm
        .select({
          id: schema.taleChapters.id,
          ordinal: schema.taleChapters.ordinal,
        })
        .from(schema.taleChapters)
        .where(
          and(
            eq(schema.taleChapters.id, body.chapterId),
            eq(schema.taleChapters.taleId, story.id),
          ),
        );
      if (!chapter) throw notFound();
      const access = await readTaleChapter(
        params.slug,
        chapter.ordinal,
        auth.user.sub,
      );
      if (access.locked)
        throw forbidden("Unlock the chapter before sharing it.");
      target = chapter.id;
      type = "tale_chapter";
    }
    if (body.share) {
      if (story.status !== "published" || story.moderation !== "approved")
        throw forbidden();
      return recordContentShare(
        type,
        target,
        auth.user.sub,
        "tale_treasury_reward",
        true,
        async () => {},
      );
    }
    if (!isOwner) throw forbidden("Only the author can manage reward pots.");
    if (account.state === "demonetized" && method !== "DELETE")
      throw forbidden("Monetization is disabled.");
    if (method === "POST")
      return fundContentTreasury(
        auth.user.sub,
        type,
        target,
        body.amount ?? 0,
        body.maxClaimants ?? 0,
        "tale_treasury_fund",
      );
    if (method === "PATCH")
      return editContentTreasury(
        auth.user.sub,
        type,
        target,
        body.amount ?? 0,
        body.maxClaimants ?? 0,
        "tale_treasury_fund",
        "tale_treasury_refund",
      );
    return closeContentTreasury(
      auth.user.sub,
      type,
      target,
      "tale_treasury_refund",
    );
  });
export const POST = handler("POST");
export const PATCH = handler("PATCH");
export const DELETE = handler("DELETE");
export const GET = taleAuth<{ slug: string }>(
  async (_req, { params, auth }) => {
    const { story } = await getTale(params.slug, auth.user.sub);
    return getContentTreasury("tale", story.id);
  },
);
