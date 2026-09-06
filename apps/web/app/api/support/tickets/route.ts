export const dynamic = "force-dynamic";

/**
 * app/api/support/tickets/route.ts
 *
 * GET  /api/support/tickets  — the caller's own tickets ("My Tickets").
 * POST /api/support/tickets  — create a new support ticket.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { createTicket, listUserTickets } from "@/lib/support/service";

const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  firstMessage: z.string().trim().min(5).max(5000),
  source: z.enum(["ticket", "help_center_ai"]).optional(),
  sourceHelpDocId: z.string().uuid().optional().nullable(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const tickets = await listUserTickets(auth.user.sub);
    return NextResponse.json({ success: true, data: tickets, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, createTicketSchema);
    const ticket = await createTicket({
      userId: auth.user.sub,
      subject: body.subject,
      firstMessage: body.firstMessage,
      source: body.source,
      sourceHelpDocId: body.sourceHelpDocId,
    });
    return NextResponse.json({ success: true, data: ticket, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
