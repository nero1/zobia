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

    const applied = await getAppliedMigrations(client);
    const files = getMigrationFiles();

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
