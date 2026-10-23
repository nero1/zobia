import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { taleSocial, taleComments } from "@/lib/tales/service";
import { socialInput } from "@/lib/tales/validation";
export const GET = taleAuth<{ slug: string }>(async (req, { auth, params }) => {
  const q = validateSearchParams(
    req.nextUrl.searchParams,
    z.object({ cursor: z.string().max(1000).optional() }),
  );
  return taleComments(params.slug, auth.user.sub, q.cursor);
});
export const POST = taleAuth<{ slug: string }>(async (req, { auth, params }) =>
  taleSocial(auth.user.sub, params.slug, await validateBody(req, socialInput)),
);
