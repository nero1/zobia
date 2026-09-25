/**
 * lib/support/service.ts
 *
 * Support Ticket System — eligibility, charging, creation, messaging,
 * assignment/escalation, and AI triage. Mirrors lib/forum/service.ts's
 * "feature flag → eligibility → (optional) charge → atomic write" shape.
 *
 * Escalation is modeled as ticket state (status/assigned_to) plus an
 * append-only support_ticket_events audit log — no separate escalation
 * table (see 0001_consolidated_schema.sql).
 *
 * @module lib/support/service
 */

import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { getStaffRoles, hasAnyRole, type StaffRoles } from "@/lib/auth/roles";
import { getTicketEligibility } from "@/lib/support/eligibility";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { aiClient } from "@/lib/ai/client";
import { ApiError, badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TicketStatus = "open" | "pending" | "escalated" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type ChargingModel = ZobiaManifest["support"]["chargingModel"];

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  is_ai_handled: boolean;
  ai_resolved: boolean;
  source: "ticket" | "help_center_ai";
  message_count: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  sender_type: "user" | "staff" | "ai";
  body: string;
  charged: boolean;
  charged_credits: number;
  charged_stars: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mappers — the public API shape here is snake_case (matches the old
// raw-SQL row shape other callers/tests already depend on); Drizzle returns
// camelCase, so map at the read boundary.
// ---------------------------------------------------------------------------

type TicketRow = typeof schema.supportTickets.$inferSelect;
type MessageRow = typeof schema.supportTicketMessages.$inferSelect;

function toTicket(row: TicketRow): SupportTicket {
  return {
    id: row.id,
    user_id: row.userId,
    subject: row.subject,
    status: row.status as TicketStatus,
    priority: row.priority as TicketPriority,
    assigned_to: row.assignedTo,
    is_ai_handled: row.isAiHandled,
    ai_resolved: row.aiResolved,
    source: row.source as "ticket" | "help_center_ai",
    message_count: row.messageCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_activity_at: row.lastActivityAt.toISOString(),
  };
}

function toMessage(row: MessageRow): SupportTicketMessage {
  return {
    id: row.id,
    ticket_id: row.ticketId,
    sender_id: row.senderId,
    sender_type: row.senderType as "user" | "staff" | "ai",
    body: row.body,
    charged: row.charged,
    charged_credits: row.chargedCredits,
    charged_stars: row.chargedStars,
    created_at: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Charging model — pure function, unit-tested independently
// ---------------------------------------------------------------------------

/**
 * Decides whether the Nth message on a ticket (1-based; message 1 is the
 * ticket-opening message) should be charged, per the admin-configured
 * charging model.
 *
 * - first_message_only : only message 1 is charged (covers ticket creation).
 * - every_message       : every message is charged.
 * - every_x_messages    : every Xth message is charged (X, 2X, 3X, ...).
 * - first_x_messages    : only messages 1..X are charged.
 *
 * X is clamped to >= 1 so a misconfigured 0/negative value can't produce a
 * divide-by-zero or charge-nothing/charge-everything surprise.
 */
export function shouldChargeMessage(model: ChargingModel, x: number, messageIndex: number): boolean {
  const safeX = Math.max(1, Math.floor(x) || 1);
  switch (model) {
    case "first_message_only":
      return messageIndex === 1;
    case "every_message":
      return true;
    case "every_x_messages":
      return messageIndex % safeX === 0;
    case "first_x_messages":
      return messageIndex <= safeX;
    default:
      return messageIndex === 1;
  }
}

// ---------------------------------------------------------------------------
// Charging — actually debits the user, preferring credits then stars if both
// configured (admin can set either/both; a user only needs one to succeed).
// ---------------------------------------------------------------------------

interface ChargeResult {
  charged: boolean;
  chargedCredits: number;
  chargedStars: number;
}

/**
 * Attempts to charge a user the configured ticket cost for one message.
 * Throws a client-facing 402-style ApiError on insufficient balance —
 * callers MUST NOT post the message if this throws (never charge-and-fail-open).
 */
async function chargeForMessage(
  userId: string,
  costCredits: number,
  costStars: number,
  referenceId: string,
  tx: DbOrTx
): Promise<ChargeResult> {
  if (costCredits <= 0 && costStars <= 0) {
    return { charged: false, chargedCredits: 0, chargedStars: 0 };
  }

  // Prefer credits when both are configured; fall back to stars only if
  // credits aren't configured at all (admin picks ONE currency in practice,
  // but supporting both keeps the config flexible).
  if (costCredits > 0) {
    try {
      await debitCoins(userId, costCredits, "support_ticket_cost", referenceId, "Support ticket charge", null, tx);
      return { charged: true, chargedCredits: costCredits, chargedStars: 0 };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE" && costStars > 0) {
        // Fall through to try stars below.
      } else {
        throw badRequest("Insufficient credits to send this message. Top up your balance and try again.", "INSUFFICIENT_BALANCE");
      }
    }
  }

  if (costStars > 0) {
    try {
      await debitStars(userId, costStars, "support_ticket_cost", referenceId, "Support ticket charge", tx);
      return { charged: true, chargedCredits: 0, chargedStars: costStars };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_STAR_BALANCE") {
        throw badRequest("Insufficient stars to send this message. Top up your balance and try again.", "INSUFFICIENT_BALANCE");
      }
      throw err;
    }
  }

  throw badRequest("Insufficient balance to send this message.", "INSUFFICIENT_BALANCE");
}

// ---------------------------------------------------------------------------
// Ticket creation
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  userId: string;
  subject: string;
  firstMessage: string;
  /** Set when created from a Help Center "Ask AI" transcript (Feature 2). */
  source?: "ticket" | "help_center_ai";
  sourceHelpDocId?: string | null;
}

export async function createTicket(input: CreateTicketInput): Promise<SupportTicket> {
  await requireFeatureEnabled("supportTickets");
  const manifest = await loadManifest();

  const subject = input.subject.trim();
  const firstMessage = input.firstMessage.trim();
  if (!subject || subject.length < 3) throw badRequest("Subject must be at least 3 characters");
  if (!firstMessage || firstMessage.length < 5) throw badRequest("Message must be at least 5 characters");

  let eligibility = await getTicketEligibility(input.userId);
  // Help Center "Ask AI → Contact a real person" can be configured to always
  // be free, independent of the general ticket eligibility/cost config
  // (Feature 2 §6 — admin can set the Help Center fallback free for all).
  if (input.source === "help_center_ai" && manifest.helpCenterSettings.aiFreeForAll) {
    eligibility = { freeAccess: true, costCredits: 0, costStars: 0, blocked: false };
  }

  if (!eligibility.freeAccess && eligibility.blocked) {
    throw forbidden("Support tickets are not available on your current plan.", "SUPPORT_ACCESS_DENIED");
  }

  const shouldCharge =
    !eligibility.freeAccess &&
    shouldChargeMessage(manifest.support.chargingModel, manifest.support.chargingX, 1);

  const orm = await getDb();
  const ticket = await orm.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.supportTickets)
      .values({
        userId: input.userId,
        subject,
        status: "open",
        priority: "normal",
        isAiHandled: manifest.support.aiTriageEnabled,
        source: input.source ?? "ticket",
        sourceHelpDocId: input.sourceHelpDocId ?? null,
      })
      .returning();

    let charge: ChargeResult = { charged: false, chargedCredits: 0, chargedStars: 0 };
    if (shouldCharge) {
      charge = await chargeForMessage(
        input.userId,
        eligibility.costCredits,
        eligibility.costStars,
        `support_ticket:${created.id}:msg:1`,
        tx
      );
    }

    await tx.insert(schema.supportTicketMessages).values({
      ticketId: created.id,
      senderId: input.userId,
      senderType: "user",
      body: firstMessage,
      charged: charge.charged,
      chargedCredits: charge.chargedCredits,
      chargedStars: charge.chargedStars,
    });

    await tx
      .update(schema.supportTickets)
      .set({
        messageCount: 1,
        chargedCredits: charge.chargedCredits,
        chargedStars: charge.chargedStars,
        lastActivityAt: new Date(),
      })
      .where(eq(schema.supportTickets.id, created.id));

    await tx.insert(schema.supportTicketEvents).values({
      ticketId: created.id,
      actorId: input.userId,
      eventType: "created",
      toValue: "open",
      note: charge.charged ? `Charged ${charge.chargedCredits} credits / ${charge.chargedStars} stars` : null,
    });

    return toTicket(created);
  });

  if (manifest.support.aiTriageEnabled) {
    // Best-effort — a failed AI triage attempt just leaves the ticket in the
    // human queue (is_ai_handled stays true but no AI message posted; staff
    // will see message_count=1 and respond normally).
    runAiTriage(ticket.id).catch((err) => {
      logger.error({ err, ticketId: ticket.id }, "[support] AI triage failed");
    });
  } else {
    await notifyStaffOfNewTicket(ticket).catch((err) => {
      logger.error({ err, ticketId: ticket.id }, "[support] Failed to notify staff of new ticket");
    });
  }

  return ticket;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface PostMessageInput {
  ticketId: string;
  userId: string;
  body: string;
}

