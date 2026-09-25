export const dynamic = 'force-dynamic';

/**
 * POST /api/economy/gifts/send
 *
 * Send a gift to another user, optionally in a Room context.
 *
 * Flow:
 *   1. Validate the gift item and recipient exist
 *   2. Atomically deduct coins from sender (fails if insufficient balance)
 *   3. Create a gift record and a chat message (or room message)
 *   4. Check if gift value exceeds creator's spectacle threshold (rooms only)
 *   5. Award XP to both sender (Generosity) and recipient
 *
 * @module app/api/economy/gifts/send
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, forbidden, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
// NOTE: schema.giftRewardGrants is not included in the aggregated `schema`
// object exported from lib/db/schema.ts (a genuine gap there — flagged, not
// silently fixed since schema.ts is out of scope), so import the table
// directly instead.
import { giftRewardGrants } from "@/lib/db/schema";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";
import { requirePinVerified } from "@/lib/auth/pinGuard";
import { loadManifest } from "@/lib/manifest";
import { calculateFinalXP, PLAN_XP_MULTIPLIERS_BP } from "@/lib/xp/engine";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { advanceNewMemberQuestStep } from "@/lib/quests/newMemberQuestEngine";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { logger } from "@/lib/logger";
import type { Plan } from "@zobia/types";
import type { RewardConfig } from "@/lib/economy/giftItems";
import { claimRoomRewardOnGift } from "@/lib/contentTreasury";
import { getGiftMessageConfig, countWords } from "@/lib/plans/giftMessage";

// Platform takes 20% of gifts received by creators (PRD §14)
const CREATOR_GIFT_FEE_PERCENT = 20;
// Platform takes 5% of user-to-user coin gifts (PRD §11)
const USER_GIFT_FEE_PERCENT = 5;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const SendGiftSchema = z.object({
  /** UUID of the gift item from the catalogue. */
  giftItemId: z.string().uuid("giftItemId must be a valid UUID"),
  /** UUID of the recipient user. */
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  /** Optional Room UUID — if provided, the gift appears in the room feed. */
  roomId: z.string().uuid().optional(),
  /**
   * Optional Blog UUID — an alternative gift context to roomId, for sending a
   * sitewide gift to a blog's owner (see app/(app)/blogs/gift/[slug]/page.tsx).
   * Mutually exclusive with roomId.
   */
  blogId: z.string().uuid().optional(),
  /** Optional idempotency key — prevents double-send on client retry. */
  idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID").optional(),
  /**
   * Optional message attached to the gift (the "Add a message" box).
   * Word-limit and on/off eligibility are enforced server-side per the
   * sender's plan/business tier and account level — see
   * lib/plans/giftMessage.ts. Hard character ceiling here just bounds the
   * payload; the real limit is the word count check below.
   */
  message: z.string().trim().max(4000, "message is too long").optional(),
}).superRefine((val, ctx) => {
  if (val.roomId && val.blogId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blogId"], message: "roomId and blogId cannot both be set" });
  }
});

// ---------------------------------------------------------------------------
// XP awards (fire-and-forget)
// ---------------------------------------------------------------------------

