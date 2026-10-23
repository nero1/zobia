import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { getTale, saveTale, taleAccount } from "@/lib/tales/service";
import { storyInput } from "@/lib/tales/validation";
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";
import { forbidden } from "@/lib/api/errors";
export const GET = taleAuth<{ slug: string }>(async (_req, { auth, params }) =>
  getTale(params.slug, auth.user.sub),
);
export const PATCH = taleAuth<{ slug: string }>(
  async (req, { auth, params }) => {
    const { story, isOwner } = await getTale(params.slug, auth.user.sub);
    if (!isOwner) throw forbidden();
    return saveTale(
      auth.user.sub,
      await validateBody(req, storyInput),
      story.id,
    );
  },
);
export const DELETE = taleAuth<{ slug: string }>(
  async (_req, { auth, params }) => {
    await taleAccount(auth.user.sub);
    const { story, isOwner } = await getTale(params.slug, auth.user.sub);
    if (!isOwner) throw forbidden();
    const orm = await getDb();
    await orm
      .update(schema.tales)
      .set({
        status: "removed",
        updatedAt: new Date(),
        version: story.version + 1,
      })
      .where(eq(schema.tales.id, story.id));
    return { removed: true };
  },
);
