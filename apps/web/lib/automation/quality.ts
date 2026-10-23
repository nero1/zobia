import { createHash } from "node:crypto";
export function normalizeGeneratedText(body: string) {
  return body
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function generationFingerprint(body: string) {
  return createHash("sha256")
    .update(normalizeGeneratedText(body))
    .digest("hex");
}
export const WORD_RANGES: Record<string, [number, number]> = {
  wiki: [800, 2400],
  blog: [400, 1800],
  forum: [200, 1400],
  room: [10, 120],
};
export function checkGeneratedQuality(
  kind: string,
  title: string,
  body: string,
  context: string,
) {
  const [min, max] = WORD_RANGES[kind];
  const count = body.trim().split(/\s+/u).length;
  if (count < min || count > max)
    return `Expected ${min}–${max} words; received ${count}.`;
  if (!title.trim() || title.length > 150)
    return "A meaningful title of at most 150 characters is required.";
  if (
    /\blorem ipsum\b|\bas an ai(?: language model)?\b|\[insert .{0,80}\]/i.test(
      body,
    )
  )
    return "Generic filler or unfinished text requires editorial review.";
  const links = body.match(/https?:\/\/[^\s)\]>]+/g) ?? [];
  if (links.some((url) => !context.includes(url)))
    return "New source URLs need verification by an editor.";
  if (kind === "wiki" && (body.match(/^#{1,3}\s+\S/gm) ?? []).length < 3)
    return "Wiki articles need a clear section structure.";
  return null;
}
