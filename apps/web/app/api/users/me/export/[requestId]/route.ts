export const dynamic='force-dynamic';
export const maxDuration=300;
import {NextRequest,NextResponse} from 'next/server';
import {jwtVerify} from 'jose';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {getDb} from '@/lib/db/drizzle';
import {env} from '@/lib/env';
import {unauthorized,handleApiError} from '@/lib/api/errors';
import {personalExportStream} from '@/lib/export/personal';
import {enforceRateLimit,getClientIp} from '@/lib/security/rateLimit';
export async function GET(req:NextRequest,{params}:{params:Promise<{requestId:string}>}){
 try{
  await enforceRateLimit(getClientIp(req),'ip',{name:'export:download',limit:5,windowMs:60_000,bypassL1:true});
  const {requestId}=await params;z.string().uuid().parse(requestId);
  const token=req.nextUrl.searchParams.get('token');if(!token || token.length>2048)throw unauthorized();
  let payload;try{({payload}=await jwtVerify(token,new TextEncoder().encode(env.JWT_SECRET),{audience:'personal-data-export',algorithms:['HS256']}));}catch{throw unauthorized('Download link expired or invalid');}
  if(payload.requestId!==requestId || !payload.sub)throw unauthorized();
  const db=await getDb();const valid=await db.execute(sql`SELECT r.id FROM data_export_requests r JOIN users u ON u.id=r.user_id WHERE r.id=${requestId} AND r.user_id=${payload.sub} AND r.expires_at>NOW() AND u.deleted_at IS NULL AND NOT u.is_banned AND NOT(u.is_suspended AND (u.suspended_until IS NULL OR u.suspended_until>NOW()))`);
  if(!valid.rows.length)throw unauthorized('Download link expired or account unavailable');
  return new NextResponse(personalExportStream(payload.sub,req.signal),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="zobia-personal-data.ndjson"','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }catch(error){return handleApiError(error);}
}
