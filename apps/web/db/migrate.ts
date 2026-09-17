/// <reference types="node" />
/**
 * Zobia Social — Database Migration Runner
 *
 * Reads all *.sql files from ./migrations in lexicographic order
 * and executes them in a single transaction per file.
 * Already-applied migrations are tracked in a migrations_log table
 * so the runner is idempotent — safe to call on every deploy.
 *
 * Usage:
 *   ts-node db/migrate.ts            # apply pending migrations
 *   ts-node db/migrate.ts --status   # list applied migrations
 *   ts-node db/migrate.ts --seed     # also run db/seed.sql after migrations
 *
 * Environment variables (see apps/web/.env.example):
 *   DATABASE_URL   — full PostgreSQL connection string (required)
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

// ----------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SEED_FILE = path.join(__dirname, 'seed.sql');
const LOG_TABLE = 'migrations_log';

/**
 * The single schema file. Everything the 0002-0055 sequence used to do now
 * lives inside it, expressed as the schema's final state.
 */
const CONSOLIDATED_FILE = '0001_consolidated_schema.sql';

/**
 * The incremental files that were folded into CONSOLIDATED_FILE and deleted.
 * A database that has these in its migrations_log predates the squash; see
 * `adoptConsolidatedBaseline` for how such a database is brought forward.
 */
const SUPERSEDED_MIGRATIONS: readonly string[] = [
  '0002_blogs.sql',
  '0003_business_expansion.sql',
  '0004_seed_games_catalog.sql',
  '0005_kyc_verification.sql',
  '0006_ads.sql',
  '0007_kyc_rls.sql',
  '0008_moderation_actions_fix.sql',
  '0009_creator_fund_config.sql',
  '0010_platform_events_recurrence.sql',
  '0011_admin_lockout_magic_word.sql',
  '0012_maintenance_mode.sql',
  '0013_audit_log_viewer.sql',
  '0014_ads_advertiser_wallet.sql',
  '0015_ai_fallback_and_monitoring.sql',
  '0016_bbforum.sql',
  '0017_answers_categories.sql',
  '0018_blogs_multi.sql',
  '0019_blog_post_content_format.sql',
  '0020_blog_post_treasury.sql',
  '0021_blog_menu_seo.sql',
  '0022_blog_themes.sql',
  '0023_blog_default_pages.sql',
  '0024_blog_gifts.sql',
  '0025_gift_items_tier_range.sql',
  '0026_rewarded_gifts.sql',
  '0027_business_broadcasts_and_pending_cancel.sql',
  '0028_business_period_tracking.sql',
  '0029_captcha_active_surfaces.sql',
  '0030_site_contact_messages.sql',
  '0031_guild_admin_moderation.sql',
  '0032_bbforum_full.sql',
  '0033_support_tickets.sql',
  '0034_help_center.sql',
  '0035_group_chats_v2.sql',
  '0036_nemesis_opt_out_and_challenge_timeout.sql',
  '0037_forum_mods_and_report_flood_control.sql',
  '0038_polls_quizzes.sql',
  '0039_tweets.sql',
  '0040_room_custom_rewards.sql',
  '0041_admin_data_management.sql',
  '0042_announcement_gender_targeting.sql',
  '0043_profile_activity_and_gallery.sql',
  '0044_profile_avatar_upload.sql',
  '0045_username_change.sql',
  '0046_wiki.sql',
  '0047_quest_system_expansion.sql',
  '0048_admin_alert_priority_system.sql',
  '0049_monitoring_pg_stat_statements.sql',
  '0050_market_referrals_boosts_themes.sql',
  '0051_home_feed.sql',
  '0052_home_ad_placements.sql',
  '0053_crypto_payments.sql',
  '0054_crypto_payments_fixups.sql',
  '0055_help_center_crypto_article.sql',
];

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function getArgs(): { status: boolean; seed: boolean } {
  const args = process.argv.slice(2);
  return {
    status: args.includes('--status'),
    seed: args.includes('--seed'),
  };
}

function log(msg: string): void {
  process.stdout.write(`[migrate] ${msg}\n`);
}

function err(msg: string): void {
  process.stderr.write(`[migrate] ERROR: ${msg}\n`);
}

/** Return all .sql files in the migrations directory, sorted lexicographically. */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .map((f: string) => path.join(MIGRATIONS_DIR, f));
}

// ----------------------------------------------------------------
// Core migration logic
// ----------------------------------------------------------------