/** Posts a user message to their own ticket, applying the charging model. */
export async function postUserMessage(input: PostMessageInput): Promise<SupportTicketMessage> {
  await requireFeatureEnabled("supportTickets");
  const manifest = await loadManifest();

  const body = input.body.trim();
  if (!body) throw badRequest("Message cannot be empty");

  const eligibility = await getTicketEligibility(input.userId);

  const orm = await getDb();
  const message = await orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(schema.supportTickets)
      .where(
        and(
          eq(schema.supportTickets.id, input.ticketId),
          eq(schema.supportTickets.userId, input.userId),
          isNull(schema.supportTickets.deletedAt)
        )
      )
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");
    const ticket = toTicket(ticketRow);
    if (ticket.status === "closed") throw conflict("This ticket is closed. Open a new ticket for further help.");

    const messageIndex = ticket.message_count + 1;
    const needsCharge =
      !eligibility.freeAccess && shouldChargeMessage(manifest.support.chargingModel, manifest.support.chargingX, messageIndex);

    let charge: ChargeResult = { charged: false, chargedCredits: 0, chargedStars: 0 };
    if (needsCharge) {
      if (eligibility.blocked) {
        throw forbidden("Support tickets are not available on your current plan.", "SUPPORT_ACCESS_DENIED");
      }
      charge = await chargeForMessage(
        input.userId,
        eligibility.costCredits,
        eligibility.costStars,
        `support_ticket:${ticket.id}:msg:${messageIndex}`,
        tx
      );
    }

    const [msgRow] = await tx
      .insert(schema.supportTicketMessages)
      .values({
        ticketId: ticket.id,
        senderId: input.userId,
        senderType: "user",
        body,
        charged: charge.charged,
        chargedCredits: charge.chargedCredits,
        chargedStars: charge.chargedStars,
      })
      .returning();

    // Reopen a resolved/pending ticket when the user replies.
    const newStatus: TicketStatus = ticket.status === "resolved" ? "open" : ticket.status;

    await tx
      .update(schema.supportTickets)
      .set({
        messageCount: messageIndex,
        status: newStatus,
        chargedCredits: sql`${schema.supportTickets.chargedCredits} + ${charge.chargedCredits}`,
        chargedStars: sql`${schema.supportTickets.chargedStars} + ${charge.chargedStars}`,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.supportTickets.id, ticket.id));

    await tx.insert(schema.supportTicketEvents).values({
      ticketId: ticket.id,
      actorId: input.userId,
      eventType: "message_added",
      note: charge.charged ? `Charged ${charge.chargedCredits} credits / ${charge.chargedStars} stars` : null,
    });

    return toMessage(msgRow);
  });

  return message;
}

