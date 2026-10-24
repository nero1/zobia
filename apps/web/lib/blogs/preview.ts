/** Never let a short article or an inaccurate stored count reveal the full body. */
export function paywallPreview(body: string): { text: string; wordCount: number } {
  const words = body.trim() ? body.trim().split(/\s+/) : [];
  const wordCount = Math.min(100, Math.floor(words.length * 0.2));
  return { text: words.slice(0, wordCount).join(" "), wordCount };
}