async function ensureLogTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (
      id          SERIAL PRIMARY KEY,
      filename    TEXT    NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT    NOT NULL
    )
  `);
}

/**
 * Returns the filename → stored-checksum map for every migration already
 * recorded in migrations_log.
 *
 * BUG-CAP-10: the checksum column was written on every INSERT but never read
 * back anywhere — this is the first caller that actually uses it, to detect
 * drift (see `verifyChecksums` below).
 */
async function getAppliedMigrations(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ filename: string; checksum: string }>(
    `SELECT filename, checksum FROM ${LOG_TABLE} ORDER BY id`
  );
  return new Map(result.rows.map((r) => [r.filename, r.checksum]));
}

/** Simple FNV-1a checksum for change detection (not cryptographic). */
function checksum(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * BUG-CAP-10 fix: recompute the checksum of every already-applied migration
 * file still present on disk and compare it against what was recorded when
 * it was applied. A mismatch means the file was edited after the fact
 * (accidental hand-edit, a bad rebase/cherry-pick, …) — schema drift that was
 * previously undetectable, since nothing ever read the stored checksum back.
 *
 * @param applied - filename → stored checksum, from `getAppliedMigrations`
 * @param files   - absolute paths of every migration file currently on disk
 * @returns filenames whose on-disk content no longer matches what was applied
 */
function verifyChecksums(applied: Map<string, string>, files: string[]): string[] {
  const drifted: string[] = [];
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const storedChecksum = applied.get(filename);
    if (storedChecksum === undefined) continue; // not yet applied — nothing to compare

    const content = fs.readFileSync(filePath, 'utf8');
    if (checksum(content) !== storedChecksum) {
      drifted.push(filename);
    }
  }
  return drifted;
}

/**
 * Bring a database that predates the 0001-0055 squash up to date.
 *
 * The 54 incremental files were folded into CONSOLIDATED_FILE, which is now
 * the schema's final state rather than the "first 42 migrations" it used to
 * be. For a database that already ran the old sequence that creates two
 * problems, both of which this resolves:
 *
 *   1. CONSOLIDATED_FILE's content changed, so `verifyChecksums` sees it as
 *      drifted and the runner refuses to do anything at all.
 *   2. Its recorded checksum no longer describes what is actually applied.
 *
 * Such a database already HAS the schema this file describes — it got there
 * one file at a time — so the correct action is to re-stamp the log entry,
 * not to re-run anything. The superseded rows are deliberately left in place
 * as a record of how that database was actually built.
 *
 * Only a database carrying the *complete* old sequence is adopted. One that
 * stopped partway (say at 0030) is genuinely missing schema that no file on
 * disk can supply any more, so it is reported rather than silently stamped
 * as current.
 *
 * @returns true when a baseline was adopted and `applied` should be re-read
 */
async function adoptConsolidatedBaseline(
  client: Client,
  applied: Map<string, string>
): Promise<boolean> {
  const storedChecksum = applied.get(CONSOLIDATED_FILE);
  if (storedChecksum === undefined) return false; // fresh database — normal path

  const present = SUPERSEDED_MIGRATIONS.filter((f) => applied.has(f));
  if (present.length === 0) return false; // squashed layout already — nothing to do

  const consolidatedPath = path.join(MIGRATIONS_DIR, CONSOLIDATED_FILE);
  const currentChecksum = checksum(fs.readFileSync(consolidatedPath, 'utf8'));
  if (storedChecksum === currentChecksum) return false; // already adopted

  const missing = SUPERSEDED_MIGRATIONS.filter((f) => !applied.has(f));
  if (missing.length > 0) {
    throw new Error(
      `This database applied only ${present.length} of the ${SUPERSEDED_MIGRATIONS.length} ` +
        `migrations that were consolidated into ${CONSOLIDATED_FILE}, so it is missing schema ` +
        `that is no longer available as a separate file: ${missing.join(', ')}. ` +
        `Recover the missing files from git history (they were deleted in the commit that ` +
        `consolidated them), apply them, then re-run.`
    );
  }

  log(
    `Database predates the migration consolidation — it has all ${SUPERSEDED_MIGRATIONS.length} ` +
      `superseded migrations applied, so the schema is already current.`
  );
  await client.query(`UPDATE ${LOG_TABLE} SET checksum = $1 WHERE filename = $2`, [
    currentChecksum,
    CONSOLIDATED_FILE,
  ]);
  log(`  ✓ Re-stamped ${CONSOLIDATED_FILE}; nothing re-applied.`);
  return true;
}

async function applyMigration(client: Client, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const fileChecksum = checksum(content);

  log(`Applying ${filename} …`);

  // Each migration runs inside its own transaction so that a failure
  // rolls back the entire file without leaving partial state.
  await client.query('BEGIN');
  try {
    await client.query(content);
    await client.query(
      `INSERT INTO ${LOG_TABLE} (filename, checksum) VALUES ($1, $2)`,
      [filename, fileChecksum]
    );
    await client.query('COMMIT');
    log(`  ✓ ${filename} applied`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function runSeed(client: Client): Promise<void> {
  if (!fs.existsSync(SEED_FILE)) {
    log('No seed.sql found — skipping seed.');
    return;
  }

  const content = fs.readFileSync(SEED_FILE, 'utf8');
  log('Running seed.sql …');

  await client.query('BEGIN');
  try {
    await client.query(content);
    await client.query('COMMIT');
    log('  ✓ seed.sql applied');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function printStatus(client: Client): Promise<void> {
  await ensureLogTable(client);
  const applied = await getAppliedMigrations(client);
  const files = getMigrationFiles();
  const drifted = new Set(verifyChecksums(applied, files));

  // A database still on the pre-consolidation layout reports the squash
  // rather than flagging the consolidated file as hand-edited — --status is
  // read-only, so it explains what `npm run migrate` will do, and does not
  // re-stamp anything itself.
  const supersededApplied = SUPERSEDED_MIGRATIONS.filter((f) => applied.has(f));
  if (supersededApplied.length > 0 && drifted.has(CONSOLIDATED_FILE)) {
    drifted.delete(CONSOLIDATED_FILE);
    const missing = SUPERSEDED_MIGRATIONS.length - supersededApplied.length;
    log(
      `\nThis database predates the migration consolidation ` +
        `(${supersededApplied.length}/${SUPERSEDED_MIGRATIONS.length} superseded files applied).` +
        (missing === 0
          ? ` Its schema is already current; the next 'npm run migrate' re-stamps ` +
            `${CONSOLIDATED_FILE} without re-applying anything.`
          : ` ${missing} of them were never applied, so schema is missing that no longer ` +
            `exists as a separate file — 'npm run migrate' will stop and list them.`)
    );
  }

  log(`\nMigration status (${files.length} total):`);
  log('─'.repeat(50));

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const status = drifted.has(filename)
      ? '⚠ modified'
      : applied.has(filename)
        ? '✓ applied'
        : '○ pending';
    log(`  ${status.padEnd(12)} ${filename}`);
  }

  const pending = files.filter((f) => !applied.has(path.basename(f)));
  log('─'.repeat(50));
  log(`${applied.size} applied, ${pending.length} pending, ${drifted.size} modified since applied\n`);
  if (drifted.size > 0) {
    log(
      `⚠ ${drifted.size} already-applied migration(s) no longer match what was run: ` +
        `${[...drifted].join(', ')}. This file was edited after being applied — ` +
        `verify the database schema still matches what's on disk.`
    );
  }
}