/**
 * Posts a staff (human) reply. No charging — staff replies are always free.
 */
export async function postStaffMessage(ticketId: string, staffUserId: string, body: string): Promise<SupportTicketMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw badRequest("Message cannot be empty");

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.id, ticketId), isNull(schema.supportTickets.deletedAt)))
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");
    const ticket = toTicket(ticketRow);

    const messageIndex = ticket.message_count + 1;
    const [msgRow] = await tx
      .insert(schema.supportTicketMessages)
      .values({ ticketId: ticket.id, senderId: staffUserId, senderType: "staff", body: trimmed })
      .returning();

    await tx
      .update(schema.supportTickets)
      .set({ messageCount: messageIndex, status: "pending", lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.supportTickets.id, ticket.id));

    await tx.insert(schema.supportTicketEvents).values({
      ticketId: ticket.id,
      actorId: staffUserId,
      eventType: "message_added",
      note: "staff reply",
    });

    await insertNotificationBatch(
      tx,
      [ticket.user_id],
      "support_ticket_reply",
      "New reply on your support ticket",
      trimmed.slice(0, 140),
      { ticketId: ticket.id }
    ).catch(() => {});

    return toMessage(msgRow);
  });
}

// ---------------------------------------------------------------------------
// AI triage
// ---------------------------------------------------------------------------

