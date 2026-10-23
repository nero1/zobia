import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { readTaleChapter, unlockTaleChapter } from "@/lib/tales/service";
const ordinalSchema = z.coerce.number().int().min(1).max(10000);
export const GET = taleAuth<{ slug: string; ordinal: string }>(
  async (_req, { auth, params }) =>
    readTaleChapter(
      params.slug,
      ordinalSchema.parse(params.ordinal),
      auth.user.sub,
    ),
);
export const POST = taleAuth<{ slug: string; ordinal: string }>(
  async (req, { auth, params }) => {
    const body = await validateBody(
      req,
      z.object({ confirmedCost: z.number().int().nonnegative() }),
    );
    return unlockTaleChapter(
      auth.user.sub,
      params.slug,
      ordinalSchema.parse(params.ordinal),
      body.confirmedCost,
    );
  },
);
