import assert from 'node:assert/strict';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST as mint } from '../app/api/auth/mobile-bridge/route';
import { GET as begin, POST as confirm } from '../app/api/auth/mobile-bridge/consume/route';
import { createSession, getSessionFresh, invalidateAllSessions, invalidateSession } from '../lib/auth/session';
import { verifyAccessToken } from '../lib/auth/jwt';
import { authenticateAccessToken } from '../lib/auth/principal';
import { redis } from '../lib/redis';
async function main() {
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const db = new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const tag=randomUUID().replaceAll('-','').slice(0,14);
 const users=(await db.query("INSERT INTO users(username,display_name,is_admin) VALUES($1,'Target',false),($2,'Actor',true) RETURNING id,username,is_admin,email",['bridge_'+tag,'actor_'+tag])).rows;
 const target=users.find(user=>!user.is_admin)!,actor=users.find(user=>user.is_admin)!;
 let seq=0;
 const request=(path:string,init:NonNullable<ConstructorParameters<typeof NextRequest>[1]>={})=>{const headers=new Headers(init.headers);headers.set("x-real-ip",`198.21.${parseInt(tag.slice(0,2),16)}.${++seq}`);return new NextRequest("http://localhost:3000"+path,{...init,headers});};
 const mintCode=async(token:string)=>{
  const response=await mint(request('/api/auth/mobile-bridge',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({path:'/kyc'})}),{params:Promise.resolve({})});
  assert.equal(response.status,200);return (await response.json()).data.code as string;
 };
 const start=async(code:string)=>{
  const response=await begin(request('/api/auth/mobile-bridge/consume?'+new URLSearchParams({code,redirect:'/kyc'})));
  assert.equal(response.status,303);assert.doesNotMatch(response.headers.get('set-cookie')??'',/zobia_at=/);
  return {id:new URL(response.headers.get('location')!).searchParams.get('intent')!,cookie:(response.headers.get('set-cookie')??'').split(';')[0]};
 };
 const post=(intent:{id:string;cookie:string})=>confirm(request('/api/auth/mobile-bridge/consume',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:intent.cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({intent:intent.id})}));
 try {
  const source=await createSession(target,{impersonatedBy:actor.id});const sourcePayload=await verifyAccessToken(source.accessToken);
  const sourceKey='session:'+sourcePayload.sid;
  const record=JSON.parse((await redis.get(sourceKey))!);record.created_at=new Date(Date.now()-600_000).toISOString();await redis.setex(sourceKey,900,JSON.stringify(record));
  const intent=await start(await mintCode(source.accessToken));
  const response=await post(intent);assert.equal(response.status,303);
  const token=(response.headers.get('set-cookie')??'').match(/zobia_at=([^;]+)/)?.[1];assert.ok(token);
  const payload=await verifyAccessToken(token);const child=await getSessionFresh(payload.sid!);
  assert.equal(child?.impersonatedBy,actor.id);assert.equal(child?.parentSid,sourcePayload.sid);
  assert.equal(child?.created_at,record.created_at);assert.ok(payload.exp!*1000<=new Date(record.created_at).getTime()+900_000+1000);
  await authenticateAccessToken(token);
  await assert.rejects(createSession(target,{parentSid:payload.sid}),/cannot be delegated again/);
  await db.query('UPDATE users SET is_admin=false WHERE id=$1',[actor.id]);
  await assert.rejects(authenticateAccessToken(token));
  await db.query('UPDATE users SET is_admin=true WHERE id=$1',[actor.id]);
  await invalidateSession(sourcePayload.sid!,target.id);assert.equal(await getSessionFresh(payload.sid!),null);
  console.log('PASS confirmed hand-offs preserve impersonation actor, original 15-minute deadline and immediate source revocation; delegation chains cannot bypass revocation');
  const normal=await createSession(target);const normalPayload=await verifyAccessToken(normal.accessToken);
  const stale=await start(await mintCode(normal.accessToken));await invalidateSession(normalPayload.sid!,target.id);
  assert.doesNotMatch((await post(stale)).headers.get('set-cookie')??'',/zobia_at=/);
  for(const state of ["is_banned=true","is_suspended=true,suspended_until=NOW()+INTERVAL '1 day'","session_valid_after=NOW()+INTERVAL '1 second'"]){
   await db.query("UPDATE users SET is_banned=false,is_suspended=false,suspended_until=NULL,session_valid_after='1970-01-01' WHERE id=$1",[target.id]);
   const source=await createSession(target);const intent=await start(await mintCode(source.accessToken));
   await db.query(`UPDATE users SET ${state} WHERE id=$1`,[target.id]);
   assert.doesNotMatch((await post(intent)).headers.get('set-cookie')??'',/zobia_at=/);
  }
  console.log('PASS browser confirmation rechecks source logout, live bans/suspensions and credential cutoffs after preview');
 }finally{
  for(const user of users){await invalidateAllSessions(user.id);await db.query('DELETE FROM users WHERE id=$1',[user.id]);}
  await db.end();
 }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.cause?.message??error.message);process.exit(1);});
