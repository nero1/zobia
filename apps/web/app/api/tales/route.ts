import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { listTales, saveTale } from "@/lib/tales/service";
import { storyInput } from "@/lib/tales/validation";
export const GET = taleAuth(async (req, { auth }) => {
  const q = validateSearchParams(req.nextUrl.searchParams, listQuery);
  return listTales(auth.user.sub, q.tab, q.cursor, q.q);
});
export const POST = taleAuth(async (req, { auth }) =>
  saveTale(auth.user.sub, await validateBody(req, storyInput)),
);