const AI_TRIAGE_SYSTEM_PROMPT =
  "You are a helpful, concise customer support assistant for Zobia Social, a gamified social " +
  "platform with coins, stars, rooms, gifts, and creator tools. Answer the user's support " +
  "ticket as best you can using only what they've told you. Keep it under 150 words, be " +
  "friendly and direct, and if you are not confident you've solved their problem, say so " +
  "plainly and suggest they ask for a human.";

/** Runs AI triage on a newly created ticket and posts the AI's response as the first reply. */
export async function runAiTriage(ticketId: string): Promise<void> {
  const orm = await getDb();
  const [first] = await orm
    .select({ subject: schema.supportTickets.subject, body: schema.supportTicketMessages.body })
    .from(schema.supportTickets)
    .innerJoin(
      schema.supportTicketMessages,
      and(eq(schema.supportTicketMessages.ticketId, schema.supportTickets.id), eq(schema.supportTicketMessages.senderType, "user"))
    )
    .where(eq(schema.supportTickets.id, ticketId))
    .orderBy(asc(schema.supportTicketMessages.createdAt))
    .limit(1);
  if (!first) return;

  let aiText: string;
  try {
    const response = await aiClient.chat(
      [
        { role: "system", content: AI_TRIAGE_SYSTEM_PROMPT },
        { role: "user", content: `Subject: ${first.subject}\n\n${first.body}` },
      ],
      { maxTokens: 400 }
    );
    aiText = response.content.trim();
  } catch (err) {
    logger.error({ err, ticketId }, "[support] AI triage completion failed");
    return;
  }
  if (!aiText) return;

  await orm.transaction(async (tx) => {
    await tx.insert(schema.supportTicketMessages).values({ ticketId, senderType: "ai", body: aiText });
    await tx
      .update(schema.supportTickets)
      .set({
        messageCount: sql`${schema.supportTickets.messageCount} + 1`,
        aiResolved: true,
        lastActivityAt: new Date(),
      })
      .where(eq(schema.supportTickets.id, ticketId));
    await tx.insert(schema.supportTicketEvents).values({
      ticketId,
      eventType: "ai_response",
      note: "AI triage response posted",
    });
  });
}

/** User rejects the AI's answer ("talk to a real person") — routes to the human queue. */
export async function rejectAiTriage(ticketId: string, userId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select({ id: schema.supportTickets.id })
      .from(schema.supportTickets)
      .where(
        and(
          eq(schema.supportTickets.id, ticketId),
          eq(schema.supportTickets.userId, userId),
          isNull(schema.supportTickets.deletedAt)
        )
      )
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");

    await tx
      .update(schema.supportTickets)
      .set({ aiResolved: false, status: "open", updatedAt: new Date() })
      .where(eq(schema.supportTickets.id, ticketId));
    await tx.insert(schema.supportTicketEvents).values({
      ticketId,
      actorId: userId,
      eventType: "ai_rejected",
      note: "User requested a human",
    });
  });

  await notifyStaffOfNewTicket(await getTicketByIdInternal(ticketId)).catch(() => {});
}

async function getTicketByIdInternal(ticketId: string): Promise<SupportTicket> {
  const orm = await getDb();
  const [row] = await orm.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
  if (!row) throw notFound("Ticket not found");
  return toTicket(row);
}

async function notifyStaffOfNewTicket(ticket: SupportTicket): Promise<void> {
  const manifest = await loadManifest();
  const orm = await getDb();
  const wantAdmin = manifest.support.staffRoles.includes("admin");
  const wantModerator = manifest.support.staffRoles.includes("moderator");
  const wantSupport = manifest.support.staffRoles.includes("support");
  const rows = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        isNull(schema.users.deletedAt),
        or(
          wantAdmin ? eq(schema.users.isAdmin, true) : sql`false`,
          wantModerator ? eq(schema.users.isModerator, true) : sql`false`,
          wantSupport ? eq(schema.users.isSupport, true) : sql`false`
        )
      )
    )
    .limit(500);
  const staffIds = rows.map((r) => r.id);
  if (staffIds.length === 0) return;
  await insertNotificationBatch(
    orm,
    staffIds,
    "support_ticket_new",
    "New support ticket needs a response",
    ticket.subject,
    { ticketId: ticket.id }
  );
}

