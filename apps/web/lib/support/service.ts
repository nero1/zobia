/**
 * lib/support/service.ts
 *
 * Support Ticket System — eligibility, charging, creation, messaging,
 * assignment/escalation, and AI triage. Mirrors lib/forum/service.ts's
 * "feature flag → eligibility → (optional) charge → atomic write" shape.
 *
 * Escalation is modeled as ticket state (status/assigned_to) plus an
 * append-only support_ticket_events audit log — no separate escalation
 * table (see 0033_support_tickets.sql).
 *
 * @module lib/support/service
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
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
  tx: TransactionClient
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

  const ticket = await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `INSERT INTO support_tickets
         (user_id, subject, status, priority, is_ai_handled, source, source_help_doc_id)
       VALUES ($1, $2, 'open', 'normal', $3, $4, $5)
       RETURNING *`,
      [
        input.userId,
        subject,
        manifest.support.aiTriageEnabled,
        input.source ?? "ticket",
        input.sourceHelpDocId ?? null,
      ]
    );
    const created = rows[0];

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

    await tx.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, body, charged, charged_credits, charged_stars)
       VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
      [created.id, input.userId, firstMessage, charge.charged, charge.chargedCredits, charge.chargedStars]
    );

    await tx.query(
      `UPDATE support_tickets
       SET message_count = 1, charged_credits = $2, charged_stars = $3, last_activity_at = NOW()
       WHERE id = $1`,
      [created.id, charge.chargedCredits, charge.chargedStars]
    );

    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, to_value, note)
       VALUES ($1, $2, 'created', 'open', $3)`,
      [created.id, input.userId, charge.charged ? `Charged ${charge.chargedCredits} credits / ${charge.chargedStars} stars` : null]
    );

    return created;
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

  const message = await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [input.ticketId, input.userId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");
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

    const { rows: msgRows } = await tx.query<SupportTicketMessage>(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, body, charged, charged_credits, charged_stars)
       VALUES ($1, $2, 'user', $3, $4, $5, $6)
       RETURNING *`,
      [ticket.id, input.userId, body, charge.charged, charge.chargedCredits, charge.chargedStars]
    );

    // Reopen a resolved/pending ticket when the user replies.
    const newStatus: TicketStatus = ticket.status === "resolved" ? "open" : ticket.status;

    await tx.query(
      `UPDATE support_tickets
       SET message_count = $2, status = $3,
           charged_credits = charged_credits + $4, charged_stars = charged_stars + $5,
           last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [ticket.id, messageIndex, newStatus, charge.chargedCredits, charge.chargedStars]
    );

    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, note)
       VALUES ($1, $2, 'message_added', $3)`,
      [ticket.id, input.userId, charge.charged ? `Charged ${charge.chargedCredits} credits / ${charge.chargedStars} stars` : null]
    );

    return msgRows[0];
  });

  return message;
}

/**
 * Posts a staff (human) reply. No charging — staff replies are always free.
 */
export async function postStaffMessage(ticketId: string, staffUserId: string, body: string): Promise<SupportTicketMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw badRequest("Message cannot be empty");

  return db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const messageIndex = ticket.message_count + 1;
    const { rows: msgRows } = await tx.query<SupportTicketMessage>(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, body)
       VALUES ($1, $2, 'staff', $3)
       RETURNING *`,
      [ticket.id, staffUserId, trimmed]
    );

    await tx.query(
      `UPDATE support_tickets
       SET message_count = $2, status = 'pending', last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [ticket.id, messageIndex]
    );

    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, note) VALUES ($1, $2, 'message_added', 'staff reply')`,
      [ticket.id, staffUserId]
    );

    await insertNotificationBatch(
      tx,
      [ticket.user_id],
      "support_ticket_reply",
      "New reply on your support ticket",
      trimmed.slice(0, 140),
      { ticketId: ticket.id }
    ).catch(() => {});

    return msgRows[0];
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
  const { rows } = await db.query<{ subject: string; body: string }>(
    `SELECT t.subject, m.body
     FROM support_tickets t
     JOIN support_ticket_messages m ON m.ticket_id = t.id AND m.sender_type = 'user'
     WHERE t.id = $1
     ORDER BY m.created_at ASC LIMIT 1`,
    [ticketId]
  );
  const first = rows[0];
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

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, body) VALUES ($1, 'ai', $2)`,
      [ticketId, aiText]
    );
    await tx.query(
      `UPDATE support_tickets SET message_count = message_count + 1, ai_resolved = true, last_activity_at = NOW() WHERE id = $1`,
      [ticketId]
    );
    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, note) VALUES ($1, 'ai_response', 'AI triage response posted')`,
      [ticketId]
    );
  });
}

/** User rejects the AI's answer ("talk to a real person") — routes to the human queue. */
export async function rejectAiTriage(ticketId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [ticketId, userId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    await tx.query(
      `UPDATE support_tickets SET ai_resolved = false, status = 'open', updated_at = NOW() WHERE id = $1`,
      [ticketId]
    );
    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, note) VALUES ($1, $2, 'ai_rejected', 'User requested a human')`,
      [ticketId, userId]
    );
  });

  await notifyStaffOfNewTicket(await getTicketByIdInternal(ticketId)).catch(() => {});
}

