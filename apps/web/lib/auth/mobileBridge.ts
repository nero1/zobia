import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { redis } from '@/lib/redis';

export const BRIDGE_TTL_SECONDS = 90;
export const BRIDGE_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-zobia_bridge_intent' : 'zobia_bridge_intent';
const HEX = /^[a-f0-9]{64}$/;
const allowedPaths = [
  /^\/kyc$/,
  /^\/creator\/(?:bank-account|wallet)$/,
  /^\/(?:gate44|admin)\/kyc(?:\?userId=[0-9a-f-]{36})?$/,
  /^\/g\/[a-zA-Z0-9_-]+\/play$/,
];
export function isAllowedBridgePath(path: string): boolean {
  return allowedPaths.some(pattern => pattern.test(path));
}
const grantSchema = z.object({ userId: z.string().uuid(), sourceSid: z.string().uuid(), path: z.string().max(512).refine(isAllowedBridgePath) });
export type BridgeGrant = z.infer<typeof grantSchema>;
const intentSchema = z.object({
  grant: grantSchema,
  code: z.string().regex(HEX),
  cookieHash: z.string().regex(HEX),
  expiresAt: z.number().finite(),
  username: z.string().max(100),
  impersonating: z.boolean(),
});
type BridgeIntent = z.infer<typeof intentSchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function readBridgeGrant(code: string): Promise<BridgeGrant | null> {
  if (!HEX.test(code)) return null;
  const raw = await redis.get(`mobile_bridge:${code}`);
  try { return raw ? grantSchema.parse(JSON.parse(raw)) : null; } catch { return null; }
}
export async function createBridgeIntent(code: string, grant: BridgeGrant, username: string, impersonating: boolean) {
  const id = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const intent: BridgeIntent = { code, grant, username, impersonating, cookieHash: hash(secret), expiresAt: Date.now() + BRIDGE_TTL_SECONDS * 1000 };
  await redis.setex(`mobile_bridge_intent:${id}`, BRIDGE_TTL_SECONDS, JSON.stringify(intent));
  return { id, secret };
}
export async function readBridgeIntent(id: string, secret: string | undefined): Promise<BridgeIntent | null> {
  if (!HEX.test(id) || !secret || !HEX.test(secret)) return null;
  const raw = await redis.get(`mobile_bridge_intent:${id}`);
  try {
    const intent = intentSchema.parse(JSON.parse(raw ?? 'null'));
    if (intent.expiresAt <= Date.now() || !timingSafeEqual(Buffer.from(hash(secret), 'hex'), Buffer.from(intent.cookieHash, 'hex'))) return null;
    return intent;
  } catch { return null; }
}
/** Validate browser possession before burning either one-time credential. */
export async function consumeBridgeIntent(id: string, secret: string | undefined): Promise<BridgeGrant | null> {
  const intent = await readBridgeIntent(id, secret);
  if (!intent) return null;
  if (!await redis.getdel(`mobile_bridge_intent:${id}`)) return null;
  const raw = await redis.getdel(`mobile_bridge:${intent.code}`);
  try {
    const grant = grantSchema.parse(JSON.parse(raw ?? 'null'));
    return grant.userId === intent.grant.userId && grant.sourceSid === intent.grant.sourceSid && grant.path === intent.grant.path ? grant : null;
  } catch { return null; }
}
export function bridgeCookie(value: string, clear = false): string {
  return `${BRIDGE_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear ? 0 : BRIDGE_TTL_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