// ---------------------------------------------------------------------------
// Assignment & escalation
// ---------------------------------------------------------------------------

/**
 * Pure escalation-permission decision — kept separate from the DB/transaction
 * plumbing in escalateTicket() so the rules are unit-testable without mocking
 * the database.
 *
 * Enforced escalation path:
 *  - Both actor and target must hold a role in the admin-configured
 *    staffRoles allow-list.
 *  - Regular support (not senior, not mod/admin) may escalate to any
 *    senior-support-flagged user (support/moderator/admin) or to any admin.
 *  - Senior support who is not a moderator/admin may escalate only to an admin.
 *  - Moderators/admins may escalate to any eligible staff member.
 */
export function canEscalate(actorRoles: StaffRoles, targetRoles: StaffRoles, staffRoles: string[]): { allowed: true } | { allowed: false; reason: string } {
  if (!hasAnyRole(actorRoles, staffRoles)) {
    return { allowed: false, reason: "You are not authorized to work support tickets." };
  }
  if (!hasAnyRole(targetRoles, staffRoles)) {
    return { allowed: false, reason: "Escalation target is not a support staff member." };
  }

  const actorIsSeniorOrAbove = actorRoles.isAdmin || actorRoles.isModerator || actorRoles.isSeniorSupport;
  if (!actorIsSeniorOrAbove) {
    if (!targetRoles.isSeniorSupport && !targetRoles.isAdmin) {
      return { allowed: false, reason: "Escalate to a senior support member or an admin." };
    }
  } else if (actorRoles.isSeniorSupport && !actorRoles.isAdmin && !actorRoles.isModerator) {
    if (!targetRoles.isAdmin) {
      return { allowed: false, reason: "As senior support, you can only escalate further to an admin." };
    }
  }

  return { allowed: true };
}

/**
 * Escalates a ticket to a specific staff member. See canEscalate() for the
 * permission rules.
 */
export async function escalateTicket(ticketId: string, actorId: string, targetUserId: string): Promise<void> {
  const manifest = await loadManifest();
  const [actorRoles, targetRoles] = await Promise.all([getStaffRoles(actorId), getStaffRoles(targetUserId)]);

  const decision = canEscalate(actorRoles, targetRoles, manifest.support.staffRoles);
  if (!decision.allowed) {
    throw forbidden(decision.reason);
  }

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.id, ticketId), isNull(schema.supportTickets.deletedAt)))
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");
    const ticket = toTicket(ticketRow);

    await tx
      .update(schema.supportTickets)
      .set({ assignedTo: targetUserId, status: "escalated", updatedAt: new Date() })
      .where(eq(schema.supportTickets.id, ticketId));
    await tx.insert(schema.supportTicketEvents).values({
      ticketId,
      actorId,
      eventType: "escalated",
      fromValue: ticket.assigned_to ?? "",
      toValue: targetUserId,
    });

    await insertNotificationBatch(
      tx,
      [targetUserId],
      "support_ticket_escalated",
      "A ticket was escalated to you",
      ticket.subject,
      { ticketId }
    ).catch(() => {});
  });
}

/** Self-assign or admin-assign a ticket to a staff member. */
export async function assignTicket(ticketId: string, actorId: string, targetUserId: string): Promise<void> {
  const manifest = await loadManifest();
  const [actorRoles, targetRoles] = await Promise.all([getStaffRoles(actorId), getStaffRoles(targetUserId)]);

  if (!hasAnyRole(actorRoles, manifest.support.staffRoles)) {
    throw forbidden("You are not authorized to work support tickets.");
  }
  if (!hasAnyRole(targetRoles, manifest.support.staffRoles)) {
    throw badRequest("Assignment target is not a support staff member.");
  }

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.id, ticketId), isNull(schema.supportTickets.deletedAt)))
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");
    const ticket = toTicket(ticketRow);

    await tx
      .update(schema.supportTickets)
      .set({ assignedTo: targetUserId, updatedAt: new Date() })
      .where(eq(schema.supportTickets.id, ticketId));
    await tx.insert(schema.supportTicketEvents).values({
      ticketId,
      actorId,
      eventType: "assigned",
      fromValue: ticket.assigned_to ?? "",
      toValue: targetUserId,
    });
  });
}

