/**
 * lib/economy/giftItems.ts
 *
 * Shared create-gift-item logic for the sitewide Gifts economy catalog.
 * Used by POST /api/admin/gifts (standalone gift creation) and
 * POST /api/admin/gift-drop (inline "create a new gift for this drop"),
 * so both routes insert `gift_items` rows the same way instead of
 * duplicating the INSERT.
 */

import { z } from "zod";
import { schema, type DbOrTx } from "@/lib/db/drizzle";

// ---------------------------------------------------------------------------
// Rewarded Gifts — reward_config (see db/migrations/0001_consolidated_schema.sql)
// ---------------------------------------------------------------------------
//
// A gift item can optionally be marked "rewarded": sending it to the actual
// owner/admin/creator of a room or blog unlocks a reward for the sender. The
// same gift item can be sent in either context — the send context (room vs
// blog) decides where the reward applies, not the gift item's config.

export const GIFT_BENEFIT_TYPES = ["sender_badge", "room_privilege", "blog_privilege", "custom_text"] as const;
export type GiftBenefitType = (typeof GIFT_BENEFIT_TYPES)[number];

export const rewardConfigSchema = z
  .object({
    benefitType: z.enum(GIFT_BENEFIT_TYPES),
    label: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    durationDays: z.number().int().positive().nullable().optional(),
    customText: z.string().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.benefitType === "custom_text" && !val.customText?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customText"],
        message: "customText is required when benefitType is 'custom_text'",
      });
    }
  });

export type RewardConfig = z.infer<typeof rewardConfigSchema>;

/**
 * Zod refinement shared by createGiftSchema/updateGiftSchema: when
 * isRewarded is true, rewardConfig must be present and valid; when false or
 * omitted, rewardConfig is ignored (never required) so existing non-rewarded
 * Android/web create flows keep working unchanged.
 */
export function refineRewardFields<T extends { isRewarded?: boolean; rewardConfig?: unknown }>(
  val: T,
  ctx: z.RefinementCtx
): void {
  if (val.isRewarded) {
    if (val.rewardConfig == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rewardConfig"], message: "rewardConfig is required when isRewarded is true" });
      return;
    }
    const parsed = rewardConfigSchema.safeParse(val.rewardConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["rewardConfig", ...issue.path] });
      }
    }
  }
}

export interface CreateGiftItemInput {
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl?: string | null;
  spectacleThresholdCoins?: number | null;
  isRewarded?: boolean;
  rewardConfig?: RewardConfig | null;
}

export interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isActive: boolean;
  isRewarded: boolean;
  rewardConfig: RewardConfig | null;
  createdAt: string;
}

/**
 * Insert a new gift_items row. Caller is responsible for validating `input`
 * (e.g. via createGiftSchema in app/api/admin/gifts/route.ts) before calling.
 */
export async function createGiftItem(
  input: CreateGiftItemInput,
  db: DbOrTx
): Promise<GiftItem> {
  const isRewarded = input.isRewarded ?? false;
  const [row] = await db
    .insert(schema.giftItems)
    .values({
      name: input.name,
      emoji: input.emoji,
      coinCost: BigInt(input.coinCost),
      tier: input.tier,
      animationUrl: input.animationUrl ?? null,
      spectacleThresholdCoins: input.spectacleThresholdCoins ?? null,
      isActive: true,
      isRewarded,
      rewardConfig: isRewarded && input.rewardConfig ? input.rewardConfig : null,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    coinCost: Number(row.coinCost),
    tier: row.tier,
    animationUrl: row.animationUrl,
    spectacleThresholdCoins: row.spectacleThresholdCoins,
    isActive: row.isActive,
    isRewarded: row.isRewarded,
    rewardConfig: row.rewardConfig as RewardConfig | null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}
