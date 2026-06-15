/**
 * lib/moderation/contentFilter.ts
 *
 * Rules-based content filtering for real-time message moderation.
 *
 * All functions are synchronous where possible for low latency on the
 * hot message path. DB-backed checks receive a db argument to enable
 * dependency injection and testing.
 *
 * @module lib/moderation/contentFilter
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by applyAutoModeration. */
export interface AutoModerationResult {
  /** Whether the message should be blocked entirely. */
  blocked: boolean;
  /** Reason code for the block or filter action. */
  reason: AutoModerationReason | null;
  /** Cleaned version of the message content (profanity replaced). */
  filteredContent: string;
  /** Confidence-like severity score 0–1 for downstream use. */
  severity: number;
}

export type AutoModerationReason =
  | "profanity"
  | "duplicate_message"
  | "bot_behavior"
  | "rate_limit_exceeded";

/** Minimal message object expected by applyAutoModeration. */
export interface MessageInput {
  content: string;
  senderId: string;
  roomId: string;
}

/** Minimal room object for context-aware moderation. */
export interface RoomContext {
  id: string;
  /** If false, stricter filtering applies. */
  adult_content_allowed?: boolean;
}

/** Minimal sender object for context-aware moderation. */
export interface SenderContext {
  id: string;
  is_verified?: boolean;
  trust_score?: number;
}

// ---------------------------------------------------------------------------
// Profanity word-list (configurable via environment)
// ---------------------------------------------------------------------------

/**
 * Default profanity word-list.
 * Override at runtime by setting PROFANITY_WORDLIST env var as
 * a comma-separated string of words.
 */