export async function setTicketStatus(ticketId: string, actorId: string, status: TicketStatus): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.id, ticketId), isNull(schema.supportTickets.deletedAt)))
      .for("update");
    if (!ticketRow) throw notFound("Ticket not found");
    const ticket = toTicket(ticketRow);

    await tx
      .update(schema.supportTickets)
      .set({
        status,
        resolvedAt: status === "resolved" ? new Date() : undefined,
        closedAt: status === "closed" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.supportTickets.id, ticketId));
    await tx.insert(schema.supportTicketEvents).values({
      ticketId,
      actorId,
      eventType: "status_changed",
      fromValue: ticket.status,
      toValue: status,
    });
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listUserTickets(userId: string): Promise<SupportTicket[]> {
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.userId, userId), isNull(schema.supportTickets.deletedAt)))
    .orderBy(desc(schema.supportTickets.lastActivityAt))
    .limit(100);
  return rows.map(toTicket);
}

/** Fetches a ticket + its messages for the OWNING user only (IDOR guard). */
export async function getTicketForUser(ticketId: string, userId: string): Promise<{ ticket: SupportTicket; messages: SupportTicketMessage[] }> {
  const orm = await getDb();
  const [ticketRow] = await orm
    .select()
    .from(schema.supportTickets)
    .where(
      and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.userId, userId), isNull(schema.supportTickets.deletedAt))
    )
    .limit(1);
  if (!ticketRow) throw notFound("Ticket not found");
  const messages = await orm
    .select()
    .from(schema.supportTicketMessages)
    .where(eq(schema.supportTicketMessages.ticketId, ticketId))
    .orderBy(asc(schema.supportTicketMessages.createdAt));
  return { ticket: toTicket(ticketRow), messages: messages.map(toMessage) };
}

/** Fetches a ticket + its messages for STAFF — access gated by staffRoles config, checked by the caller. */
export async function getTicketForStaff(ticketId: string): Promise<{ ticket: SupportTicket; messages: SupportTicketMessage[] }> {
  const orm = await getDb();
  const [ticketRow] = await orm
    .select()
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.id, ticketId), isNull(schema.supportTickets.deletedAt)))
    .limit(1);
  if (!ticketRow) throw notFound("Ticket not found");
  const messages = await orm
    .select()
    .from(schema.supportTicketMessages)
    .where(eq(schema.supportTicketMessages.ticketId, ticketId))
    .orderBy(asc(schema.supportTicketMessages.createdAt));
  return { ticket: toTicket(ticketRow), messages: messages.map(toMessage) };
}

export interface QueueFilters {
  status?: TicketStatus;
  assignedTo?: string;
  cursor?: string;
  limit?: number;
}

export async function listQueue(filters: QueueFilters): Promise<SupportTicket[]> {
  const orm = await getDb();
  const conditions = [isNull(schema.supportTickets.deletedAt)];
  if (filters.status) conditions.push(eq(schema.supportTickets.status, filters.status));
  if (filters.assignedTo) conditions.push(eq(schema.supportTickets.assignedTo, filters.assignedTo));
  if (filters.cursor) conditions.push(lt(schema.supportTickets.lastActivityAt, new Date(filters.cursor)));

  const limit = Math.min(filters.limit ?? 50, 100);
  const rows = await orm
    .select()
    .from(schema.supportTickets)
    .where(and(...conditions))
    .orderBy(desc(schema.supportTickets.lastActivityAt))
    .limit(limit);
  return rows.map(toTicket);
}

/**
 * Auto-closes tickets that have sat in 'resolved' status for `staleDays`
 * with no further activity — periodic housekeeping (see
 * app/api/cron/support-tickets/route.ts). Idempotent: only affects rows
 * still 'resolved', so re-running the same day is a safe no-op for
 * already-closed tickets.
 */
export async function autoCloseStaleResolvedTickets(staleDays = 7): Promise<number> {
  const orm = await getDb();
  const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const closedRows = await orm
    .update(schema.supportTickets)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.supportTickets.status, "resolved"),
        isNull(schema.supportTickets.deletedAt),
        lt(schema.supportTickets.lastActivityAt, staleBefore)
      )
    )
    .returning({ id: schema.supportTickets.id });

  if (closedRows.length > 0) {
    await orm.insert(schema.supportTicketEvents).values(
      closedRows.map((row) => ({
        ticketId: row.id,
        eventType: "status_changed",
        fromValue: "resolved",
        toValue: "closed",
        note: "Auto-closed: no activity",
      }))
    );
  }
  return closedRows.length;
}

export { ApiError };
