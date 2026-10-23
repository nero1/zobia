export const dynamic='force-dynamic';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { getDb } from '@/lib/db/drizzle';
import { withAuth } from '@/lib/api/middleware';
import { ApiError,handleApiError } from '@/lib/api/errors';
import { env } from '@/lib/env';

/** Reserve the daily export atomically; no private document is stored in SQL. */
export const POST=withAuth(async(_req,{auth})=>{
  try{
    const db=await getDb();
    const id=await db.transaction(async tx=>{
      await tx.execute(sql`SELECT id FROM users WHERE id=${auth.user.sub} FOR NO KEY UPDATE`);
      const recent=await tx.execute(sql`SELECT id FROM data_export_requests WHERE user_id=${auth.user.sub} AND created_at>NOW()-INTERVAL '24 hours' LIMIT 1`);
      if(recent.rows.length)throw new ApiError(429,'EXPORT_RATE_LIMITED','You can request one data export per 24 hours.');
      const result=await tx.execute<{id:string}>(sql`INSERT INTO data_export_requests(user_id,status,expires_at) VALUES (${auth.user.sub},'completed',NOW()+INTERVAL '15 minutes') RETURNING id`);
      return result.rows[0].id;
    });
    const expiresAt=new Date(Date.now()+15*60_000);
    const token=await new SignJWT({requestId:id}).setProtectedHeader({alg:'HS256'}).setSubject(auth.user.sub).setAudience('personal-data-export').setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime()/1000)).sign(new TextEncoder().encode(env.JWT_SECRET));
    return NextResponse.json({success:true,data:{requestId:id,downloadUrl:`${env.NEXT_PUBLIC_APP_URL}/api/users/me/export/${id}?token=${encodeURIComponent(token)}`,expiresAt:expiresAt.toISOString()},error:null},{headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  }catch(error){return handleApiError(error);}
});
