import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./drizzle";
/** Internal SQL configuration only. Values remain Drizzle-bound parameters. */
export function bindSql(text: string, values: readonly unknown[] = []): SQL {
  const chunks: SQL[] = [];
  let start = 0,
    index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "'" || char === '"') {
      const quote = char;
      index++;
      while (index < text.length) {
        if (text[index] === quote) {
          if (text[index + 1] === quote) {
            index += 2;
            continue;
          }
          index++;
          break;
        }
        if (text[index] === "\\") index++;
        index++;
      }
      continue;
    }
    if (text.startsWith("--", index)) {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < text.length && depth) {
        if (text.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (text.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else index++;
      }
      continue;
    }
    if (char === "$") {
      const dollar = text
        .slice(index)
        .match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0];
      if (dollar) {
        const end = text.indexOf(dollar, index + dollar.length);
        if (end < 0) throw new Error("Unclosed SQL dollar quote");
        index = end + dollar.length;
        continue;
      }
      const match = text.slice(index).match(/^\$(\d+)/);
      if (match) {
        const position = Number(match[1]) - 1;
        if (position < 0 || position >= values.length)
          throw new Error("SQL parameter missing");
        chunks.push(
          sql.raw(text.slice(start, index)),
          sql`${values[position]}`,
        );
        index += match[0].length;
        start = index;
        continue;
      }
    }
    index++;
  }
  chunks.push(sql.raw(text.slice(start)));
  return sql.join(chunks, sql.empty());
}
export async function executeSql<T extends object = Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
) {
  const db = await getDb();
  return db.execute<T & Record<string, unknown>>(bindSql(text, values));
}