async function awardGiftXP(
  orm: Awaited<ReturnType<typeof getDb>>,
  senderId: string,
  recipientId: string,
  giftTier: number,
  senderPlan: Plan,
  giftId: string,
  roomId?: string | null
): Promise<void> {
  // PRD §6: Sending a gift message is a messaging action — apply plan multiplier
  const { finalXp: senderXP } = calculateFinalXP(
    'send_gift_message',
    { plan: senderPlan, isMessagingAction: true }
  );

  // Recipient XP (receive_gift_and_react) — not a messaging action, no plan multiplier
  const { finalXp: recipientXP } = calculateFinalXP(
    'receive_gift_and_react',
    { plan: 'free', isMessagingAction: false }
  );

  // first_time_gifted XP (non-messaging, flat)
  const { finalXp: firstGiftXP } = calculateFinalXP(
    'first_time_gifted',
    { plan: 'free', isMessagingAction: false }
  );

  // being_tipped_in_room XP (non-messaging, flat)
  const { finalXp: tippedXP } = calculateFinalXP(
    'being_tipped_in_room',
    { plan: 'free', isMessagingAction: false }
  );

  // BUG-XP-GIFT-01: use safeAwardXP so failures write to the DLQ instead of being
  // silently dropped. Called after the main gift transaction has already committed.
  await safeAwardXP(senderId, senderXP, 'generosity', 'gift_sent', `gift:${giftId}:sender`);
  await safeAwardXP(recipientId, recipientXP, 'social', 'gift_received', `gift:${giftId}:recipient`);

  // Atomically claim first_time_gifted bonus to avoid a race when concurrent gifts arrive
  const firstGiftRows = await orm
    .update(schema.users)
    .set({ firstGiftReceivedXpAwarded: true })
    .where(
      and(
        eq(schema.users.id, recipientId),
        or(isNull(schema.users.firstGiftReceivedXpAwarded), eq(schema.users.firstGiftReceivedXpAwarded, false))
      )
    )
    .returning({ id: schema.users.id });
  if (firstGiftRows.length > 0) {
    await safeAwardXP(recipientId, firstGiftXP, 'social', 'first_time_gifted', `gift:${giftId}:first`);
  }

  if (roomId) {
    await safeAwardXP(recipientId, tippedXP, 'creator', 'being_tipped_in_room', `gift:${giftId}:tipped_in_room`);
  }

  // Suppress unused variable warning — giftTier kept in signature for future spectacle XP scaling
  void giftTier;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/gifts/send
 *
 * Body: { giftItemId: string, recipientId: string, roomId?: string }
 * Returns: { giftId, spectacleTriggered }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  // Declared outside try so the catch block can clean it up on error
  let idempKey: string | null = null;
  try {
    const senderId = auth.user.sub;
    const orm = await getDb();

    // Require a recent PIN verification only if:
    //   1. The admin has enabled the PIN auth feature, AND
    //   2. The user has a PIN configured.
    const manifest = await loadManifest();
    if (manifest.features.pinAuth) {
      const pinOk = await requirePinVerified(senderId, auth.user.sid);
      if (!pinOk) {
        const pinRows = await orm
          .select({ id: schema.userPins.id })
          .from(schema.userPins)
          .where(eq(schema.userPins.userId, senderId))
          .limit(1);
        if (pinRows.length > 0) {
          return NextResponse.json(
            { error: "PIN verification required", code: "PIN_REQUIRED" },
            { status: 403 }
          );
        }
      }
    }

    const body = await validateBody(req, SendGiftSchema);

    // Rate-limit: prevent double-tap sends and gift spam (STRUC-09)
    await enforceRateLimit(senderId, "user", RATE_LIMITS.apiWrite);
    await enforceRateLimit(senderId, "user", RATE_LIMITS.giftSend);

    if (body.recipientId === senderId) {
      throw badRequest("Cannot send a gift to yourself", "SELF_GIFT_NOT_ALLOWED");
    }

    // ZB-18: Derive the idempotency key server-side so it is always bound to the
    // specific operation (sender + recipient + item). A client-only UUID is unsafe
    // because the same UUID could be reused across different operations.
    const tenSecBucket = Math.floor(Date.now() / 10_000);
    const opHash = `${body.recipientId}:${body.giftItemId}`;
    idempKey = body.idempotencyKey
      ? `idempotency:gift:${senderId}:${body.idempotencyKey}:${opHash}`
      : `idempotency:gift:${senderId}:${opHash}:${tenSecBucket}`;
    // Check early — but do NOT write yet. The key is committed to Redis only after the
    // DB transaction succeeds (BUG-GIFT-01). Writing it before the transaction meant a
    // failed transaction left a stale key that blocked legitimate client retries.
    // RACE-01: returning 409 here ensures clients that race two concurrent requests
    // both see a definitive "already processed" signal rather than a misleading 200.
    const existingKey = await redis.get(idempKey);
    if (existingKey !== null) {
      return NextResponse.json(
        { success: true, duplicate: true, message: "Duplicate request - gift already sent" },
        { status: 409 }
      );
    }

    // FIX-C5 (BUG-18): If a roomId is provided, ensure the sender is an active member
    let roomCreatorId: string | null = null;
    if (body.roomId) {
      const memberRows = await orm
        .select({ id: schema.roomMembers.id })
        .from(schema.roomMembers)
        .where(
          and(
            eq(schema.roomMembers.roomId, body.roomId),
            eq(schema.roomMembers.userId, senderId),
            isNull(schema.roomMembers.leftAt)
          )
        )
        .limit(1);
      if (memberRows.length === 0) {
        return NextResponse.json({ error: 'NOT_ROOM_MEMBER' }, { status: 403 });
      }
      const roomOwnerRows = await orm
        .select({ creatorId: schema.rooms.creatorId })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, body.roomId))
        .limit(1);
      roomCreatorId = roomOwnerRows[0]?.creatorId ?? null;
    }

    // Blog gift context (app/(app)/blogs/gift/[slug]/page.tsx): resolve the
    // blog and its owner. The blog's own owner-defined Rewarded Gifts system
    // (blog_gift_tiers) is unrelated — this is the sitewide gift economy
    // sending to that blog's owner, in the same way rooms/[roomId]/gift does.
    let blogOwnerId: string | null = null;
    if (body.blogId) {
      const blogRows = await orm
        .select({ ownerId: schema.blogs.ownerId })
        .from(schema.blogs)
        .where(and(eq(schema.blogs.id, body.blogId), isNull(schema.blogs.deletedAt)))
        .limit(1);
      if (!blogRows[0]) {
        throw notFound("Blog not found");
      }
      blogOwnerId = blogRows[0].ownerId;
      if (body.recipientId !== blogOwnerId) {
        throw badRequest("recipientId must be the blog's owner", "BLOG_RECIPIENT_MISMATCH");
      }
    }

    // Trust gate: send_gift requires minimum trust score of 20
    const trusted = await meetsMinimumTrust(senderId, "send_gift", orm);
    if (!trusted) {
      throw forbidden("Your account trust score is too low to send gifts. Build your reputation first.", "TRUST_SCORE_TOO_LOW");
    }

    // Gift message eligibility (the "Add a message" box) — validated up
    // front so we never charge coins for a message we're about to reject.
    let giftMessage: string | null = null;
    let giftMessageWordCount: number | null = null;
    const trimmedMessage = body.message?.trim();
    if (trimmedMessage) {
      const senderPlanRows = await orm
        .select({ plan: schema.users.plan, rankLevel: schema.users.rankLevel })
        .from(schema.users)
        .where(and(eq(schema.users.id, senderId), isNull(schema.users.deletedAt)))
        .limit(1);
      const senderBizRows = await orm
        .select({ tier: schema.businessAccounts.tier })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.userId, senderId))
        .limit(1);
      const config = await getGiftMessageConfig(
        senderPlanRows[0]?.plan ?? "free",
        senderBizRows[0]?.tier ?? null,
        senderPlanRows[0]?.rankLevel ?? 1
      );
      if (!config.eligible) {
        throw forbidden(
          "You're not eligible to attach a message to this gift yet.",
          "GIFT_MESSAGE_NOT_ELIGIBLE"
        );
      }
      const wordCount = countWords(trimmedMessage);
      if (wordCount > config.maxWords) {
        throw badRequest(
          `Your message is too long — max ${config.maxWords} words for your plan.`,
          "GIFT_MESSAGE_TOO_LONG"
        );
      }
      giftMessage = trimmedMessage;
      giftMessageWordCount = wordCount;
    }

    // 1. Load gift item and resolve matching gift_type (if one exists by name)
    const giftRows = await orm
      .select({
        id: schema.giftItems.id,
        name: schema.giftItems.name,
        emoji: schema.giftItems.emoji,
        coinCost: schema.giftItems.coinCost,
        tier: schema.giftItems.tier,
        spectacleThresholdCoins: schema.giftItems.spectacleThresholdCoins,
        giftTypeId: schema.giftTypes.id,
        isRewarded: schema.giftItems.isRewarded,
        rewardConfig: schema.giftItems.rewardConfig,
      })
      .from(schema.giftItems)
      .leftJoin(
        schema.giftTypes,
        and(eq(schema.giftTypes.name, schema.giftItems.name), eq(schema.giftTypes.isActive, true))
      )
      .where(
        and(
          eq(schema.giftItems.id, body.giftItemId),
          eq(schema.giftItems.isActive, true),
          eq(schema.giftItems.isRetired, false)
        )
      )
      .limit(1);

    if (!giftRows[0]) {
      throw notFound("Gift item not found or unavailable");
    }

    const giftItemRow = giftRows[0];
    const giftItem = {
      ...giftItemRow,
      coinCost: Number(giftItemRow.coinCost),
      rewardConfig: giftItemRow.rewardConfig as RewardConfig | null,
    };

    // 2. Verify recipient exists
    const recipientRows = await orm
      .select({
        id: schema.users.id,
        username: schema.users.username,
        isCreator: schema.users.isCreator,
        creatorTier: schema.users.creatorTier,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, body.recipientId),
          isNull(schema.users.deletedAt),
          eq(schema.users.isBanned, false)
        )
      )
      .limit(1);

    if (!recipientRows[0]) {
      throw notFound("Recipient not found");
    }

    const recipient = recipientRows[0];

    // Check block relationship (both directions) before sending
    const blockRows = await orm
      .select({ id: schema.userBlocks.id })
      .from(schema.userBlocks)
      .where(
        or(
          and(eq(schema.userBlocks.blockerId, senderId), eq(schema.userBlocks.blockedId, body.recipientId)),
          and(eq(schema.userBlocks.blockerId, body.recipientId), eq(schema.userBlocks.blockedId, senderId))
        )
      )
      .limit(1);
    if (blockRows[0]) {
      throw forbidden("Cannot send a gift to this user", "USER_BLOCKED");
    }

    // 3. Atomic: debit coins and create gift record
    let giftId = "";
    let spectacleTriggered = false;
    // Holder object (rather than a plain `let`) so TS doesn't try to narrow
    // this across the async transaction closure below.
    const rewardState: { granted: { label: string; contextType: "room" | "blog" } | null } = { granted: null };

    // Compute fee split — Icon creators get 85% (15% fee), other creators 80% (20% fee), users 95% (5% fee)
    const creatorFeePercent = recipient.creatorTier === 'icon' ? 15 : CREATOR_GIFT_FEE_PERCENT;
    const feePercent = recipient.isCreator ? creatorFeePercent : USER_GIFT_FEE_PERCENT;
    const platformFeeCoins = Math.floor((giftItem.coinCost * feePercent) / 100);
    const recipientCoins = giftItem.coinCost - platformFeeCoins;

    await orm.transaction(async (tx) => {
      // Debit full coin cost from sender — on failure the catch below cleans up idempKey
      // FIX-C4 (BUG-19): pass idempotency key as referenceId to prevent duplicate ledger entries
      await debitCoins(
        senderId,
        giftItem.coinCost,
        "gift_sent",
        idempKey,
        `Sent ${giftItem.emoji} ${giftItem.name} to @${recipient.username}`,
        { recipientId: body.recipientId, giftItemId: giftItem.id },
        tx as never
      );

      // Credit coins to recipient (80% for creators, 95% for regular users)
      await creditCoins(
        body.recipientId,
        recipientCoins,
        "gift_received",
        idempKey,
        `Received ${giftItem.emoji} ${giftItem.name} from a friend`,
        { senderId, giftItemId: giftItem.id },
        tx as never
      );

      // Gifts are virtual-coin denominated, not fiat (kobo). We do NOT insert into
      // creator_earnings here because those columns are real-money (kobo) fields and
      // mixing coin values there would corrupt payout accounting (#14).
      // The coin_ledger entries written above are the canonical accounting record.
      // If gift-to-fiat cashout is needed in future, apply an explicit coin→kobo
      // conversion rate at withdrawal time.

      // Guild Legend tier 5% Room Revenue Share (PRD §13)
      // If this gift is in a room and the room creator belongs to a Legend-tier guild,
      // credit 5% of the gift's coin value to that guild's treasury.
      if (body.roomId && recipient.isCreator) {
        try {
          const legendGuildRows = await tx
            .select({ guildId: schema.guilds.id, treasuryBalance: schema.guilds.treasuryBalance })
            .from(schema.guilds)
            .innerJoin(schema.guildMembers, eq(schema.guildMembers.guildId, schema.guilds.id))
            .where(
              and(
                eq(schema.guildMembers.userId, body.recipientId),
                eq(schema.guilds.tier, "legend"),
                isNull(schema.guilds.deletedAt)
              )
            )
            .limit(1);
          if (legendGuildRows[0]) {
            // Guild share must come from the platform fee — never create new coins (BUG-05)
            const guildShare = Math.min(Math.floor((giftItem.coinCost * 5) / 100), platformFeeCoins);
            if (guildShare > 0) {
              const balanceBefore = Number(legendGuildRows[0].treasuryBalance ?? BigInt(0));
              // LEAST clamp ensures treasury_balance never exceeds treasury_cap (#24)
              const updatedGuild = await tx
                .update(schema.guilds)
                .set({
                  treasuryBalance: sql`LEAST(${schema.guilds.treasuryCap}, COALESCE(${schema.guilds.treasuryBalance}, 0) + ${guildShare})`,
                  updatedAt: sql`NOW()`,
                })
                .where(eq(schema.guilds.id, legendGuildRows[0].guildId))
                .returning({ treasuryBalance: schema.guilds.treasuryBalance });
              const balanceAfter = updatedGuild[0]?.treasuryBalance != null ? Number(updatedGuild[0].treasuryBalance) : balanceBefore;
              await tx.insert(schema.guildTreasuryLedger).values({
                guildId: legendGuildRows[0].guildId,
                amount: BigInt(guildShare),
                balanceBefore: BigInt(balanceBefore),
                balanceAfter: BigInt(balanceAfter),
                transactionType: "room_revenue_share",
                referenceId: body.roomId ?? null,
              });
            }
          }
        } catch {
          // Non-fatal — guild revenue share is a best-effort bonus
        }
      }

      // Create the gift record (coin_value is the original NOT NULL column; coin_cost is its alias)
      const giftInsert = await tx
        .insert(schema.gifts)
        .values({
          senderId,
          recipientId: body.recipientId,
          giftItemId: giftItem.id,
          // NOTE: schema.gifts.giftTypeId is declared NOT NULL, but this LEFT JOIN can
          // legitimately produce no match for legacy gift_items with no matching
          // gift_types row by name. Preserving the original raw-SQL behavior (attempt
          // NULL, let the DB constraint decide) rather than silently changing it —
          // flagged as a pre-existing schema/behavior mismatch, not introduced here.
          giftTypeId: giftItem.giftTypeId ?? (null as unknown as string),
          coinValue: BigInt(giftItem.coinCost),
          coinCost: BigInt(giftItem.coinCost),
          roomId: body.roomId ?? null,
          status: "delivered",
          message: giftMessage,
          messageWordCount: giftMessageWordCount,
        })
        .returning({ id: schema.gifts.id });

      giftId = giftInsert[0].id;

      // Create the message/event in the appropriate context
      if (body.roomId) {
        await tx.insert(schema.roomMessages).values({
          roomId: body.roomId,
          senderId,
          messageType: "gift",
          content: `${giftItem.emoji} ${giftItem.name}`,
          metadata: {
            giftId,
            giftItemId: giftItem.id,
            recipientId: body.recipientId,
            coinCost: giftItem.coinCost,
            tier: giftItem.tier,
            message: giftMessage,
          },
        });

        // Check both gift-item-level and creator-level spectacle thresholds (PRD §12)
        // Load the room's creator spectacle threshold
        const roomRows = await tx
          .select({ spectacleThresholdCoins: schema.rooms.spectacleThresholdCoins })
          .from(schema.rooms)
          .where(eq(schema.rooms.id, body.roomId))
          .limit(1);

        const roomThreshold = roomRows[0]?.spectacleThresholdCoins ?? null;
        const effectiveThreshold = roomThreshold ?? giftItem.spectacleThresholdCoins;

        if (effectiveThreshold != null && giftItem.coinCost >= effectiveThreshold) {
          spectacleTriggered = true;
        } else if (effectiveThreshold == null) {
          // No threshold set — always trigger spectacle for tier 2+ gifts
          spectacleTriggered = giftItem.tier >= 2;
        }
      } else {
        // DM gift message — upsert the conversation record then insert a
        // properly typed message so it appears in the DM feed (PRD §5).
        const [userId1, userId2] = senderId < body.recipientId ? [senderId, body.recipientId] : [body.recipientId, senderId];
        const convUpsert = await tx
          .insert(schema.dmConversations)
          .values({ userId1, userId2 })
          .onConflictDoUpdate({
            target: [schema.dmConversations.userId1, schema.dmConversations.userId2],
            set: { updatedAt: sql`NOW()` },
          })
          .returning({ id: schema.dmConversations.id });
        const dmConversationId = convUpsert[0]?.id ?? null;

        await tx.insert(schema.messages).values({
          senderId,
          recipientId: body.recipientId,
          conversationId: dmConversationId,
          messageType: "gift",
          content: `${giftItem.emoji} ${giftItem.name} (${giftItem.coinCost} coins)`,
          mediaUrl: null,
          coinCost: BigInt(giftItem.coinCost),
          replyCountFromRecipient: 0,
          metadata: { giftId, giftItemId: giftItem.id, message: giftMessage },
        });
      }

      // Rewarded Gifts fulfillment (migration 0026): only when this gift item
      // is marked rewarded AND it was sent to the actual owner/admin/creator
      // of the room or blog context it was sent in — not just any member/
      // recipient. Written in the same transaction as the debit/ledger insert
      // above so a crash can never leave a gift sent without its reward
      // granted (or vice versa).
      if (giftItem.isRewarded && giftItem.rewardConfig) {
        const config = giftItem.rewardConfig;
        let contextType: "room" | "blog" | null = null;
        let contextId: string | null = null;
        if (body.roomId && roomCreatorId && body.recipientId === roomCreatorId) {
          contextType = "room";
          contextId = body.roomId;
        } else if (body.blogId && blogOwnerId && body.recipientId === blogOwnerId) {
          contextType = "blog";
          contextId = body.blogId;
        }

        if (contextType && contextId) {
          const expiresAt = config.durationDays
            ? new Date(Date.now() + config.durationDays * 24 * 60 * 60 * 1000)
            : null;

          await tx.insert(giftRewardGrants).values({
            giftId,
            senderId,
            recipientId: body.recipientId,
            contextType,
            contextId,
            benefitType: config.benefitType,
            label: config.label,
            description: config.description ?? null,
            customText: config.benefitType === "custom_text" ? config.customText ?? null : null,
            expiresAt,
          });

          rewardState.granted = { label: config.label, contextType };

          // room_privilege: if room_members already carries a lightweight
          // per-member "tag" column we could extend, we'd set it here too —
          // but role is used for real permissions (member/admin/moderator),
          // so overloading it would be unsafe. The grant row above is the
          // complete, correct scope for this phase; see report for follow-up.
        }
      }
    });

    // Commit the idempotency key to Redis now that the DB transaction succeeded.
    // If this write fails the worst case is that a retry would re-enter the DB
    // transaction where debitCoins/creditCoins are both idempotent via reference_id.
    if (idempKey) {
      await redis.set(idempKey, "completed", "EX", 86400).catch(() => {});
    }

    // 4. Award XP — await so the award is guaranteed to run before the serverless
    // function returns. BUG-XP-FIRE-01 FIX: fire-and-forget promises may be
    // garbage-collected when Vercel terminates the invocation after the response is
    // sent, silently dropping all XP grants with no DLQ fallback.
    try {
      const planRows = await orm
        .select({ plan: schema.users.plan })
        .from(schema.users)
        .where(and(eq(schema.users.id, senderId), isNull(schema.users.deletedAt)))
        .limit(1);
      const senderPlan: Plan = (planRows[0]?.plan as Plan) ?? 'free';
      await awardGiftXP(orm, senderId, body.recipientId, giftItem.tier, senderPlan, giftId, body.roomId);
    } catch (err) {
      logger.error({ err }, '[gifts:POST] XP award failed');
    }

    // 5. Record guild war contribution (fire-and-forget)
    recordWarContribution(senderId, 'send_gift', orm as never).catch((err) => {
      logger.error({ err: err }, '[gifts:POST] war contribution failed');
      });

    // Trigger matching daily quest progress + New Member Quest step (fire-and-forget)
    void triggerActivityQuestProgress(senderId, 'gift', orm);
    void advanceNewMemberQuestStep(orm, senderId, 'gift_someone');

    // Notify the sender that they unlocked a Rewarded Gift benefit. Best-effort,
    // fired after commit (mirrors lib/blogs/service.ts's sendGift notification
    // pattern) — the grant row itself is already durably committed above.
    const granted = rewardState.granted;
    if (granted) {
      await insertNotificationBatch(
        orm,
        [senderId],
        "gift_reward_unlocked",
        `You unlocked "${granted.label}"!`,
        `Sending ${giftItem.emoji} ${giftItem.name} unlocked "${granted.label}" ${granted.contextType === "room" ? "in this room" : "on this blog"}.`,
        { giftId, giftItemId: giftItem.id, contextType: granted.contextType }
      ).catch((err) => {
        logger.error({ err }, '[gifts:POST] failed to notify sender of reward unlock');
      });
    }

    // Room Custom Rewards (migration 0040) — independent of the sitewide
    // Rewarded Gifts catalogue above: any gift sent to the room's owner can
    // trigger the room's own owner-configured reward. Runs in its own
    // transaction AFTER the send above has committed (mirrors how Polls/
    // Quizzes claim their treasury post-commit) rather than nesting another
    // orm.transaction() call inside the one above, which would check out a second
    // connection from the same pool while the first is still held (the exact
    // class of bug fixed in lib/manifest/getManifestValue — see
    // lib/creator/fundContribution.ts's doc comment).
    if (body.roomId && roomCreatorId && body.recipientId === roomCreatorId) {
      const roomReward = await claimRoomRewardOnGift(body.roomId, senderId, giftId).catch((err) => {
        logger.error({ err }, '[gifts:POST] room reward claim failed');
        return null;
      });
      if (roomReward) {
        const rewardBody =
          roomReward.rewardAction === "custom_text"
            ? roomReward.customInstructions ?? "Check the room for how to claim it."
            : `You received ${roomReward.amount} ${roomReward.rewardAction === "stars" ? "Stars" : "Credits"}!`;
        await insertNotificationBatch(
          orm,
          [senderId],
          "room_reward_unlocked",
          `You unlocked "${roomReward.title}"!`,
          rewardBody,
          { giftId, roomId: body.roomId, rewardAction: roomReward.rewardAction }
        ).catch((err) => {
          logger.error({ err }, '[gifts:POST] failed to notify sender of room reward unlock');
        });
      }
    }

    return NextResponse.json({
      success: true,
      giftId,
      gift: {
        id: giftItem.id,
        name: giftItem.name,
        emoji: giftItem.emoji,
        tier: giftItem.tier,
        coinCost: giftItem.coinCost,
      },
      recipient: {
        id: recipient.id,
        username: recipient.username,
      },
      message: giftMessage,
      spectacleTriggered,
      rewardGranted: granted,
    });
  } catch (err) {
    // The Redis idempotency key is only written after a successful DB commit, so
    // there is nothing to clean up here — the client can safely retry on any error.
    return handleApiError(err);
  }
});
