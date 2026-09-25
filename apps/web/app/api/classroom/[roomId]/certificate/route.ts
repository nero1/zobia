export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/certificate/route.ts
 *
 * POST /api/classroom/:roomId/certificate
 *
 * Issue a Learning Certificate to an enrolled student who has completed the course.
 *
 * Requirements:
 *  - Caller must be the room creator.
 *  - Creator must have Knowledge Track Level 25+ (PRD §7 — Knowledge L25).
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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { insertNotification } from "@/lib/notifications/insert";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Creator must be at this Knowledge Track level to issue certificates (PRD §7 — Knowledge L25). */
const MIN_KNOWLEDGE_LEVEL = 25;

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

    const orm = await getDb();

    // Fetch classroom room
    const [room] = await orm
      .select({
        id: schema.rooms.id,
        name: schema.rooms.name,
        type: schema.rooms.type,
        creatorId: schema.rooms.creatorId,
        isActive: schema.rooms.isActive,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.isActive) throw notFound("Classroom room not found");
    if (room.type !== "classroom") {
      throw badRequest("Certificates can only be issued for classroom rooms");
    }

    // Verify caller is the room creator
    if (room.creatorId !== callerId) {
      throw forbidden("Only the room creator can issue certificates");
    }

    // Verify creator meets Knowledge Track Level 25 requirement
    const [creatorXp] = await orm
      .select({ xpKnowledge: schema.users.xpKnowledge })
      .from(schema.users)
      .where(and(eq(schema.users.id, callerId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!creatorXp) throw notFound("Creator not found");

    const knowledgeLevel = getTrackLevelForXP(
      "knowledge",
      Number(creatorXp.xpKnowledge)
    ).level;

    if (knowledgeLevel < MIN_KNOWLEDGE_LEVEL) {
      throw forbidden(
        `You must reach Knowledge Track Level ${MIN_KNOWLEDGE_LEVEL} to issue certificates. ` +
          `Your current level is ${knowledgeLevel}.`
      );
    }

    // Verify recipient is enrolled
    const [enrolment] = await orm
      .select({ id: schema.classroomEnrolments.id })
      .from(schema.classroomEnrolments)
      .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, body.recipientUserId)))
      .limit(1);
    if (!enrolment) {
      throw forbidden("The recipient is not enrolled in this classroom");
    }

    // Idempotency: check for existing certificate
    const [existing] = await orm
      .select({ id: schema.learningCertificates.id, issuedAt: schema.learningCertificates.issuedAt })
      .from(schema.learningCertificates)
      .where(and(eq(schema.learningCertificates.roomId, roomId), eq(schema.learningCertificates.recipientUserId, body.recipientUserId)))
      .limit(1);
    if (existing) {
      return NextResponse.json(
        { certificate: { id: existing.id, issued_at: existing.issuedAt }, alreadyIssued: true },
        { status: 200 }
      );
    }

    // Fetch recipient display name and email for certificate + email delivery
    const [recipient] = await orm
      .select({
        displayName: schema.users.displayName,
        username: schema.users.username,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, body.recipientUserId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!recipient) throw notFound("Recipient user not found");

    const certificateTitle = body.title ?? `${room.name} — Learning Certificate`;

    const certificate = await orm.transaction(async (tx) => {
      // Create certificate record
      const [cert] = await tx
        .insert(schema.learningCertificates)
        .values({
          roomId,
          recipientUserId: body.recipientUserId,
          issuerUserId: callerId,
          title: certificateTitle,
          note: body.note ?? null,
        })
        .returning();
      if (!cert) throw new Error("Certificate creation failed");

      await tx
        .update(schema.classroomEnrolments)
        .set({ certificateIssued: true, certificateIssuedAt: new Date() })
        .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, body.recipientUserId)));

      // Create in-app notification for the recipient
      await insertNotification(
        tx,
        body.recipientUserId,
        "certificate_issued",
        "Certificate Issued!",
        `Congratulations! You've received a Learning Certificate for "${room.name}".`,
        {
          referenceId: cert.id,
          roomId,
          roomName: room.name,
          issuerId: callerId,
          certificateTitle,
        }
      );

      return cert;
    });

    // Knowledge-track XP through the canonical XP path, after the commit. The
    // old inline INSERT wrote a non-existent xp_ledger.multiplier column (so
    // every certificate issue failed) under source 'room', which also
    // collided with the room-join XP idempotency key.
    safeAwardXPFireAndForget(body.recipientUserId, CERTIFICATE_RECIPIENT_XP, "knowledge", "classroom_certificate", roomId);

    // Send certificate email if the recipient has an email address (PRD §10 — fire-and-forget)
    if (recipient.email) {
      const recipientName = recipient.displayName ?? recipient.username ?? "there";
      const issuedDate = new Date().toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });
      import("@/lib/notifications/email").then(({ sendEmail }) =>
        sendEmail(
          recipient.email!,
          `Your Learning Certificate — ${certificateTitle}`,
          `Congratulations, ${recipientName}!\n\nYou have been awarded a Learning Certificate.\n\nCourse: ${certificateTitle}\nIssued by: ${room.name}\nDate: ${issuedDate}\n\nOpen the Zobia app to view and share your certificate.`,
          `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">` +
          `<h2 style="color:#1a1a1a">🎓 Congratulations, ${recipientName}!</h2>` +
          `<p>You have been awarded a <strong>Learning Certificate</strong>.</p>` +
          `<table style="border-collapse:collapse;width:100%;margin:16px 0">` +
          `<tr><td style="padding:8px 0;color:#555;width:120px">Course</td><td style="padding:8px 0;font-weight:600">${certificateTitle}</td></tr>` +
          `<tr><td style="padding:8px 0;color:#555">Issued by</td><td style="padding:8px 0;font-weight:600">${room.name}</td></tr>` +
          `<tr><td style="padding:8px 0;color:#555">Date</td><td style="padding:8px 0;font-weight:600">${issuedDate}</td></tr>` +
          `</table>` +
          `<p style="color:#555">Open the Zobia app to view and share your certificate.</p></div>`,
          "transactional"
        )
      ).catch(() => {});
    }

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
