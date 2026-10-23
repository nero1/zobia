export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {getDb} from '@/lib/db/drizzle';
import {badRequest,unauthorized,handleApiError} from '@/lib/api/errors';
/** Only a trusted game backend holds this secret; never distribute it to a client. */
export async function POST(req:NextRequest){
 try{
  const secret=process.env.GAME_RESULT_WEBHOOK_SECRET;
  if(!secret || secret.length<32)throw unauthorized();
  const timestamp=req.headers.get('x-game-timestamp')??'',signature=req.headers.get('x-game-signature')??'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^[0-9a-f]{64}$/i.test(signature))throw unauthorized();
  const reader=req.body?.getReader();if(!reader)throw badRequest('Missing result');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192){await reader.cancel();throw badRequest('Result too large');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const raw=Buffer.concat(chunks);
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  if(!timingSafeEqual(Buffer.from(signature,'hex'),expected))throw unauthorized();
  const result=z.object({nonce:z.string().uuid(),userId:z.string().uuid(),gameId:z.string().uuid(),score:z.number().int().nonnegative().max(1_000_000_000)}).strict().parse(JSON.parse(raw.toString()));
  const db=await getDb();
  await db.transaction(async tx=>{
   const play=await tx.execute<{id:string;max_score:number|null}>(sql`SELECT p.id,g.max_score FROM game_plays p JOIN games g ON g.id=p.game_id WHERE p.session_nonce=${result.nonce} AND p.user_id=${result.userId} AND p.game_id=${result.gameId} AND g.score_verification='server' AND p.started_at>NOW()-INTERVAL '48 hours' FOR UPDATE OF p`);
   if(!play.rows.length)throw badRequest('Result does not match a pending verified play');
   if(play.rows[0].max_score!==null && result.score>play.rows[0].max_score)throw badRequest('Score exceeds game maximum');
   const saved=await tx.execute(sql`INSERT INTO game_score_attestations(play_id,score) VALUES (${play.rows[0].id},${result.score}) ON CONFLICT(play_id) DO UPDATE SET score=game_score_attestations.score WHERE game_score_attestations.score=EXCLUDED.score RETURNING play_id`);
   if(!saved.rows.length)throw badRequest('A conflicting result was already verified');
  });
  return NextResponse.json({success:true});
 }catch(error){return handleApiError(error);}
}
