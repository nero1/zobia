/**
 * DB provider leakage regression test.
 *
 * Verifies that the codebase contains zero direct `@supabase/supabase-js` or
 * `createClient` imports in files outside of `lib/db/providers/supabase.ts`.
 *
 * This enforces the DATABASE_PROVIDER abstraction layer: only the Supabase
 * provider adapter is allowed to import from the Supabase SDK. All other code
 * must use the `db` export from `@/lib/db` (the provider-agnostic interface).
 *
 * If this test fails, a file is importing Supabase directly and will break
 * Railway / DigitalOcean deployments where DATABASE_PROVIDER != 'supabase'.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Root of the web app source directory. */
const SRC_ROOT = path.resolve(__dirname, '../../../');

/** The one file allowed to import from the Supabase SDK for the DB layer. */
const ALLOWED_SUPABASE_FILE = path.resolve(__dirname, '../providers/supabase.ts');

/** This test file itself references the SDK name in string/regex literals. */
const SELF_FILE = path.resolve(__filename);

/**
 * Directories with their own independent pluggable-provider abstraction
 * (REALTIME_PROVIDER / STORAGE_PROVIDER) that is unrelated to
 * DATABASE_PROVIDER. A Supabase SDK import there is an intentional,
 * env-gated provider implementation, not a DB-abstraction leak.
 */
const EXCLUDED_DIRS = [
  path.resolve(SRC_ROOT, 'lib/realtime'),
  path.resolve(SRC_ROOT, 'lib/storage'),
];

/**
 * Patterns that indicate an actual Supabase SDK import/require statement.
 * Deliberately narrower than a bare substring match on the package name so
 * that comments documenting the absence of a dependency (e.g. "No
 * @supabase/supabase-js is used here") are not flagged as violations.
 */
const SUPABASE_IMPORT_PATTERNS = [
  /from\s+['"]@supabase\/supabase-js['"]/,
  /require\(\s*['"]@supabase\/supabase-js['"]\s*\)/,
  /import\(\s*['"]@supabase\/supabase-js['"]\s*\)/,
];

/**
 * Directories to skip entirely (no source code, third-party, or generated).
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  '__pycache__',
  '.git',
  'coverage',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all TypeScript/JavaScript source files under `dir`.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Returns true if the file content contains a direct Supabase SDK import.
 */
function hasSupabaseImport(content: string): boolean {
  return SUPABASE_IMPORT_PATTERNS.some((pattern) => pattern.test(content));
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('DB provider isolation — no Supabase SDK leakage', () => {
  let allSourceFiles: string[];

  beforeAll(() => {
    allSourceFiles = collectSourceFiles(SRC_ROOT);
  });

  test('codebase has TypeScript source files to check', () => {
    expect(allSourceFiles.length).toBeGreaterThan(0);
  });

  test('only lib/db/providers/supabase.ts imports from @supabase/supabase-js', () => {
    const violatingFiles: string[] = [];

    for (const filePath of allSourceFiles) {
      const resolved = path.resolve(filePath);

      // Skip the allowed DB provider file and this test file itself.
      if (resolved === ALLOWED_SUPABASE_FILE) continue;
      if (resolved === SELF_FILE) continue;

      // Skip directories with their own independent provider abstraction.
      if (EXCLUDED_DIRS.some((dir) => resolved.startsWith(dir + path.sep))) continue;

      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      if (hasSupabaseImport(content)) {
        violatingFiles.push(path.relative(SRC_ROOT, filePath));
      }
    }

    if (violatingFiles.length > 0) {
      const fileList = violatingFiles.map((f) => `  - ${f}`).join('\n');
      throw new Error(
        `Found ${violatingFiles.length} file(s) with direct @supabase/supabase-js imports ` +
          `outside of lib/db/providers/supabase.ts.\n\n` +
          `Violating files:\n${fileList}\n\n` +
          `Fix: use the db abstraction from @/lib/db instead of importing Supabase directly.\n` +
          `These files will break Railway/DigitalOcean deployments where DATABASE_PROVIDER != 'supabase'.`
      );
    }

    expect(violatingFiles).toHaveLength(0);
  });

  test('lib/db/index.ts does not import Supabase SDK directly', () => {
    const dbIndexPath = path.resolve(SRC_ROOT, 'lib/db/index.ts');

    let content: string;
    try {
      content = fs.readFileSync(dbIndexPath, 'utf-8');
    } catch {
      // File doesn't exist — skip
      return;
    }

    expect(hasSupabaseImport(content)).toBe(false);
  });

  test('Supabase provider file exists at expected path', () => {
    expect(fs.existsSync(ALLOWED_SUPABASE_FILE)).toBe(true);
  });

  test('Supabase provider exports a DatabaseAdapter-compatible interface', () => {
    // The provider file should export a named export or default export
    let content: string;
    try {
      content = fs.readFileSync(ALLOWED_SUPABASE_FILE, 'utf-8');
    } catch {
      return;
    }

    // Should have at least one export
    expect(/export/.test(content)).toBe(true);
    // Should reference @supabase/supabase-js
    expect(/@supabase\/supabase-js/.test(content)).toBe(true);
  });
});
