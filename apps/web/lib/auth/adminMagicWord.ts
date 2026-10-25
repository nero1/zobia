import { createHash } from "node:crypto";
import { compare, hash } from "bcryptjs";

const PREFIX = "sha256-v1:";
const digest = (word: string) =>
  createHash("sha256").update(word, "utf8").digest("hex");

/** Prehash long/Unicode phrases so bcrypt's 72-byte limit cannot truncate them. */
export async function hashAdminMagicWord(word: string): Promise<string> {
  return PREFIX + (await hash(digest(word), 12));
}

/** Existing bcrypt-only phrases remain usable after deployment. */
export async function verifyAdminMagicWord(
  word: string,
  stored: string,
): Promise<boolean> {
  return stored.startsWith(PREFIX)
    ? compare(digest(word), stored.slice(PREFIX.length))
    : compare(word, stored);
}
