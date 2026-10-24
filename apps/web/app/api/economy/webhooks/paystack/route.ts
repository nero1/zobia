import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/payments/paystack';
import { receivePaystackEvent, processInboxEvent } from '@/lib/payments/webhookInbox';
import { logger } from '@/lib/logger';
import {readBoundedBytes} from '@/lib/security/requestBody';
import {ApiError} from '@/lib/api/errors';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) return NextResponse.json({received:false},{status:415});
  try {
    const bytes=Buffer.from(await readBoundedBytes(req,256*1024));
    if(!verifyWebhookSignature(bytes,req.headers.get('x-paystack-signature')??'')) return NextResponse.json({received:false},{status:401});
    let raw:string,event:unknown;
    try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);event=JSON.parse(raw);}catch{return NextResponse.json({received:false},{status:400});}
    const payload=event as {event?:unknown;data?:unknown}|null;
    if(typeof payload?.event!=='string'||!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data))return NextResponse.json({received:false},{status:400});
    const id=await receivePaystackEvent({event:payload.event},raw);
    try { await processInboxEvent(id); } catch(error) { logger.error({err:error,eventId:id},'Verified webhook queued for recovery'); }
    return NextResponse.json({received:true});
  } catch(error) { if(error instanceof ApiError)return NextResponse.json({received:false},{status:error.status});logger.error({err:error},'Webhook ingestion failed');return NextResponse.json({received:false},{status:503}); }
}
