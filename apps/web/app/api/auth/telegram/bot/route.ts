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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const selectCols = {
    id: schema.users.id,
    email: schema.users.email,
    username: schema.users.username,
    is_admin: schema.users.isAdmin,
    onboarding_completed: schema.users.onboardingCompleted,
  };

  const [existing] = await orm
    .select(selectCols)
    .from(schema.users)
    .where(and(eq(schema.users.telegramId, String(tgUser.id)), isNull(schema.users.deletedAt)))
    .limit(1);
  if (existing) {
    return {
      ...existing,
      onboarding_completed: existing.onboarding_completed ?? false,
    };
  }

  const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
  // `username` is NOT NULL/unique on `users` — derive a stable, unique
  // default from the Telegram username (or numeric id as a fallback).
  const username = tgUser.username ? `tg_${tgUser.username}` : `tg_${tgUser.id}`;
  const [inserted] = await orm
    .insert(schema.users)
    .values({
      telegramId: String(tgUser.id),
      username,
      displayName,
      onboardingCompleted: false,
      isAdmin: false,
    })
    .returning(selectCols);
  if (!inserted) throw new Error("Failed to create user");
  return {
    ...inserted,
    onboarding_completed: inserted.onboarding_completed ?? false,
  };
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
    const orm = await getDb();

    // Verify state exists and is still pending
    const [stateRow] = await orm
      .select({ status: schema.telegramLoginStates.status, createdAt: schema.telegramLoginStates.createdAt })
      .from(schema.telegramLoginStates)
      .where(eq(schema.telegramLoginStates.state, state))
      .limit(1);

    if (!stateRow || stateRow.status !== "pending") {
      return NextResponse.json({ ok: true });
    }

    const age = Date.now() - new Date(stateRow.createdAt).getTime();
    if (age > 5 * 60 * 1000) {
      await orm
        .update(schema.telegramLoginStates)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(schema.telegramLoginStates.state, state));
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
    await orm
      .update(schema.telegramLoginStates)
      .set({ status: "approved", token: session.accessToken, userPayload, updatedAt: new Date() })
      .where(eq(schema.telegramLoginStates.state, state));
  } catch (err) {
    logger.error({ err: err }, "[telegram:bot] Error processing start command:");
  }

  return NextResponse.json({ ok: true });
}
