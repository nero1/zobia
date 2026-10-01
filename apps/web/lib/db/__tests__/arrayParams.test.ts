/**
 * Guard: JS arrays interpolated into raw Drizzle `sql` templates must be
 * wrapped in `sql.param(...)`.
 *
 * Drizzle expands a bare array interpolation into a parameter LIST, so
 *   sql`id = ANY(${ids}::uuid[])`   compiles to   id = ANY(($1, $2)::uuid[])
 * which Postgres rejects ("cannot cast type record to uuid[]", or
 * "malformed array literal" for one element, or a syntax error when empty).
 * `sql.param(ids)` binds the whole array as ONE parameter, which node-postgres
 * sends as a real Postgres array. Before this guard, 150+ such bindings across
 * crons, polls, tweets, trust scores, forum and themes were broken.
 *
 * This scans app/ and lib/ for array contexts (`ANY(${…}`, `ALL(${…}`,
 * `unnest(${…}`, `${…}::<type>[]`) whose expression is not `sql.param(…)`,
 * a schema column (`schema.…`) or another sql fragment (`sql.…`).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Interpolations `${expr}` with their surrounding text, honouring nested braces. */
function interpolations(src: string): { expr: string; before: string; after: string; line: number }[] {
  const found: { expr: string; before: string; after: string; line: number }[] = [];
  let i = 0;
  while ((i = src.indexOf("${", i)) !== -1) {
    let depth = 0;
    let k = i + 1;
    for (; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) break;
    }
    found.push({
      expr: src.slice(i + 2, k).trim(),
      before: src.slice(Math.max(0, i - 8), i),
      after: src.slice(k + 1, k + 20),
      line: src.slice(0, i).split("\n").length,
    });
    i = k + 1;
  }
  return found;
}

describe("raw sql array bindings", () => {
  it("every array interpolation uses sql.param()", () => {
    const offenders: string[] = [];
    for (const file of ["app", "lib"].flatMap((d) => walk(path.join(ROOT, d)))) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes("sql`")) continue;
      for (const { expr, before, after, line } of interpolations(src)) {
        const arrayContext = /^::[a-z0-9_ ]+\[\]/.test(after) || /(ANY\(\(?|ALL\(|unnest\()$/.test(before);
        if (!arrayContext) continue;
        if (expr.startsWith("sql.param(") || expr.startsWith("schema.") || expr.startsWith("sql.")) continue;
        offenders.push(`${path.relative(ROOT, file)}:${line} \${${expr}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
