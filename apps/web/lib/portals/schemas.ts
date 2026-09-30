/**
 * lib/portals/schemas.ts
 *
 * Zod schemas for the admin portal endpoints (create / patch).
 */

import { z } from "zod";
import { PORTAL_SECTION_KEYS } from "./constants";

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableDate = z.string().datetime({ offset: true }).nullable().optional();

export const portalSectionsSchema = z
  .array(z.object({ key: z.enum(PORTAL_SECTION_KEYS as unknown as [string, ...string[]]), enabled: z.boolean() }))
  .max(PORTAL_SECTION_KEYS.length)
  .optional();

const fields = {
  title: z.string().trim().min(1).max(80).optional(),
  tagline: nullableText(160),
  description: nullableText(1200),
  coverImageUrl: z.string().trim().url().max(2000).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a #RRGGBB hex colour")
    .nullable()
    .optional(),
  city: nullableText(80),
  bbBoardId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  boostWeight: z.number().int().min(0).max(100).optional(),
  boostStartsAt: nullableDate,
  boostEndsAt: nullableDate,
  sponsoredUntil: nullableDate,
  sponsorName: nullableText(80),
};

export const createPortalSchema = z.object({
  slug: z.string().trim().min(2).max(51),
  ...fields,
  sections: portalSectionsSchema,
});

export const patchPortalSchema = z.object({
  ...fields,
  sections: portalSectionsSchema,
  status: z.enum(["official", "auto", "archived", "suppressed"]).optional(),
});

export const hashtagActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("merge"), slug: z.string().trim().min(2).max(51), into: z.string().trim().min(2).max(51) }),
  z.object({ action: z.literal("block"), slug: z.string().trim().min(2).max(51) }),
  z.object({ action: z.literal("unblock"), slug: z.string().trim().min(2).max(51) }),
]);

export type CreatePortalBody = z.infer<typeof createPortalSchema>;
export type PatchPortalBody = z.infer<typeof patchPortalSchema>;