async function getTicketByIdInternal(ticketId: string): Promise<SupportTicket> {
  const { rows } = await db.query<SupportTicket>(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
  if (!rows[0]) throw notFound("Ticket not found");
  return rows[0];
}

async function notifyStaffOfNewTicket(ticket: SupportTicket): Promise<void> {
  const manifest = await loadManifest();
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users
     WHERE deleted_at IS NULL
       AND (
         (is_admin = true AND $1::boolean)
         OR (is_moderator = true AND $2::boolean)
         OR (is_support = true AND $3::boolean)
       )
     LIMIT 500`,
    [
      manifest.support.staffRoles.includes("admin"),
      manifest.support.staffRoles.includes("moderator"),
      manifest.support.staffRoles.includes("support"),
    ]
  );
  const staffIds = rows.map((r) => r.id);
  if (staffIds.length === 0) return;
  await insertNotificationBatch(
    db,
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

  await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    await tx.query(
      `UPDATE support_tickets SET assigned_to = $2, status = 'escalated', updated_at = NOW() WHERE id = $1`,
      [ticketId, targetUserId]
    );
    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
       VALUES ($1, $2, 'escalated', $3, $4)`,
      [ticketId, actorId, ticket.assigned_to ?? "", targetUserId]
    );

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

  await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    await tx.query(`UPDATE support_tickets SET assigned_to = $2, updated_at = NOW() WHERE id = $1`, [ticketId, targetUserId]);
    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, from_value, to_value) VALUES ($1, $2, 'assigned', $3, $4)`,
      [ticketId, actorId, ticket.assigned_to ?? "", targetUserId]
    );
  });
}

export async function setTicketStatus(ticketId: string, actorId: string, status: TicketStatus): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const resolvedAt = status === "resolved" ? "NOW()" : "resolved_at";
    const closedAt = status === "closed" ? "NOW()" : "closed_at";
    await tx.query(
      `UPDATE support_tickets SET status = $2, resolved_at = ${resolvedAt}, closed_at = ${closedAt}, updated_at = NOW() WHERE id = $1`,
      [ticketId, status]
    );
    await tx.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, from_value, to_value) VALUES ($1, $2, 'status_changed', $3, $4)`,
      [ticketId, actorId, ticket.status, status]
    );
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listUserTickets(userId: string): Promise<SupportTicket[]> {
  const { rows } = await db.query<SupportTicket>(
    `SELECT * FROM support_tickets WHERE user_id = $1 AND deleted_at IS NULL ORDER BY last_activity_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

/** Fetches a ticket + its messages for the OWNING user only (IDOR guard). */
export async function getTicketForUser(ticketId: string, userId: string): Promise<{ ticket: SupportTicket; messages: SupportTicketMessage[] }> {
  const { rows } = await db.query<SupportTicket>(
    `SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [ticketId, userId]
  );
  const ticket = rows[0];
  if (!ticket) throw notFound("Ticket not found");
  const { rows: messages } = await db.query<SupportTicketMessage>(
    `SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  );
  return { ticket, messages };
}

/** Fetches a ticket + its messages for STAFF — access gated by staffRoles config, checked by the caller. */
export async function getTicketForStaff(ticketId: string): Promise<{ ticket: SupportTicket; messages: SupportTicketMessage[] }> {
  const { rows } = await db.query<SupportTicket>(`SELECT * FROM support_tickets WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [ticketId]);
  const ticket = rows[0];
  if (!ticket) throw notFound("Ticket not found");
  const { rows: messages } = await db.query<SupportTicketMessage>(
    `SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  );
  return { ticket, messages };
}

export interface QueueFilters {
  status?: TicketStatus;
  assignedTo?: string;
  cursor?: string;
  limit?: number;
}

export async function listQueue(filters: QueueFilters): Promise<SupportTicket[]> {
  const conditions: string[] = ["deleted_at IS NULL"];
  const params: import("@/lib/db/interface").SqlParam[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`assigned_to = $${params.length}`);
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    conditions.push(`last_activity_at < $${params.length}::timestamptz`);
  }

  const limit = Math.min(filters.limit ?? 50, 100);
  params.push(limit);

  const { rows } = await db.query<SupportTicket>(
    `SELECT * FROM support_tickets WHERE ${conditions.join(" AND ")} ORDER BY last_activity_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Auto-closes tickets that have sat in 'resolved' status for `staleDays`
 * with no further activity — periodic housekeeping (see
 * app/api/cron/support-tickets/route.ts). Idempotent: only affects rows
 * still 'resolved', so re-running the same day is a safe no-op for
 * already-closed tickets.
 */
export async function autoCloseStaleResolvedTickets(staleDays = 7): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE support_tickets
     SET status = 'closed', closed_at = NOW(), updated_at = NOW()
     WHERE status = 'resolved'
       AND deleted_at IS NULL
       AND last_activity_at < NOW() - ($1 || ' days')::interval`,
    [staleDays]
  );
  if (rowCount && rowCount > 0) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM support_tickets WHERE status = 'closed' AND closed_at >= NOW() - interval '1 minute'`
    );
    for (const row of rows) {
      await db.query(
        `INSERT INTO support_ticket_events (ticket_id, event_type, from_value, to_value, note) VALUES ($1, 'status_changed', 'resolved', 'closed', 'Auto-closed: no activity')`,
        [row.id]
      );
    }
  }
  return rowCount ?? 0;
}

export { ApiError };
