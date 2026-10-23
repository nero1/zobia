import { taleAuth, listQuery } from "@/lib/tales/api";
import { validateBody, validateSearchParams } from "@/lib/api/middleware";
import { z } from "zod";
export const dynamic = "force-dynamic";
import { appealTale } from "@/lib/tales/service";
import { appealInput } from "@/lib/tales/validation";
export const POST = taleAuth(async (req, { auth }) =>
  appealTale(auth.user.sub, await validateBody(req, appealInput)),
);
