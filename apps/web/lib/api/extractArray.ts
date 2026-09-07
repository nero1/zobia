/**
 * lib/api/extractArray.ts
 *
 * Safely pulls an array out of an API JSON response whose exact envelope
 * shape isn't guaranteed at the call site — some routes return the array
 * directly, some wrap it as `{ data: [...] }`, some as `{ items: [...] }`,
 * `{ rooms: [...] }`, etc., and some nest it one level deeper as
 * `{ data: { rooms: [...] } }`.
 *
 * Root cause this fixes: several pages did `json.someKey ?? json.data ?? []`
 * — `??` only falls through on null/undefined, so when `data` turned out to
 * be an *object* (e.g. `{ data: { rooms: [...] } }`) rather than an array,
 * that object got assigned as-is and a later `.map()` on it threw
 * "x.map is not a function". This always returns a real array.
 *
 * @param json     - Parsed response body (already `await res.json()`'d).
 * @param keys      - Candidate top-level (and, for `data`, one-level-nested)
 *                    property names to check, in priority order.
 */
export function extractArray<T>(json: unknown, keys: string[] = []): T[] {
  if (Array.isArray(json)) return json as T[];
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;

  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value as T[];
  }

  const data = obj.data;
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    for (const key of keys) {
      const value = nested[key];
      if (Array.isArray(value)) return value as T[];
    }
  }

  return [];
}