// ----------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    err('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const args = getArgs();
  const client = new Client({ connectionString: databaseUrl });

  try {
    log(`Connecting to database …`);
    await client.connect();
    log('Connected.');

    await ensureLogTable(client);

    if (args.status) {
      await printStatus(client);
      return;
    }

    let applied = await getAppliedMigrations(client);
    const files = getMigrationFiles();

    // A database built by the old 0001-0055 sequence already has this schema.
    // Re-stamp it before the drift check below, which would otherwise reject
    // the consolidated file purely because its content changed.
    if (await adoptConsolidatedBaseline(client, applied)) {
      applied = await getAppliedMigrations(client);
    }

    // BUG-CAP-10 fix: refuse to apply any pending migration while an
    // already-applied file has drifted from what was actually run — proceeding
    // could compound an unknown, undocumented schema difference. Run
    // `--status` to see which file(s) drifted.
    const drifted = verifyChecksums(applied, files);
    if (drifted.length > 0) {
      err(
        `${drifted.length} already-applied migration file(s) no longer match their recorded checksum: ` +
          `${drifted.join(', ')}. Refusing to run pending migrations until this is resolved — ` +
          `run 'npx tsx db/migrate.ts --status' for details.`
      );
      process.exit(1);
    }

    const pending = files.filter((f) => !applied.has(path.basename(f)));

    if (pending.length === 0) {
      log('No pending migrations. Database is up to date.');
    } else {
      log(`${pending.length} pending migration(s) found.`);
      for (const filePath of pending) {
        await applyMigration(client, filePath);
      }
      log(`All migrations applied successfully.`);
    }

    if (args.seed) {
      await runSeed(client);
    }
  } catch (e) {
    err(String(e));
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
