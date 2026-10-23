import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/payments/paystack';
import { receivePaystackEvent, processInboxEvent } from '@/lib/payments/webhookInbox';
import { logger } from '@/lib/logger';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) return NextResponse.json({received:false},{status:415});
  const limit=256*1024; const chunks:Uint8Array[]=[];let length=0;
  try {
    if (Number(req.headers.get('content-length'))>limit) return NextResponse.json({received:false},{status:413});
    if(req.body) for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) { length+=chunk.byteLength; if(length>limit)return NextResponse.json({received:false},{status:413});chunks.push(chunk); }
    const bytes=Buffer.concat(chunks);
    if(!verifyWebhookSignature(bytes,req.headers.get('x-paystack-signature')??'')) return NextResponse.json({received:false},{status:401});
    const raw=bytes.toString('utf8');const event=JSON.parse(raw);
    if(typeof event?.event!=='string'||!event.data||typeof event.data!=='object')return NextResponse.json({received:false},{status:400});
    const id=await receivePaystackEvent(event,raw);
    try { await processInboxEvent(id); } catch(error) { logger.error({err:error,eventId:id},'Verified webhook queued for recovery'); }
    return NextResponse.json({received:true});
  } catch(error) { logger.error({err:error},'Webhook ingestion failed');return NextResponse.json({received:false},{status:503}); }
}
