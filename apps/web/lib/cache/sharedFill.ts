import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { memGet, memSet, memDel } from "./memory";
import { serviceUnavailable } from "@/lib/api/errors";

const inflight = new Map<string, Promise<unknown>>();
const PUBLISH = `if redis.call('GET',KEYS[2]) ~= ARGV[1] then return 0 end redis.call('SETEX',KEYS[1],ARGV[2],ARGV[3]); redis.call('DEL',KEYS[2]); return 1`;
const RELEASE = `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
/** One Redis read per local burst; one bounded fill across instances. */
export function sharedCached<T>(
  key: string,
  ttlSeconds: number,
  memoryMs: number,
  fill: () => Promise<T>,
): Promise<T> {
  const cached = memGet<T>(key);
  if (cached !== null && cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = (async () => {
    const value = await redis.get(key);
    if (value !== null) {
      const parsed = JSON.parse(value) as T;
      memSet(key, parsed, memoryMs);
      return parsed;
    }
    const token = randomUUID(),
      lock = `${key}:fill`;
    const acquired = await redis.set(lock, token, "EX", 30, "NX");
    if (!acquired) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const completed = await redis.get(key);
      if (completed !== null) {
        const parsed = JSON.parse(completed) as T;
        memSet(key, parsed, memoryMs);
        return parsed;
      }
      throw serviceUnavailable("Content is refreshing. Please retry shortly.");
    }
    try {
      const result = await fill();
      const published = await redis.eval(
        PUBLISH,
        2,
        key,
        lock,
        token,
        String(
          Math.max(30, Math.round(ttlSeconds * (0.9 + Math.random() * 0.2))),
        ),
        JSON.stringify(result),
      );
      if (Number(published) !== 1)
        throw serviceUnavailable(
          "Content changed while loading. Please retry.",
        );
      memSet(key, result, memoryMs);
      return result;
    } finally {
      await redis.eval(RELEASE, 1, lock, token).catch(() => {});
    }
  })()
    .catch((error) => {
      // A cache outage must not turn every serverless instance into an expensive fill.
      if (error?.status === 503) throw error;
      throw serviceUnavailable(
        "Content cache is temporarily unavailable. Please retry.",
      );
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
export async function invalidateSharedCache(key: string): Promise<void> {
  memDel(key);
  inflight.delete(key);
  // Revoking fill ownership prevents an older worker from republishing after deletion.
  await redis.del(key, `${key}:fill`);
}
