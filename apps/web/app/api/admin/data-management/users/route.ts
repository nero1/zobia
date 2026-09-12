export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/data-management/users
 *
 * Admin-driven single-user creation. Mirrors the OAuth insert defaults from
 * app/api/auth/google/callback/route.ts (onboarding_completed=false,
 * is_admin=false always) — there is no email/password signup flow in this
 * app, so this is the only way an admin can hand-create an account.
 *
 * Password is optional: if the admin sets one, it is hashed with bcrypt
 * (same BCRYPT_ROUNDS as app/api/auth/pin/setup/route.ts). If omitted,
 * password_hash stays NULL — same as a fresh OAuth-only account — and the
 * admin can force a reset afterward via the existing `reset_password`
 * action (app/api/admin/users/[userId]/actions/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";

// Matches lib/auth pin setup's cost factor — see app/api/auth/pin/setup/route.ts.
const BCRYPT_ROUNDS = 12;

const createUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/i, "Username may only contain letters, numbers, and underscores"),
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(50).optional(),
  password: z.string().min(8).max(200).optional(),
  plan: z.enum(["free", "plus", "pro", "max"]).optional(),
  isEmailVerified: z.boolean().optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createUserSchema);

    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1 OR ($2::text IS NOT NULL AND email = $2) LIMIT 1`,
      [body.username, body.email ?? null]
    );
    if (existing[0]) throw conflict("A user with that username or email already exists.");

    const passwordHash = body.password ? await bcrypt.hash(body.password, BCRYPT_ROUNDS) : null;

    const { rows } = await db.query<{ id: string; username: string; email: string | null }>(
      `INSERT INTO users
         (username, email, display_name, password_hash, plan, is_email_verified,
          onboarding_completed, is_admin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, false, NOW(), NOW())
       RETURNING id, username, email`,
      [
        body.username,
        body.email ?? null,
        body.displayName ?? body.username,
        passwordHash,
        body.plan ?? "free",
        body.isEmailVerified ?? false,
      ]
    );

    const created = rows[0];

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_create_user",
      targetId: created.id,
      metadata: { username: created.username, hasPassword: !!passwordHash },
    });

    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") return handleApiError(conflict("A user with that username or email already exists."));
    return handleApiError(err);
  }
});
