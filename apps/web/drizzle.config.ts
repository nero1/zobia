/**
 * drizzle.config.ts
 *
 * Drizzle Kit configuration for schema management and CI validation.
 *
 * Commands:
 *   npx drizzle-kit generate   — generate migration SQL from schema changes
 *   npx drizzle-kit check      — validate migration files are consistent
 *   npx drizzle-kit studio     — browse schema in browser UI
 */

import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./db/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: false,
} satisfies Config;
