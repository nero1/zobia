export const dynamic = 'force-dynamic';

/**
 * app/api/auth/telegram/bot/route.ts
 *
 * POST /api/auth/telegram/bot
 *
 * Telegram Bot webhook handler.
 * Register this URL in BotFather: /setwebhook
 *
 * Handles:
 *  - /start login_{state} — mobile login flow
 *  - Verifies bot token signature via X-Telegram-Bot-Api-Secret-Token header
 *  - On success: upserts user, creates JWT, records approval in telegram_login_states
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  is_admin: boolean;
  onboarding_completed: boolean;
}

// ---------------------------------------------------------------------------
// Auth: verify Telegram secret token header
// ---------------------------------------------------------------------------

function verifyBotSecret(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;
  const incoming = req.headers.get("x-telegram-bot-api-secret-token");
  if (!incoming) return false;
  // Timing-safe comparison to prevent timing oracle attacks (S-03)
  const incomingBuf = Buffer.from(incoming, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (incomingBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(incomingBuf, secretBuf);
}

// ---------------------------------------------------------------------------
// Upsert user from Telegram data
// ---------------------------------------------------------------------------

async function upsertUser(tgUser: TelegramUser): Promise<UserRow> {
  const existing = await db.query<UserRow>(
    `SELECT id, email, username, is_admin, onboarding_completed
     FROM users WHERE telegram_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [String(tgUser.id)]
  );
  if (existing.rows[0]) return existing.rows[0];

  const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
  const inserted = await db.query<UserRow>(
    `INSERT INTO users (telegram_id, display_name, onboarding_completed, is_admin, created_at, updated_at)
     VALUES ($1, $2, false, false, NOW(), NOW())
     RETURNING id, email, username, is_admin, onboarding_completed`,
    [String(tgUser.id), displayName]
  );
  if (!inserted.rows[0]) throw new Error("Failed to create user");
  return inserted.rows[0];
}

// ---------------------------------------------------------------------------
// POST /api/auth/telegram/bot
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyBotSecret(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // Always 200 to Telegram
  }

  const message = update.message;
  if (!message?.from || !message.text) {
    return NextResponse.json({ ok: true });
  }

  const text = message.text.trim();

  // Handle /start login_{state} command
  const startMatch = text.match(/^\/start login_([a-f0-9]{8,64})$/i);
  if (!startMatch) {
    return NextResponse.json({ ok: true });
  }

  const state = startMatch[1];

  try {
    // Verify state exists and is still pending
    const { rows: stateRows } = await db.query<{ status: string; created_at: string }>(
      `SELECT status, created_at FROM telegram_login_states WHERE state = $1 LIMIT 1`,
      [state]
    );

    if (!stateRows[0] || stateRows[0].status !== "pending") {
      return NextResponse.json({ ok: true });
    }

    const age = Date.now() - new Date(stateRows[0].created_at).getTime();
    if (age > 5 * 60 * 1000) {
      await db.query(
        `UPDATE telegram_login_states SET status = 'expired', updated_at = NOW() WHERE state = $1`,
        [state]
      );
      return NextResponse.json({ ok: true });
    }

    // Upsert user
    const user = await upsertUser(message.from);

    // Create platform session token (S-06: use null not "" for missing email/username)
    const session = await createSession({
      id: user.id,
      email: user.email ?? null,
      username: user.username ?? (message.from.username ? `tg_${message.from.username}` : `tg_${message.from.id}`),
      is_admin: user.is_admin,
    });

    const userPayload = JSON.stringify({
      id: user.id,
      username: user.username ?? message.from.username ?? "",
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      email: user.email ?? null,
      isAdmin: user.is_admin,
      onboardingCompleted: user.onboarding_completed,
    });

    // Mark state as approved with token
    await db.query(
      `UPDATE telegram_login_states
       SET status = 'approved', token = $2, user_payload = $3, updated_at = NOW()
       WHERE state = $1`,
      [state, session.accessToken, userPayload]
    );
  } catch (err) {
    logger.error({ err: err }, "[telegram:bot] Error processing start command:");
  }

  return NextResponse.json({ ok: true });
}
