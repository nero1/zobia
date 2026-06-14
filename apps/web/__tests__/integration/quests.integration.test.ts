/**
 * Integration tests: Quest deck completion bonus
 *
 * Covers:
 * - user_quest_decks table exists and accepts inserts (BUG-DB03 / TASK-03 fix)
 * - generateDailyDeck-style inserts populate user_quest_decks correctly
 * - checkDeckCompletion identifies when all quests in a deck are completed
 * - 500 XP deck completion bonus is awarded when all quests complete
 * - Deck is only checked once (idempotency via reference_id)
 *
 * Requires: TEST_DATABASE_URL
 */

import {
  integrationSetup,
  createTestTransaction,
  closeTestPool,
  wrapClient,
} from "./setup";
import { createUser, createQuestTemplate, getUserById, uuid } from "./helpers";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await integrationSetup();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Quest deck completion bonus [integration]", () => {
  it("user_quest_decks table accepts inserts", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const quest = await createQuestTemplate(client);
      const db = wrapClient(client);
      const today = new Date().toISOString().slice(0, 10);

      await db.query(
        `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, quest_id, assigned_date) DO NOTHING`,
        [uuid(), user.id, quest.id, today]
      );

      const { rows } = await db.query(
        `SELECT id FROM user_quest_decks WHERE user_id = $1 AND assigned_date = $2`,
        [user.id, today]
      );
      expect(rows).toHaveLength(1);
    } finally {
      await rollback();
    }
  });

  it("unique constraint on (user_id, quest_id, assigned_date) prevents duplicates", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const quest = await createQuestTemplate(client);
      const db = wrapClient(client);
      const today = new Date().toISOString().slice(0, 10);

      // First insert
      await db.query(
        `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
         VALUES ($1, $2, $3, $4)`,
        [uuid(), user.id, quest.id, today]
      );

      // Second insert — ON CONFLICT DO NOTHING should prevent duplicate
      await db.query(
        `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, quest_id, assigned_date) DO NOTHING`,
        [uuid(), user.id, quest.id, today]
      );

      const { rows } = await db.query(
        `SELECT COUNT(*) AS cnt FROM user_quest_decks WHERE user_id = $1 AND assigned_date = $2`,
        [user.id, today]
      );
      expect(parseInt((rows[0] as { cnt: string }).cnt, 10)).toBe(1);
    } finally {
      await rollback();
    }
  });

  it("deck completion detected when all quests in a deck are completed", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const quest1 = await createQuestTemplate(client);
      const quest2 = await createQuestTemplate(client);
      const db = wrapClient(client);
      const today = new Date().toISOString().slice(0, 10);

      // Assign deck
      for (const quest of [quest1, quest2]) {
        await db.query(
          `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, quest_id, assigned_date) DO NOTHING`,
          [uuid(), user.id, quest.id, today]
        );
        // Create progress rows as completed
        await db.query(
          `INSERT INTO user_quest_progress (id, user_id, quest_id, quest_date, progress_count, completed, completed_at)
           VALUES ($1, $2, $3, $4, 1, true, NOW())
           ON CONFLICT (user_id, quest_id, quest_date) DO NOTHING`,
          [uuid(), user.id, quest.id, today]
        );
      }

      // checkDeckCompletion query (fixed: uses user_quest_decks to identify the deck)
      const { rows } = await db.query<{ all_completed: boolean; total_quests: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE uqp.completed = true) = COUNT(*) AS all_completed,
           COUNT(*)::text AS total_quests
         FROM user_quest_decks uqd
         JOIN user_quest_progress uqp
           ON uqp.quest_id = uqd.quest_id
          AND uqp.user_id = uqd.user_id
          AND uqp.quest_date = uqd.assigned_date
         WHERE uqd.user_id = $1 AND uqd.assigned_date = $2`,
        [user.id, today]
      );

      expect(rows[0].all_completed).toBe(true);
      expect(parseInt(rows[0].total_quests, 10)).toBe(2);
    } finally {
      await rollback();
    }
  });

  it("deck completion bonus (500 XP) is awarded and deduplicated", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { xpTotal: 0 });
      const quest = await createQuestTemplate(client);
      const db = wrapClient(client);
      const today = new Date().toISOString().slice(0, 10);

      // Set up a complete deck
      await db.query(
        `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
         VALUES ($1, $2, $3, $4)`,
        [uuid(), user.id, quest.id, today]
      );
      await db.query(
        `INSERT INTO user_quest_progress (id, user_id, quest_id, quest_date, progress_count, completed, completed_at)
         VALUES ($1, $2, $3, $4, 1, true, NOW())`,
        [uuid(), user.id, quest.id, today]
      );

      const DECK_COMPLETION_XP = 500;
      const deckRef = `deck_completion:${user.id}:${today}`;

      // Award bonus
      await db.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         VALUES ($1, $2, 'main', 'deck_completion', $3, $2, NOW())
         ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [user.id, DECK_COMPLETION_XP, deckRef]
      );
      await db.query(
        `UPDATE users SET xp_total = xp_total + $1 WHERE id = $2`,
        [DECK_COMPLETION_XP, user.id]
      );

      // Try to award again — deduplication prevents it
      await db.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         VALUES ($1, $2, 'main', 'deck_completion', $3, $2, NOW())
         ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [user.id, DECK_COMPLETION_XP, deckRef]
      );

      const updated = await getUserById(client, user.id);
      expect(updated?.xp_total).toBe(DECK_COMPLETION_XP); // only awarded once

      const { rows: ledger } = await db.query(
        `SELECT COUNT(*) AS cnt FROM xp_ledger WHERE user_id = $1 AND source = 'deck_completion'`,
        [user.id]
      );
      expect(parseInt((ledger[0] as { cnt: string }).cnt, 10)).toBe(1);
    } finally {
      await rollback();
    }
  });

  it("incomplete deck: not all quests completed → bonus NOT awarded", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { xpTotal: 0 });
      const quest1 = await createQuestTemplate(client);
      const quest2 = await createQuestTemplate(client);
      const db = wrapClient(client);
      const today = new Date().toISOString().slice(0, 10);

      for (const quest of [quest1, quest2]) {
        await db.query(
          `INSERT INTO user_quest_decks (id, user_id, quest_id, assigned_date)
           VALUES ($1, $2, $3, $4)`,
          [uuid(), user.id, quest.id, today]
        );
      }

      // Only complete quest1
      await db.query(
        `INSERT INTO user_quest_progress (id, user_id, quest_id, quest_date, progress_count, completed)
         VALUES ($1, $2, $3, $4, 1, true)`,
        [uuid(), user.id, quest1.id, today]
      );
      // quest2: not completed (progress_count=0, completed=false)
      await db.query(
        `INSERT INTO user_quest_progress (id, user_id, quest_id, quest_date, progress_count, completed)
         VALUES ($1, $2, $3, $4, 0, false)`,
        [uuid(), user.id, quest2.id, today]
      );

      const { rows } = await db.query<{ all_completed: boolean }>(
        `SELECT COUNT(*) FILTER (WHERE uqp.completed = true) = COUNT(*) AS all_completed
         FROM user_quest_decks uqd
         JOIN user_quest_progress uqp
           ON uqp.quest_id = uqd.quest_id
          AND uqp.user_id = uqd.user_id
          AND uqp.quest_date = uqd.assigned_date
         WHERE uqd.user_id = $1 AND uqd.assigned_date = $2`,
        [user.id, today]
      );

      expect(rows[0].all_completed).toBe(false);
    } finally {
      await rollback();
    }
  });
});
