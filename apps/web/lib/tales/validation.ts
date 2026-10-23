import { z } from "zod";
export const storyInput = z.object({
  title: z.string().trim().min(2).max(150),
  synopsis: z.string().trim().max(5000),
  coverUrl: z
    .string()
    .url()
    .max(1000)
    .refine((v) => v.startsWith("https://"), "Cover URL must use HTTPS.")
    .nullable()
    .optional(),
  defaultPrice: z.number().int().min(0).max(1000000).default(0),
  commentsEnabled: z.boolean().default(true),
  notifySubscribers: z.boolean().default(false),
  status: z.enum(["draft", "published"]).default("draft"),
  version: z.number().int().positive().optional(),
});
export const chapterInput = z.object({
  id: z.string().uuid().optional(),
  ordinal: z.number().int().min(1).max(10000),
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(100000),
  price: z.number().int().min(0).max(1000000).nullable().default(null),
  status: z.enum(["draft", "published", "scheduled"]).default("draft"),
  publishAt: z.string().datetime().nullable().optional(),
  version: z.number().int().positive().optional(),
});
export const appealInput = z.object({
  targetType: z.enum(["story", "chapter", "account"]),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(10).max(4000),
});
export const socialInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), enabled: z.boolean() }),
  z.object({ action: z.literal("vote"), enabled: z.boolean() }),
  z.object({
    action: z.literal("comment"),
    body: z.string().trim().min(1).max(2000),
    chapterId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("hideComment"),
    commentId: z.string().uuid(),
    enabled: z.boolean(),
  }),
]);