function buildWordlistPatterns(): string[] {
  const envList = process.env.PROFANITY_WORDLIST ?? "";
  const envWords = envList
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  // Built-in baseline list — common severe violations per platform content policy.
  // Extend via PROFANITY_WORDLIST env var with comma-separated additions.
  const baselineWords = [
    "nigger", "nigga", "faggot", "chink", "spic", "kike", "cunt",
    "motherfucker", "whore", "retard", "tranny", "dyke", "wetback",
  ];

  const allWords = [...new Set([...baselineWords, ...envWords])];
  // Store pattern strings — not RegExp objects — to avoid shared mutable lastIndex state (BUG-23)
  return allWords.map(
    (word) => `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
  );
}

const WORDLIST_TTL_MS = 5 * 60 * 1000;
let _wordlistCache: { patterns: string[]; fetchedAt: number } | null = null;

function getWordlistPatterns(): string[] {
  const now = Date.now();
  if (!_wordlistCache || now - _wordlistCache.fetchedAt > WORDLIST_TTL_MS) {
    _wordlistCache = { patterns: buildWordlistPatterns(), fetchedAt: now };
  }
  return _wordlistCache.patterns;
}

// ---------------------------------------------------------------------------
// filterProfanity
// ---------------------------------------------------------------------------

/**
 * Replace profanity in text with asterisks.
 *
 * The replacement preserves word length so sentence structure is readable.
 * Uses a configurable word-list; patterns are compiled once and cached.
 *
 * @param text - Raw user message content
 * @returns Object with the cleaned text and whether any profanity was found
 */
export function filterProfanity(text: string): { filtered: string; found: boolean } {
  let filtered = text;
  let found = false;

  for (const patternStr of getWordlistPatterns()) {
    // BUG-23: compile fresh RegExp per call — avoids shared mutable lastIndex state
    const re = new RegExp(patternStr, "gi");
    if (re.test(filtered)) {
      found = true;
      // Compile again — test() advances lastIndex for sticky patterns
      filtered = filtered.replace(new RegExp(patternStr, "gi"), (match) =>
        "*".repeat(match.length)
      );
    }
  }

  return { filtered, found };
}

// ---------------------------------------------------------------------------
// detectDuplicateMessage
// ---------------------------------------------------------------------------

/**
 * Detect if a user is sending the same (or very similar) message
 * repeatedly within a rolling time window.
 *
 * Compares against the user's recent messages in the same room using
 * a simple normalised equality check. Tolerates minor punctuation
 * differences.
 *
 * @param userId    - Sender's user ID
 * @param content   - Raw message content
 * @param windowMs  - Rolling window in milliseconds (default: 60_000)
 * @param db        - Database adapter
 * @returns true if this looks like a duplicate
 */
export async function detectDuplicateMessage(
  userId: string,
  content: string,
  windowMs: number = 60_000,
  db: DatabaseAdapter
): Promise<boolean> {
  const normalise = (s: string) =>
    s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

  const normContent = normalise(content);
  const windowSeconds = Math.ceil(windowMs / 1000);

  // Check room messages for duplicate detection.
  const { rows } = await db.query<{ content: string }>(
    `SELECT content
     FROM room_messages
     WHERE sender_id = $1
       AND created_at >= NOW() - ($2 * INTERVAL '1 second')
       AND is_deleted = FALSE
     LIMIT 20`,
    [userId, windowSeconds]
  );

  return rows.some((row) => normalise(row.content ?? "") === normContent);
}

// ---------------------------------------------------------------------------
// detectBotBehavior
// ---------------------------------------------------------------------------

/**
 * Detect bot-like behavior via velocity checks.
 *
 * Flags a user if they have sent messages faster than the threshold
 * within the rolling window. Verified users and high-trust users get
 * a relaxed limit.
 *
 * Thresholds:
 *  - Standard users:  30 messages / 60 seconds
 *  - Verified users:  60 messages / 60 seconds
 *
 * @param userId - User to check
 * @param db     - Database adapter
 * @returns true if behavior patterns match a bot
 */
export async function detectBotBehavior(
  userId: string,
  db: DatabaseAdapter
): Promise<boolean> {
  // Check if the user is verified for a relaxed limit
  const { rows: userRows } = await db.query<{
    is_verified: boolean;
    trust_score: number | null;
  }>(
    `SELECT is_verified, trust_score FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );

  const user = userRows[0];
  const isVerified = user?.is_verified ?? false;
  const trustScore = user?.trust_score ?? 0;
  const relaxed = isVerified || trustScore >= 80;

  const messageLimit = relaxed ? 60 : 30;
  const windowSeconds = 60;

  // Count room messages for velocity checks.
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM room_messages
     WHERE sender_id = $1
       AND created_at >= NOW() - ($2 * INTERVAL '1 second')
       AND is_deleted = FALSE`,
    [userId, windowSeconds]
  );

  const messageCount = parseInt(rows[0]?.count ?? "0", 10);
  return messageCount >= messageLimit;
}

// ---------------------------------------------------------------------------
// applyAutoModeration
// ---------------------------------------------------------------------------

/**
 * Run all automatic moderation rules against a single message.
 *
 * Rules applied in priority order:
 *  1. Bot behavior detection (block)
 *  2. Duplicate message detection (block)
 *  3. Profanity filter (filter content, don't block unless severe)
 *
 * Returns a result object that the message handler should act on:
 *  - blocked = true → reject the message
 *  - filteredContent → store/broadcast this instead of the raw content
 *
 * @param message - The message being sent
 * @param room    - Room context (used for adult content flag)
 * @param sender  - Sender context (used for trust adjustments)
 * @param db      - Database adapter
 * @returns AutoModerationResult
 */
export async function applyAutoModeration(
  message: MessageInput,
  room: RoomContext,
  sender: SenderContext,
  db: DatabaseAdapter
): Promise<AutoModerationResult> {
  const defaultResult: AutoModerationResult = {
    blocked: false,
    reason: null,
    filteredContent: message.content,
    severity: 0,
  };

  // ---- 1. Bot behavior check ----
  try {
    const isBot = await detectBotBehavior(sender.id, db);
    if (isBot) {
      return {
        blocked: true,
        reason: "bot_behavior",
        filteredContent: message.content,
        severity: 0.9,
      };
    }
  } catch (err) {
    console.error("[contentFilter] detectBotBehavior error:", err);
  }

  // ---- 2. Duplicate message check ----
  try {
    const isDuplicate = await detectDuplicateMessage(
      sender.id,
      message.content,
      60_000,
      db
    );
    if (isDuplicate) {
      return {
        blocked: true,
        reason: "duplicate_message",
        filteredContent: message.content,
        severity: 0.6,
      };
    }
  } catch (err) {
    console.error("[contentFilter] detectDuplicateMessage error:", err);
  }

  // ---- 3. Profanity filter ----
  const { filtered, found } = filterProfanity(message.content);
  if (found) {
    return {
      ...defaultResult,
      blocked: false, // Filter, don't block
      reason: "profanity",
      filteredContent: filtered,
      severity: 0.4,
    };
  }

  return { ...defaultResult, filteredContent: message.content };
}
