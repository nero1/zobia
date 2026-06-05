/**
 * app/api/classroom/[roomId]/certificate/route.ts
 *
 * POST /api/classroom/:roomId/certificate
 *
 * Issue a Learning Certificate to an enrolled student who has completed the course.
 *
 * Requirements:
 *  - Caller must be the room creator.
 *  - Creator must have Knowledge Track Level 50+ (PRD §7 — Knowledge L50 "The Scholar").
 *  - Target user must have an enrolment record for this classroom.
 *  - Certificate is idempotent: if one already exists, returns it.
 *
 * On success:
 *  - Creates a learning_certificates record.
 *  - Creates an in-app notification for the recipient.
 *  - Awards 100 Knowledge Track XP to the recipient.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getTrackLevelForXP } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Creator must be at this Knowledge Track level to issue certificates (PRD §7 — Knowledge L50). */
const MIN_KNOWLEDGE_LEVEL = 50;

/** XP awarded to the certificate recipient. */
const CERTIFICATE_RECIPIENT_XP = 100;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const issueCertificateSchema = z.object({
  /** The user ID of the student to certify. */
  recipientUserId: z.string().uuid(),
  /** Optional custom certificate title (defaults to room name). */
  title: z.string().max(200).optional(),
  /** Optional note from the creator. */
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ClassroomRow {
  id: string;
  name: string;
  type: string;
  creator_id: string;
  is_active: boolean;
}

interface CreatorXpRow {
  xp_knowledge: number;
}

// ---------------------------------------------------------------------------
// POST /api/classroom/[roomId]/certificate
// ---------------------------------------------------------------------------

/**
 * Issue a Learning Certificate to a student.
 *
 * Only the classroom creator may issue certificates, and they must have
 * reached Knowledge Track Level 25.
 *
 * @param req    - Incoming request with recipientUserId in body
 * @param params - Route params containing roomId
 * @returns Certificate record with status 201 (or existing record if idempotent)
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const callerId = auth.user.sub;
    const body = await validateBody(req, issueCertificateSchema);

    // Fetch classroom room
    const { rows: roomRows } = await db.query<ClassroomRow>(
      `SELECT id, name, type, creator_id, is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Classroom room not found");
    if (room.type !== "classroom") {
      throw badRequest("Certificates can only be issued for classroom rooms");
    }

    // Verify caller is the room creator
    if (room.creator_id !== callerId) {
      throw forbidden("Only the room creator can issue certificates");
    }

    // Verify creator meets Knowledge Track Level 25 requirement
    const { rows: xpRows } = await db.query<CreatorXpRow>(
      `SELECT xp_knowledge FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [callerId]
    );
    const creatorXp = xpRows[0];
    if (!creatorXp) throw notFound("Creator not found");

    const knowledgeLevel = getTrackLevelForXP(
      "knowledge",
      creatorXp.xp_knowledge
    ).level;

    if (knowledgeLevel < MIN_KNOWLEDGE_LEVEL) {
      throw forbidden(
        `You must reach Knowledge Track Level ${MIN_KNOWLEDGE_LEVEL} to issue certificates. ` +
          `Your current level is ${knowledgeLevel}.`
      );
    }

    // Verify recipient is enrolled
    const { rows: enrolRows } = await db.query<{ id: string }>(
      `SELECT id FROM classroom_enrolments
       WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, body.recipientUserId]
    );
    if (enrolRows.length === 0) {
      throw forbidden("The recipient is not enrolled in this classroom");
    }

    // Idempotency: check for existing certificate
    const { rows: existingRows } = await db.query<{ id: string; issued_at: string }>(
      `SELECT id, issued_at FROM learning_certificates
       WHERE room_id = $1 AND recipient_user_id = $2 LIMIT 1`,
      [roomId, body.recipientUserId]
    );
    if (existingRows.length > 0) {
      return NextResponse.json(
        { certificate: existingRows[0], alreadyIssued: true },
        { status: 200 }
      );
    }

    // Fetch recipient display name for certificate
    const { rows: recipientRows } = await db.query<{
      display_name: string;
      username: string;
    }>(
      `SELECT display_name, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [body.recipientUserId]
    );
    const recipient = recipientRows[0];
    if (!recipient) throw notFound("Recipient user not found");

    const certificateTitle = body.title ?? `${room.name} — Learning Certificate`;

    const certificate = await db.transaction(async (tx) => {
      // Create certificate record
      const { rows: certRows } = await tx.query(
        `INSERT INTO learning_certificates
           (room_id, recipient_user_id, issuer_user_id, title, note, issued_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [
          roomId,
          body.recipientUserId,
          callerId,
          certificateTitle,
          body.note ?? null,
        ]
      );
      const cert = certRows[0];
      if (!cert) throw new Error("Certificate creation failed");

      // Award Knowledge Track XP to recipient
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1,
             xp_knowledge = xp_knowledge + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [CERTIFICATE_RECIPIENT_XP, body.recipientUserId]
      );

      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, reference_id, multiplier, base_amount)
         VALUES ($1, $2, 'knowledge', 'room', $3, 100, $2)`,
        [body.recipientUserId, CERTIFICATE_RECIPIENT_XP, roomId]
      );

      // Create in-app notification for the recipient
      await tx.query(
        `INSERT INTO notifications
           (user_id, notification_type, title, body, reference_id, metadata)
         VALUES ($1, 'certificate_issued', $2, $3, $4, $5)`,
        [
          body.recipientUserId,
          "Certificate Issued!",
          `Congratulations! You've received a Learning Certificate for "${room.name}".`,
          cert.id,
          JSON.stringify({
            roomId,
            roomName: room.name,
            issuerId: callerId,
            certificateTitle,
          }),
        ]
      );

      return cert;
    });

    return NextResponse.json(
      {
        certificate,
        xpAwarded: CERTIFICATE_RECIPIENT_XP,
        recipientUsername: recipient.username,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
