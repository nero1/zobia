import { createHash } from "node:crypto";
import type { Client } from "pg";
import { readCatalog, stableJson } from "./catalog";

type Catalog = Awaited<ReturnType<typeof readCatalog>>;
const digest = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");
function objects(rows: unknown[]) {
  const seen = new Map<string, number>();
  return new Map(
    rows.map((value) => {
      const row = value as Record<string, unknown>;
      const name = [row.relation, row.name]
        .filter((v) => typeof v === "string")
        .join(".");
      const ordinal = (seen.get(name) ?? 0) + 1;
      seen.set(name, ordinal);
      return [`${name}#${ordinal}`, row] as const;
    }),
  );
}
/** Only object names, changed field names and hashes leave the database.
 * Never emit definitions, defaults, SQL bodies, rows or connection details. */
export function compareCatalogs(expected: Catalog, actual: Catalog) {
  return Object.fromEntries(
    Object.keys(expected).map((category) => {
      const before = objects(expected[category]),
        after = objects(actual[category] ?? []);
      const changes = [];
      for (const [name, row] of before) {
        const observed = after.get(name);
        if (!observed) changes.push({ object: name, change: "missing" });
        else if (stableJson(row) !== stableJson(observed)) {
          changes.push({
            object: name,
            change: "changed",
            fields: Object.keys(row).filter(
              (key) => stableJson(row[key]) !== stableJson(observed[key]),
            ),
            expectedHash: digest(row),
            actualHash: digest(observed),
          });
        }
      }
      for (const name of after.keys())
        if (!before.has(name)) changes.push({ object: name, change: "extra" });
      return [
        category,
        { expectedCount: before.size, actualCount: after.size, changes },
      ];
    }),
  );
}
export async function inspectSchema(client: Client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query(
      "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'",
    );
    const version = (await client.query("SHOW server_version")).rows[0]
      .server_version;
    const catalog = await readCatalog(client);
    return { version, catalog, checksum: digest(catalog) };
  } finally {
    await client.query("ROLLBACK");
  }
}
