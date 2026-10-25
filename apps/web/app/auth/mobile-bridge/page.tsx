import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { BRIDGE_COOKIE, readBridgeIntent } from '@/lib/auth/mobileBridge';
import { MobileBridgeConfirmation } from '@/components/auth/MobileBridgeConfirmation';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MobileBridgePage({searchParams}:{searchParams:Promise<{intent?:string}>}) {
  const {intent:id} = await searchParams;
  const jar = await cookies();
  const intent = id ? await readBridgeIntent(id,jar.get(BRIDGE_COOKIE)?.value) : null;
  return <MobileBridgeConfirmation intentId={intent ? id : undefined} username={intent?.username} impersonating={intent?.impersonating} />;
}
