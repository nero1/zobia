export const dynamic='force-dynamic';
import { NextRequest,NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db/drizzle';
import { raiseAlert } from '@/lib/alerts/dispatch';
import { enforceRateLimit,getClientIp } from '@/lib/security/rateLimit';
import { handleApiError } from '@/lib/api/errors';
function origin(value:unknown):string {
  if(typeof value!=='string')return '';
  try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.origin:'';}catch{return ['inline','eval'].includes(value)?value:'';}
}
export async function POST(req:NextRequest):Promise<NextResponse>{
  try {
    await enforceRateLimit(getClientIp(req),'ip',{name:'csp:ingest',limit:10,windowMs:60_000,globalLimit:100,bypassL1:true});
    if(Number(req.headers.get('content-length'))>16384)return new NextResponse(null,{status:413});
    const reader=req.body?.getReader();if(!reader)return new NextResponse(null,{status:204});
    const chunks:Uint8Array[]=[];let size=0;
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return new NextResponse(null,{status:413});}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return new NextResponse(null,{status:204});}
    const records=Array.isArray(body)?body.slice(0,5).map(item=>item && typeof item==='object'?item.body:null):[body && typeof body==='object'?(body as Record<string,unknown>)['csp-report']:null];
    const db=await getDb();
    for(const record of records){
      if(!record || typeof record!=='object')continue;
      const documentOrigin=origin(record['document-uri']??record.documentURL),blockedOrigin=origin(record['blocked-uri']??record.blockedURL);
      if(!documentOrigin || documentOrigin!==new URL(process.env.NEXT_PUBLIC_APP_URL??req.url).origin)continue;
      const directive=String(record['effective-directive']??record.effectiveDirective??record['violated-directive']??'').split(' ')[0].slice(0,64);
      if(!/^[a-z-]+$/.test(directive))continue;
      const key=createHash('sha256').update(`${directive}:${blockedOrigin}`).digest('hex');
      await raiseAlert(db,{type:'csp_violation',category:'security',priorityLevel:6,title:'CSP violation reported',message:`${directive} blocked ${blockedOrigin||'a resource'}`,metadata:{documentOrigin,blockedOrigin,directive},dedupeKey:`csp:${key}`});
    }
    return new NextResponse(null,{status:204});
  }catch(error){return handleApiError(error);}
}
